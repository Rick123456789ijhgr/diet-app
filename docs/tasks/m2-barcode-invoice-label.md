# 任務書：模組二「條碼、發票、營養標示」實作

> 狀態：Phase 0（#68）、Phase 1（#69）已完成；下一步 Phase 2（2026-11-24）
> 對應：`docs/module-map.md` 模組二那行、ADR 0004（即時掃描 vs 靜態照片）、ADR 0005（E2 指標）
> 使用方式：每次只交給 AI 工具一個 Phase，一個 Phase 一個 PR。

---

## 0. 給 AI 工具的開場指示（每個 Phase 都先貼這段）

1. 先讀 `CLAUDE.md`、`ai/CLAUDE.md`、`api/CLAUDE.md`、`docs/module-map.md`，以及本 Phase 涉及資料夾的 `CLAUDE.md`；若與本任務書衝突，停下來回報，不要自行取捨。
2. 動手前先列出「要新增或修改的檔案」與「預計的函式簽名」，等我確認後再寫程式。
3. 只做本 Phase 列出的內容；範圍外的需求寫進 PR 描述的「後續事項」。
4. `openapi/`、`proto/`、`db/migrations/` 不得自行修改（規則 3、8）；需要時只在 PR 描述寫出建議內容，由 Rick 決定。
5. 完成後執行 `make test`、`make lint`，全部通過才算完成。

---

## 1. 範圍

### 要做

- **營養標示讀取（Python）**：把「前處理 → OCR → 欄位解析 → 邏輯驗證」串成產品程式可以呼叫的單一入口，並經 gRPC 提供給 Go。
- **冷啟動上傳接上營養標示讀取（Go）**：營養標示照片上傳後自動讀取，結果作為草稿的預填值，由組員確認後才寫入資料庫。
- **電子發票解析（Go）**：合併左右兩個 QR、依編碼參數解碼、解析表頭與品項。純函式庫。
- **條碼查詢（Go）**：檢查碼驗證後查自建產品資料庫。
- **開發工作台的「營養標示讀取」頁面**。

### 不做（本模組範圍外）

- 影像前處理本身的改良（模組一）。模組二只呼叫 `dietai.preprocess`，不修改其行為。
- 發票品項對應到產品、產品資料庫的擴充與比對（模組三）。
- 任何 LLM／VLM 呼叫（模組四）。模組二全部是規則式、確定性程式。
- Flutter APP 的掃描畫面：`app/` 尚未建立 Flutter 專案，待 APP 骨架建立後另開任務書（見第 9 節）。
- Open Food Facts 查詢：需要新的資料來源與 migration，待第 10 節決定後另開 Phase。
- 營養標示 OCR 引擎的最終選擇：由 E2 階段零決定，本模組的程式只依賴 `OcrEngine` 介面。

---

## 2. 共通設計約定

### 2.1 模組一、二如何連接

```
APP ──HTTP（OpenAPI）──▶ Go ──gRPC（proto）──▶ Python
                          │                      │
                          │                      └─ label_parsing.read_label()   ← 模組二的核心函式
                          │                           ├─ preprocess.preprocess_label（模組一，直接呼叫函式）
                          │                           ├─ OcrEngine（adapters/ocr，經 CachedOcr）
                          │                           ├─ fields.parse_fields
                          │                           └─ validation.validate
                          ├─ barcode（GTIN、查產品）           ← 不經 Python
                          └─ invoice（雙 QR 合併與解析）        ← 不經 Python
```

- **同一服務內呼叫函式**：Python 的 `label_parsing` 直接 import `dietai.preprocess`，不為模組間另開 API。
- **跨服務用 gRPC**：Go 一次呼叫 `ParseLabel`，由 Python 跑完整條流程；不讓 Go 分別呼叫前處理與 OCR（影像不往返兩次，流程不分散在兩個服務）。
- **條碼、發票的即時掃描不經 Python**（ADR 0004）：APP 掃到字串後送 Go。只有靜態照片（冷啟動、相簿匯入）才經 Python 既有的 `DecodeBarcode`／`LocateInvoiceQr`。
- **研究與產品共用同一個入口**：`evaluation.label_run` 改為呼叫 `read_label()`，E2 量到的就是上線的流程。

