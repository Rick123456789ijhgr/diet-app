# 任務書：模組二「條碼、發票、營養標示」實作

> 狀態：**草稿**（2026-11-01，由 AI 依 repo 現況擬定，待專案負責人確認範圍與第 9 節的待決事項）
> 對應規劃書：V3.2 模組二（**規劃書不在 repo 中**，本草稿依 `docs/module-map.md`、各 `doc.go` 與 ADR 0003 推定；請對照規劃書修正）
> 使用方式：比照 M1，每次只交給 AI 工具一個 Phase，一個 Phase 一個 PR。

---

## 0. 給 AI 工具的開場指示（每個 Phase 都先貼這段）

1. 先讀 `CLAUDE.md`、`api/CLAUDE.md`、`ai/CLAUDE.md`、`docs/module-map.md`，以及本任務書第 9 節已決議事項；若與本任務書衝突，停下來回報。
2. 動手前先列出「要新增或修改的檔案」與「預計的函式簽名」，等確認後再寫程式。
3. 只做本 Phase 列出的內容；範圍外的需求寫進 PR 描述的「後續事項」。
4. `openapi/`、`proto/`、`db/migrations/` 的變更由人主導：需要時在 PR 描述中提出草案，不自行修改。
5. 完成後執行 `make test`、`make lint`，全部通過才算完成。

---

## 1. 範圍

### 要做
| 子題 | 服務 | 套件 | 內容 |
| --- | --- | --- | --- |
| 電子發票 | Go | `internal/invoice` | 左右兩碼合併、表頭欄位解析、Big5／UTF-8／Base64 品名解碼、品項解析與一致性檢查 |
| 條碼查詢 | Go | `internal/barcode` | GTIN 正規化（已完成）→ 查自建產品庫 → 查 Open Food Facts（外部資料只當候選，不直接進產品庫） |
| 營養標示 | Python | `dietai.label_parsing` | OCR 文字 → `NutritionLabel` 欄位解析；依台灣法規的標示與捨入規則做邏輯驗證 |
| 串接 | Go／Python | `workbench`、`coldstart`、`server` | 冷啟動流程「自動帶入、人工確認」（ADR 0003 第 7 點）、工作台頁面 |

### 不做（本模組範圍外）
- 發票驗證資訊（加密 24 碼）的解密或向財政部查驗：需要營業人金鑰，不在 APP 範圍。
- 發票品名對應到產品（品名正規化、別名、模糊比對）：屬模組三 `product`。
- VLM 讀營養標示：屬模組四；本模組只用傳統 OCR＋規則。
- 任何營養數字的「自動寫入」：解析結果一律經人工確認才進 `nutrition_facts`（根目錄規則 1、ADR 0003）。

---

## 2. 共通設計約定

- Go：`invoice`、`barcode` 的解析與驗證為純函式（不 import 資料庫、HTTP、時間）；需要外部資料的部分（自建庫、Open Food Facts）以介面注入，放在 `service.go`。錯誤用具名 sentinel error 或帶欄位的錯誤型別，供 handler 轉成 `{"code","message","field"}`。
- Python：`label_parsing` 不 import `adapters` 的具體實作；OCR 透過 `typing.Protocol` 介面，測試用 fake（固定的文字行與座標）。
- 門檻（容許誤差、OCR 信心下限等）放 frozen dataclass，以 `param()` 宣告並登記到 `devtools/configs.py`，標示「待校準」。
- 警告用英文代碼（`INVOICE_ITEMS_TRUNCATED`、`LABEL_FIELD_MISSING` 等），中文訊息由 APP／工作台對應。
- 測試資料：發票以程式組出符合規格的 QR 內容（含 Big5 位元組）；營養標示以 OCR 文字行的 fixture 與 `synthetic.nutrition_label` 合成影像。不放真實發票或照片進 git。

---

## 3. Phase 1：電子發票 QR 解析（Go，必做）

**檔案：** `api/internal/invoice/`（`qr.go`、`qr_test.go`、`decode.go`）

依財政部「電子發票證明聯一維及二維條碼規格說明」：