### 2.2 數字規則

- 營養數值只來自 `fields.parse_fields` 的規則式解析（規則 1）；不得以 LLM、模糊比對或「看起來合理」的推測修補數字。
- 解析結果在 Python 端以 `Decimal`（或照原文的十進位字串）保存，經 gRPC 傳遞時**不轉成浮點數**，避免 `2.1` 變成 `2.0999…`。
- 讀取結果只是**候選值**：寫入資料庫前一定要經過人確認（冷啟動由組員確認、APP 由使用者確認），寫入只由 Go 執行（規則 2）。
- 欄位對不上、欄的基準（每份／每 100 公克）判斷不出來時，回傳空值與警告代碼，不猜。

### 2.3 型別與介面

- Python 沿用模組一的慣例：入口函式 `fn(image, ..., cfg: XxxConfig = XxxConfig())`，結果為 frozen dataclass，含 `steps` 與 `warnings`；門檻放在設定的 dataclass，以 `param()` 宣告。
- 新的警告代碼用 `StrEnum`、英文大寫（例如 `LABEL_BASIS_UNKNOWN`），文字由 APP／工作台對應。
- 欄的基準沿用真值格式（`evaluation.label`）的名稱：`per_serving`、`per_100g`、`per_100ml`。對應到資料庫時，`per_100g`／`per_100ml` 寫成 `nutrition_facts.basis = 'per_100'`，單位由 `products.content_unit` 表示。
- Go 的 `invoice`、`barcode` 核心邏輯為純函式，不 import 資料庫、HTTP、gRPC；查詢資料庫經 service 介面（`api/CLAUDE.md`）。

### 2.4 測試資料原則

- 不把真實照片或真實發票放進 git。
- 營養標示：單元測試用假的 `OcrEngine`（直接回傳指定的文字框），不依賴 Tesseract 或 PaddleOCR；`synthetic.nutrition_label` 的合成標示只用於標記為 `slow` 的整合測試。
- 電子發票：用程式組出符合規格的 QR 字串（含 Big5、UTF-8、Base64 三種品項編碼），不需要影像。
- 條碼：表格驅動測試（UPC-A、EAN-13、EAN-8、店內碼、檢查碼錯誤）。

---

## 3. Phase 0：規格（由 Rick 主導，AI 只起草）

本 Phase 不寫程式。AI 工具把下列建議寫成一份 PR 描述草稿，由 Rick 決定採用與否並親自修改規格檔。

### 3.1 proto：新的 `LabelService.ParseLabel`

新增 `proto/dietai/v1/label.proto`，沿用 `preprocess.proto` 的 `ImageInput`、`ConfigOverride`、`Point`、`Step`。

```proto
service LabelService {
  rpc ParseLabel(ParseLabelRequest) returns (ParseLabelResponse);
}

message ParseLabelRequest {
  ImageInput image = 1;
  ConfigOverride config = 2;      // LabelReadConfig（含 LabelConfig）
}

message LabelQuantity {
  string value = 1;               // 十進位字串，例如 "2.1"；不使用 double
  string unit = 2;                // kcal／mg／g／ml／份
}

message LabelCell {
  string field = 1;               // FIELDS 之一
  string basis = 2;               // per_serving／per_100g／per_100ml；表頭欄位為空
  LabelQuantity quantity = 3;
}

message RuleResult {
  string rule = 1;                // 例如 atwater、sugar_le_carb
  bool passed = 2;
  string detail = 3;
}

message ParseLabelResponse {
  repeated LabelCell cells = 1;
  repeated string columns = 2;    // 判斷出的欄基準，依標示上由左到右；判斷不出為空
  repeated string lines = 3;      // OCR 排成的文字行（供人工核對）
  repeated RuleResult checks = 4; // 邏輯驗證結果
  repeated Point quad = 5;        // 同 PreprocessLabelResponse
  string ocr_engine = 6;          // OcrEngine.name
  repeated string warnings = 7;
  repeated Step steps = 8;
}
```

### 3.2 OpenAPI（APP 用）

- `GET /products/by-barcode/{code}`：條碼查詢（Phase 4）。
- `POST /invoices/parse`：送左右兩碼字串，回傳解析結果，**不儲存**（Phase 3）。
- `POST /labels/parse`：上傳營養標示照片，回傳候選值，不儲存（APP 骨架建立後才需要，可延後）。

### 3.3 migration

本模組的 Phase 1–5 **不需要** migration。發票儲存、Open Food Facts 快取等需要新資料表的功能列入第 9 節後續事項。

---

## 4. Phase 1：營養標示讀取核心（Python，必做）

**檔案：** `ai/src/dietai/label_parsing/reader.py`（新增）、`label_parsing/config.py` 或沿用 `preprocess/config.py` 的慣例新增 `LabelReadConfig`、`evaluation/label_run.py`（改為呼叫 `read_label`）

```python
def read_label(
    image: Image, ocr: OcrEngine, cfg: LabelReadConfig = LabelReadConfig()
) -> LabelReading
```

- 依序：`preprocess.preprocess_label(image, cfg.preprocess)` → `ocr(...)` → `group_lines` → `parse_fields` → 欄基準判斷 → `validation.validate`。
- `LabelReading`（frozen dataclass）：`cells`（（欄位, 基準）→ `Quantity`）、`columns`、`lines`、`boxes`（OCR 原始框，工作台用）、`checks`、`quad`、`ocr_engine`、`steps`、`warnings`。
- **欄基準判斷**（新增，規則式）：從表頭行找出「每份」「每 100 公克／每 100g／per 100g」「每 100 毫升」等關鍵字，依水平位置排出各欄的基準；「每日參考值百分比」欄本來就由 `parse_fields` 略過。找不到表頭時，若只有一欄數值則不指定基準並附 `LABEL_BASIS_UNKNOWN`，多欄時也一樣，不猜。
- **與 `domain.NutritionLabel` 的轉換**：提供 `to_nutrition_label(reading) -> NutritionLabel | None`，只有八項營養素都齊全的欄才轉；`NutritionFacts` 目前用 `float`，轉換函式要在 docstring 註明「只供驗證規則使用，不作為寫入值」。
- `validation.validate` 的容許誤差改由 `LabelReadConfig` 傳入（目前是函式預設值），標示「待校準」。
- 前處理失敗（找不到表格）時仍以原圖跑 OCR，附 `LABEL_NOT_LOCATED`，不丟例外。
- `evaluation.label_run` 改為呼叫 `read_label`，同一份 manifest 重跑合成冒煙資料，欄位正確率須與改寫前相同（測試或 PR 中附對照）。

**驗收：**

- 假 OCR 回傳中文標示（每份＋每 100 公克兩欄、含每日參考值百分比）時，16 個營養素格與 2 個表頭格全部正確，基準對應正確。
- 只有一欄、沒有表頭時附 `LABEL_BASIS_UNKNOWN`，基準為空。
- 熱量與三大營養素不符 Atwater 時，`checks` 中對應規則為失敗，但數值照常回傳（驗證只提示，不改值）。
- 輸入陣列不被修改；`read_label` 不 import 任何 `adapters` 的具體實作。

---

## 5. Phase 2：`ParseLabel` RPC 與冷啟動預填（Python＋Go，必做）

**前提：** Phase 0 的 proto 已由 Rick 合併、`make gen` 完成。

**Python：** `server/` 新增 `ParseLabel`，以 `rpc.unary` 包裝，只做 proto ↔ domain 轉換；OCR 引擎在服務啟動時依環境變數建立，一律經 `CachedOcr`。

**Go：**