| 位置 | 欄位 | 長度 | 備註 |
| --- | --- | --- | --- |
| 左碼 1–10 | 發票字軌號碼 | 10 | 2 英文字母＋8 數字 |
| 11–17 | 開立日期 | 7 | 民國年 `yyyMMdd` |
| 18–21 | 隨機碼 | 4 | |
| 22–29 | 銷售額（未稅） | 8 | 16 進位 |
| 30–37 | 總計額（含稅） | 8 | 16 進位 |
| 38–45 | 買方統編 | 8 | 無則 `00000000` |
| 46–53 | 賣方統編 | 8 | |
| 54–77 | 加密驗證資訊 | 24 | 只保留、不解 |
| 之後 | `:`營業人自行使用區(10)`:`本碼品目筆數`:`品目總筆數`:`中文編碼參數`:`品名`:`數量`:`單價…` | | 編碼參數 0＝Big5、1＝UTF-8、2＝Base64 |
| 右碼 | `**` 開頭，接續左碼的品目字串 | | 品項可能跨兩碼 |

```go
type Header struct {
    Number      string // "AB12345678"
    Date        civil date（年月日，不含時區；民國年轉西元）
    RandomCode  string
    SalesAmount int64  // 未稅，元
    TotalAmount int64  // 含稅，元
    BuyerID     string // 空字串表示無
    SellerID    string
    Encrypted   string
}
type Item struct {
    Name      string
    Quantity  decimal（字串保留原值＋解析後數值）
    UnitPrice decimal
}
type Invoice struct {
    Header     Header
    Items      []Item
    ItemsInQR  int  // 二維條碼記載的完整品目筆數
    ItemsTotal int  // 該張發票的品目總筆數
    Warnings   []Warning
}

func Parse(left, right []byte) (Invoice, error)   // right 可為 nil
func ParseHeader(left []byte) (Header, error)
```

- 輸入是 Python 回傳的 **raw bytes**（Big5 必須在位元組層解碼，不能先轉字串）。
- 表頭錯誤（長度不足、日期不合法、金額非 16 進位、字軌格式錯）→ 回傳錯誤，指出欄位。
- 品目欄位錯誤不中斷：盡量解析，附警告（`INVOICE_RIGHT_MISSING`、`INVOICE_ITEMS_TRUNCATED`（總筆數 > 記載筆數）、`INVOICE_ITEM_MALFORMED`、`INVOICE_AMOUNT_MISMATCH`（Σ數量×單價 與總計額差距超過容許值））。
- 金額以整數元、數量與單價以十進位字串保留，不用 float 比對。
- Big5 解碼用 `golang.org/x/text/encoding/traditionalchinese`（已是間接依賴，改為直接依賴）。

**驗收：**
- 表格驅動測試：Big5／UTF-8／Base64 三種編碼、品項跨左右碼、只有左碼、無品項、統編 `00000000`、各表頭欄位格式錯誤。
- 與 Python `synthetic` 產生的雙 QR 影像串成一個整合測試（Go 端用 fixture 的 raw bytes，不啟動 Python）。

---

## 4. Phase 2：營養標示欄位解析（Python，必做）

**檔案：** `ai/src/dietai/label_parsing/`（`ocr.py` 介面、`parse.py`、`config.py`、`validation.py` 擴充）

```python
class OcrLine(BaseModel):          # domain
    text: str
    box: Quad | None
    confidence: float

class OcrEngine(Protocol):
    def __call__(self, img: Image) -> list[OcrLine]: ...

def parse_label(lines: list[OcrLine], cfg: ParseConfig = ParseConfig()) -> LabelParseResult
# LabelParseResult：label（NutritionLabel，缺的欄位為 None）、fields（每欄的來源文字、行號、信心）、warnings、steps
```

- 規則式解析台灣營養標示格式：「每一份量 N 公克（毫升）」「本包裝含 N 份」、八項必要欄位（熱量 大卡、蛋白質、脂肪、飽和脂肪、反式脂肪、碳水化合物、糖、鈉 毫克）、「每份」「每 100 公克／毫升」「每日參考值百分比」欄位辨識。
- 欄位對應依表格座標（同一列、欄位標題的 x 範圍），不只靠文字順序。
- 單位換算（公克／毫克、大卡／千焦）、全形數字、OCR 常見混淆（`O→0`、`l→1`）由規則處理，每次替換記錄在 `fields`。
- `validation.py` 擴充：依衛福部「包裝食品營養標示應遵行事項」的捨入與「可標示為 0」規則調整 Atwater 與加總檢查的容許值；每份 × 100／份量 ≈ 每 100 公克的交叉檢查。
- 解析結果只作為冷啟動「自動帶入」的候選，**仍須人工確認**。

**驗收：**
- 以 fixture 文字行測試：直式／橫式表格、缺欄位、毫升產品、千焦併列、含每日參考值百分比欄。
- 每個驗證規則有正反例。

---

## 5. Phase 3：條碼查詢（Go，必做）

**檔案：** `api/internal/barcode/`（`service.go`、`off.go`）

```go
type Lookup interface { FindByGTIN(ctx, gtin string) (Product, error) }   // 自建庫（pgstore）
type External interface { Fetch(ctx, gtin string) (Candidate, error) }   // Open Food Facts