- `platform/aiclient` 直接使用產生的 client，不另包邏輯。
- `coldstart`：營養標示照片（`KindLabel`）上傳時，除了原本的前處理摘要，再呼叫 `ParseLabel`；結果存在 `ImagePreprocess` 旁的新欄位（例如 `LabelReading`），**只在草稿欄位為空時預填**，不覆蓋組員已輸入的值。
- 預填值與 OCR 原文行一起回傳給工作台，讓組員對照原圖確認。
- Python 服務無法連線或逾時：照片上傳照常成功，讀取結果記錄錯誤原因（比照現有 `ImagePreprocess.Error`）。
- 邏輯驗證失敗只顯示提示，不阻擋確認（與 migration 000002 註解的「一致性檢查由 Go 在確認時提示」一致）。

**驗收：**

- Go 單元測試以假的 Preprocessor／LabelReader 驗證：預填只填空欄位；Python 失敗時上傳仍成功；十進位字串轉成草稿數值時不失真（`"2.1"` → `2.1`）。
- 端到端：`make db-up` 後在工作台上傳合成標示，草稿出現預填值。

---

## 6. Phase 3：電子發票解析（Go，必做）

**檔案：** `api/internal/invoice/`（`qr.go`、`items.go`、對應測試）

```go
func Parse(left, right []byte) (Invoice, error)   // right 可為 nil
```

欄位位置（取自 2026-11-01 的舊草稿 `docs/m2-task-draft`，**仍須對照規格文件**）：

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

- **輸入是原始位元組**：Big5 必須在位元組層解碼（`golang.org/x/text/encoding/traditionalchinese`），不能先轉成字串。
  OpenAPI 的 `InvoiceParseRequest.left／right` 目前是字串；Phase 3 開工時先確認 APP 的掃描套件能取得原始位元組，
  若能，規格改為 base64 位元組（規格變更由 Rick 決定）。
- 品目錯誤不中斷，盡量解析並附警告：`INVOICE_RIGHT_MISSING`、`INVOICE_ITEMS_TRUNCATED`（總筆數 > 記載筆數）、
  `INVOICE_ITEM_MALFORMED`、`INVOICE_AMOUNT_MISMATCH`（Σ數量×單價與總計額差距超過容許值）。

- 依財政部「電子發票證明聯一維及二維條碼規格說明」解析左碼表頭：發票字軌號碼、開立日期（民國年轉西元）、隨機碼、銷售額與總計額（十六進位）、買方與賣方統一編號、加密驗證資訊。**欄位位置與長度以規格文件為準**，實作前先把規格版本與條文寫進 `doc.go`。
- 品項區：依編碼參數（Big5／UTF-8／Base64）解碼；左碼後段與右碼（`**` 開頭）串接後再以 `:` 分隔為「品名:數量:單價」。
- 規格允許品項不完整（QR 只記錄部分品項），回傳中要保留「QR 內品項數」與「總品項數」，不完整時附警告，不視為錯誤。
- 金額用整數或 `decimal`，不用 `float64`；以表格驅動測試（`api/CLAUDE.md`）。
- 只有右碼、左右顛倒、非電子發票 QR：回傳有代碼的錯誤（例如 `INVOICE_LEFT_MISSING`），由 handler 轉成 `{"code","message","field"}`。
- 不儲存、不對應產品（模組三）。

**驗收：** Big5、UTF-8、Base64 三種編碼各一組測試；品項名稱含 `:` 以外的全形符號；品項跨左右兩碼；品項不完整；欄位長度錯誤。

---

## 7. Phase 4：條碼查詢（Go，必做）

**檔案：** `api/internal/barcode/`（`service.go`）、`api/internal/product/`（查詢介面）