func (s *Service) Lookup(ctx, code string) (Result, error)
// Result：Source（"local" | "off" | "none"）、Product 或 Candidate
```

- 先 `NormalizeGTIN`，再查自建庫，查不到才查 Open Food Facts（可設定關閉、逾時、快取）。
- Open Food Facts 的營養數值**只當候選**：不寫入 `nutrition_facts`，只在冷啟動畫面作為對照。是否另存一份外部資料表需 migration，見第 9 節。

---

## 6. Phase 4：串接（gRPC、工作台、冷啟動）

需要規格變更，由人先定稿：
- `proto/`：新增 `ParseLabel` RPC（輸入營養標示影像或前處理後影像，回傳 `LabelParseResult`）。
- `openapi/`：條碼查詢、發票解析的 APP 端點；工作台的對應端點。
- 冷啟動：標示照片上傳後呼叫 `ParseLabel`，把結果帶入草稿欄位並標示來源，人工確認後才寫入。
- 工作台：「發票」頁（顯示兩碼 raw bytes 與解析結果）、「營養標示解析」頁（OCR 行框、欄位對應、驗證結果）。

---

## 7. Phase 5：評測（應做）

- `dietai.evaluation` 新增營養標示解析的評測：欄位層級的正確率（完全相同／容許誤差內）、缺漏率，依拍攝條件分組；manifest 規則與 E1 相同（測試集鎖定）。
- 發票：真實發票樣本的解析成功率與警告分布（Go 端提供 CLI 或測試工具）。
- 實驗編號與 RQ 對應待規劃書確認。

---

## 8. 完成定義（每個 Phase 都適用）

- [ ] 公開函式有型別與文件註解（輸入格式、回傳、用到的設定欄位）。
- [ ] 表格驅動測試涵蓋正常、退化與失敗；不依賴網路或真實照片／發票。
- [ ] `make test`、`make lint` 通過。
- [ ] 新依賴鎖定版本（Go 寫進 `go.mod`；Python 以 `==` 鎖定）。
- [ ] `docs/module-map.md` 更新。
- [ ] PR 描述列出完成項目、後續事項、所有「待校準」門檻與需要人決定的規格草案。

---

## 9. 待決事項（開工前請專案負責人決定）

| # | 問題 | AI 的建議 |
| --- | --- | --- |
| 1 | 本任務書的 Phase 劃分與順序是否符合規劃書 | Phase 1（發票）先做：純 Go、不需規格或 migration 變更 |
| 2 | OCR 引擎：`pyproject.toml` 的 `ocr` extra 已列 `paddleocr`，但 M1 排除「需要下載模型權重的工具」 | **已決議（2026-11-01）**：Phase 2 只做 `OcrEngine` 介面＋規則解析（以 fake 測試），引擎另開 PR 決定（PaddleOCR／Tesseract／RapidOCR） |
| 3 | 發票 Base64 編碼參數（`2`）解碼後的字元集 | 依規格說明確認；未確認前視為 UTF-8，並以警告標示 |
| 4 | Open Food Facts 是否允許在線上呼叫、資料是否落地（需 migration 與 `products.source` 擴充） | 先只做即時查詢、不落地 |
| 5 | 發票金額不一致的容許值（折扣、四捨五入） | 先設 1 元，標示待校準 |
| 6 | 營養標示捨入與「可標示為 0」的法規版本 | 以衛福部現行公告為準，請提供或確認版本 |

## 10. 需要人決定、不要交給 AI 決定的事

- `proto/`、`openapi/`、`db/migrations/` 的定稿。
- OCR 引擎選擇與是否引入需要下載權重的模型。
- 各容許值、信心門檻的最終數值（以標記資料校準，不得用 test split）。
- 外部資料（Open Food Facts）在產品資料庫中的地位。