- 輸入任意掃描字串：`NormalizeGTIN` → 查 `products.gtin`；店內碼（`2` 開頭的 EAN-13 等）不查全域資料庫，回傳 `BARCODE_STORE_CODE`。
- 查不到回傳 `PRODUCT_NOT_FOUND`，並帶上正規化後的 GTIN，方便 APP 引導使用者走冷啟動上傳。
- 回傳產品基本資料與**目前有效**（`superseded_at IS NULL`）的營養標示。
- `barcode` 經 `product` service 介面查詢，不直接使用 `pgstore`（`api/CLAUDE.md`）。
- 外部資料來源（Open Food Facts）預留介面 `ExternalSource`，本 Phase 不實作。

**驗收：** UPC-A 與對應的 EAN-13 查到同一產品；檢查碼錯誤回傳錯誤代碼；已被取代的營養標示不回傳。

---

## 8. Phase 5：工作台「營養標示讀取」頁面（應做）

- 上傳或選擇一張標示照片 → 顯示原圖與定位四角、校正後影像疊上 OCR 文字框、文字行、解析出的欄位表（欄 × 基準）、邏輯驗證結果。
- 有真值檔時並列真值，標出不一致的格（判定沿用 `evaluation.label.score_fields`）。
- `LabelReadConfig` 的參數面板由 `param()` 自動產生。
- 需要的 `workbench.yaml`／`workbench.proto` 變更比照 Phase 0，由 Rick 同意後才改。
- 依工作台規範：標籤只寫中文、說明收進 ⓘ、不放說明段落（見 `workbench/README.md`「新增一個頁面」）。

---

## 9. 後續事項（本任務書不做，各自另開）

- **Flutter APP 骨架與 `scan`**：`app/` 尚未建立 Flutter 專案。建立後以現成套件即時掃描條碼與發票雙 QR（ADR 0004），送 Go 的 `GET /products/by-barcode`、`POST /invoices/parse`。
- **Open Food Facts 查詢與快取**：需新增資料來源（`products.source` 目前只允許 `coldstart`）與 migration。
- **發票儲存與品項對應產品**：模組三。
- **E2 正式實驗**：真實標示照片、兩人獨立標記、OCR 引擎階段零。Phase 1 完成後 E2 即以 `read_label` 為受測流程。

---

## 10. 已決議事項（2026-11-24，Rick）

| 項目 | 決議 | 理由 |
| --- | --- | --- |
| `ParseLabel` 放哪個 service | 新開 `LabelService` | 前處理是模組一、讀取是模組二，分開較清楚 |
| 數值在 proto 的型別 | 十進位字串，不用 `double` | 2.2 節 |
| 上線預設 OCR 引擎 | PaddleOCR mobile 為預設，可由環境變數切換成 Tesseract | 合成資料上明顯較好；正式選擇仍由 E2 階段零決定 |
| 欄基準判斷不出時 | 不指定，附 `LABEL_BASIS_UNKNOWN`，交給人選 | 2.2 節「不猜」 |
| `POST /invoices/parse` 是否儲存 | 只解析、不儲存 | 儲存需要 migration，併入模組三 |
| Phase 順序 | 先做 1 → 2；3、4 與 Python 無關，可由另一人並行；5 在 2 之後 | 營養標示是主要貢獻，E2 也需要 `read_label` |

開工後遇到的衝突或未定義處，比照模組一任務書第 9 節，依 Phase 記在本節之下。

---

## 11. 完成定義（每個 Phase 都適用）

- [ ] 新增的公開函式都有型別標註與 docstring（輸入格式、回傳內容、用到的設定欄位）。
- [ ] 單元測試涵蓋正常、缺漏與失敗情況；不依賴網路、真實照片或真實 OCR 引擎（`slow` 整合測試除外）。
- [ ] lint、型別檢查、測試全部通過；CI 綠燈。
- [ ] 新依賴鎖定版本。
- [ ] `docs/module-map.md` 模組二那行更新（`label_parsing.reader`、Go `invoice`、`barcode` 的實際內容）。
- [ ] PR 描述列出：完成項目、後續事項、所有「待校準」的門檻，以及需要 Rick 決定的規格變更。
- [ ] 新設定類別以 `param()` 宣告並加入 `devtools/configs.py` 的 `CONFIG_CLASSES`。
