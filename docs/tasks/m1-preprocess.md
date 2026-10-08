# 任務書：模組一「影像前處理」實作

> 放置位置建議：`docs/tasks/m1-preprocess.md`
> 對應規劃書：V3.2 第四節（模組一）、第十三節 E1／E2、第十四節 14.4
> 使用方式：每次只交給 AI 工具一個 Phase，一個 Phase 一個 PR。

---

## 0. 給 AI 工具的開場指示（每個 Phase 都先貼這段）

1. 先讀 `CLAUDE.md`、`ai/CLAUDE.md`、`research/CLAUDE.md`、`docs/module-map.md`，遵守其中規範；若與本任務書衝突，停下來回報，不要自行取捨。
2. 動手前先列出「要新增或修改的檔案」與「預計的函式簽名」，等我確認後再寫程式。
3. 只做本 Phase 列出的內容；範圍外的需求寫進 PR 描述的「後續事項」。
4. 完成後執行 `make test`、`make lint`（或 `ai/` 內對應指令），全部通過才算完成。

---

## 1. 範圍

### 要做
- `ai/src/dietai/preprocess/`：品質檢查、條碼／QR 前處理、營養標示前處理、食物照片前處理。
- 純函式庫，不含 gRPC、不含資料庫存取、不呼叫任何外部 API。
- 每個處理步驟可單獨開關，並回傳「套用了哪些步驟」的紀錄，供 E1 消融實驗使用。
- `research/experiments/e1_barcode/` 的實驗腳本骨架。

### 不做（本模組範圍外）
- gRPC 服務與 `.proto`（之後另開任務，把本套件包成服務）。
- OCR、VLM 呼叫、營養標示欄位解析（屬模組二、四）。
- 發票中文解碼與欄位解析（由 Go 負責；Python 端只回傳 raw bytes）。
- 弧面展平（加分項目，之後再做）。
- SAM、CLIP 等需要下載模型權重的工具。
- 任何門檻的「最終數值」：門檻一律放設定檔，數值由研究組用標記資料校準，程式只提供合理預設值並在註解標明「待校準」。

---

## 2. 共通設計約定

### 2.1 套件結構

```
ai/src/dietai/preprocess/
├── __init__.py        對外公開的函式
├── types.py           共用型別（見 2.2）
├── config.py          所有門檻與參數（dataclass，含預設值）
├── ops.py             基本影像操作（無狀態純函式）
├── quality.py         Phase 1
├── barcode.py         Phase 2：條碼逐步升級
├── decoders.py        Phase 2：解碼器介面與 zxing-cpp 轉接
├── invoice_qr.py      Phase 2：電子發票雙 QR 定位
├── label.py           Phase 3：營養標示
└── food.py            Phase 4：食物照片
ai/tests/preprocess/
├── conftest.py        合成測試影像的 fixture
└── test_*.py
```

### 2.2 型別與介面規則

- 影像一律是 `numpy.ndarray`，`uint8`，BGR（OpenCV 慣例），灰階為 2 維。入口函式需檢查型別與維度，不符就丟 `ValueError`。
- 函式不得修改輸入陣列（必要時 `.copy()`），測試要驗證這點。
- 所有處理結果包成 frozen dataclass，至少包含：
  - `image`：處理後影像（失敗時可為 `None`）
  - `steps`：`list[StepRecord]`，每筆記錄步驟名稱、參數、耗時（毫秒）
  - `warnings`：給使用者的提示代碼（例如 `"TOO_BLURRY"`、`"GLARE_RETAKE"`），用字串列舉 `StrEnum`，不要寫中文訊息（文字由 APP 端對應）
- 參數一律由 `config.py` 的 dataclass 傳入，函式簽名形如 `fn(image, cfg: XxxConfig = XxxConfig())`；不得在函式內寫死門檻。
- 有隨機性的地方（如有）必須接受 `seed`。
- 全部加型別標註，通過 mypy（strict，設定於 `ai/pyproject.toml`；影像型別用 `types.Image`）。

### 2.3 測試資料原則

- **不把真實照片放進 git**（真實資料由 DVC 管理於 `research/data/`）。
- 單元測試全部使用 `conftest.py` 程式生成的合成影像：用 zxing-cpp 的產生功能畫條碼／QR，用 OpenCV 畫表格與文字，再施加已知的退化（高斯模糊、旋轉、透視變形、亮度梯度、白色光斑、雜訊）。
- 因為門檻尚未校準，品質檢查的測試以「相對關係」為主（例如模糊越重分數越低），只在退化很極端時才斷言分類結果。

---

## 3. Phase 1：共通品質檢查（必做）

**檔案：** `quality.py`、`ops.py` 的必要部分、`config.py` 的 `QualityConfig`

| 函式 | 做法 | 回傳 |
| --- | --- | --- |
| `blur_score(img, cfg)` | 灰階後拉普拉斯變異數（`cfg` 提供固定短邊） | `float` |
| `exposure_stats(img)` | 亮度平均、過暗像素比例、過亮像素比例 | dataclass |
| `resolution_check(img, cfg)` | 短邊像素是否低於下限 | `bool` |
| `check_quality(img, cfg)` | 綜合上述 | `QualityReport`：各分數、`passed`、`warnings`、`steps`（不產生影像，故無 `image` 欄位） |

- 計算模糊分數前先縮放到固定短邊（寫在設定中），避免解析度不同造成分數不可比；在 docstring 註明。
- 「主體佔畫面比例」先不做，在 PR 後續事項中列出。

**驗收：**
- 模糊程度遞增時 `blur_score` 單調遞減（測試至少 4 個等級）。
- 全黑、全白影像分別產生過暗、過亮警告。
- 小於下限的影像產生解析度警告。
- 單張 1080p 影像 `check_quality` 在一般筆電上低於 50 ms（寫成標記為 `slow` 的測試或基準腳本即可）。

---

## 4. Phase 2：條碼與電子發票 QR 前處理（必做＋應做）

### 4.1 基本操作（`ops.py`）
灰階化、自適應二值化、旋轉、多尺度縮放、反銳化遮罩、中值濾波；每個都是獨立純函式。

### 4.2 解碼器介面（`decoders.py`）
```python
class Decoder(Protocol):
    def __call__(self, img: np.ndarray) -> list[DecodeHit]: ...
```
`DecodeHit` 包含：格式（EAN-13、QR 等）、文字、**raw bytes**、四角座標。
提供 `ZxingDecoder` 作為預設實作。前處理邏輯只依賴 `Decoder` 介面，方便實驗換成 pyzbar 對照。

### 4.3 逐步升級（`barcode.py`）
```python
def decode_with_ladder(img, decoder, cfg: LadderConfig) -> LadderResult
```
- 依設定中的順序嘗試：原圖 → 灰階 → 自適應二值化 → 銳化／去雜訊 → 旋轉校正 → 多尺度；第一次成功即停止。
- `LadderResult` 記錄：是否成功、成功於第幾步、每一步的嘗試與耗時。
- 階梯順序與啟用的步驟由 `LadderConfig` 控制，E1 消融實驗靠這個切換，不改程式。
- EAN-13 檢查碼驗證屬模組二，但為了避免把誤讀算成功，這裡提供 `ean13_checksum_ok(code: str) -> bool` 並在階梯中使用（可設定關閉）。

### 4.4 電子發票雙 QR（`invoice_qr.py`）
```python
def locate_invoice_qrs(img, decoder, cfg) -> InvoiceQrResult
```
- 一張影像找出兩個 QR，依水平位置分為左碼、右碼；同樣套用逐步升級。
- 只回傳左右兩碼的 raw bytes 與座標，**不做中文解碼、不解析欄位**（Go 負責）。
- 只找到一個時回傳部分結果並附警告，不丟例外。

**驗收：**
- 合成 EAN-13 在：原圖、旋轉 15°／45°、模糊、亮度梯度、縮小至 1/4 等條件下，`decode_with_ladder` 的成功率高於只用原圖（測試中直接比較兩者成功數）。
- 檢查碼錯誤的字串被判定為失敗。
- 並排兩個 QR 的合成影像能正確區分左右，且 raw bytes 與產生時一致（用含非 ASCII 位元組的內容測試）。

---

## 5. Phase 3：營養標示前處理（必做）

**檔案：** `label.py`

| 函式 | 做法 |
| --- | --- |
| `locate_label_quad(img, cfg)` | Canny＋輪廓近似找最大四邊形；失敗時以 HoughLinesP 找直線再求交點；都失敗回傳 `None` |
| `rectify(img, quad, cfg)` | 四角排序後做單應性轉換，輸出尺寸依四邊長度推算 |
| `detect_glare(img, cfg)` | HSV 中高亮度、低飽和度的區域；回傳遮罩與面積比例 |
| `remove_glare(img, mask, cfg)` | 面積比例超過上限 → 警告 `GLARE_RETAKE`，不處理；否則 `cv2.inpaint` |
| `enhance_contrast(img, cfg)` | CLAHE（灰階或 LAB 的 L 通道，由設定決定） |
| `preprocess_label(img, cfg)` | 串接以上步驟，每步可由設定開關 |

- 找不到表格框時，不中斷流程：使用原圖繼續後續步驟，並加上 `LABEL_NOT_LOCATED` 警告。

**驗收：**
- 合成表格（畫格線＋文字）經已知透視變形後，`locate_label_quad` 找到的四角與真實四角平均誤差小於設定的像素容許值（測試中先用 10 px）。
- `rectify` 後表格的橫線接近水平（角度誤差小於 2°）。
- 小面積光斑被修補、大面積光斑產生 `GLARE_RETAKE`。
- 每個步驟都可個別關閉，關閉後輸出與輸入相同。

---

## 6. Phase 4：食物照片前處理（應做）

**檔案：** `food.py`

| 函式 | 做法 |
| --- | --- |
| `resize_for_vlm(img, max_side, jpeg_quality)` | 等比縮放＋JPEG 壓縮，回傳影像與位元組大小 |
| `crop_dishes(img, cfg)` | 輪廓偵測切出各道菜，回傳裁切框清單（含原圖座標）；過小、過大或高度重疊的框依設定過濾 |
| `detect_plate_ellipse(img, cfg)`（選做） | 橢圓擬合偵測盤緣 |

- `resize_for_vlm` 只負責縮放；「不影響準確率的最小尺寸」由 E2 實驗決定，不在此寫死。
- `crop_dishes` 設計成可替換（之後可能換成 SAM），所以回傳格式只用框座標，不依賴輪廓實作細節。

**驗收：**
- 縮放後長邊等於 `max_side` 且長寬比不變；小於 `max_side` 的影像不放大。
- 合成影像（背景上畫 3 個不同顏色的圓）能切出 3 個框，且每個框涵蓋對應的圓。

---

## 7. Phase 5：E1 實驗骨架（必做）

**位置：** `research/experiments/e1_barcode/`

- `run.py`：讀取 manifest（CSV：影像路徑、真值條碼、拍攝條件標籤），對每張影像以多組 `LadderConfig` 執行，輸出每張、每組設定的結果到 CSV／Parquet。
- `configs/`：消融用的設定檔，例如 `raw_only`、`+binarize`、`+sharpen`、`full`。
- `analyze.ipynb` 或 `analyze.py`：依拍攝條件分組計算成功率。
- 實驗程式必須 `import dietai.preprocess`，不得複製前處理程式碼。
- 依 `research/CLAUDE.md` 的規範記錄參數與結果（MLflow／W&B，以專案既定者為準）。
- 先用合成資料產生一份小 manifest 讓腳本能端到端跑通；真實資料由組員之後放入 DVC。

---

## 8. 完成定義（每個 Phase 都適用）

- [ ] 新增的公開函式都有型別標註與 docstring（說明輸入格式、回傳內容、用到的設定欄位）。
- [ ] 單元測試涵蓋正常、退化與失敗情況；測試不依賴網路或真實照片。
- [ ] lint、型別檢查、測試全部通過；CI 對 `ai/` 的檢查為綠燈。
- [ ] 依賴套件加入 `ai/pyproject.toml`，並鎖定版本。
- [ ] `docs/module-map.md` 更新對應關係（模組一 ↔ `dietai.preprocess.*`）。
- [ ] PR 描述列出：完成項目、未完成與後續事項、所有「待校準」的門檻清單。
- [ ] 新設定類別的欄位以 `param()` 宣告並加入 `ai/workbench/wb/configs.py` 的 `CONFIG_CLASSES`；在工作台新增該 Phase 的頁面（見 `ai/workbench/README.md`）。

---

## 9. 已決議事項（Phase 1 開工時）

| 衝突 | 決議 |
| --- | --- |
| `ai/CLAUDE.md` 的 `@register` pipeline 與本任務書的 config dataclass | 以本任務書為準，已改寫 `ai/CLAUDE.md`。`pipeline.py` 暫留，Phase 2 決定刪除或改為包裝逐步升級。 |
| 舊 `steps.gray` 以 RGB 權重計算 | 改為 BGR，與本任務書一致。 |
| CI 未安裝 OpenCV | CI 改裝 `.[dev,vision]`；`slow` 測試在 CI 以 `-m "not slow"` 略過，本機 `make test-ai` 會執行。 |
| 專案無型別檢查工具 | 加入 mypy（strict），納入 CI 與 `make lint-ai`。 |
| 「鎖定版本」 | `pyproject.toml` 以 `==` 鎖定用到的套件；`pyzbar`、`zxing-cpp` 於 Phase 2 使用時再鎖定。 |
| `research/experiments/e1_barcode/configs/step*.yaml` 為舊 pipeline 格式 | Phase 5 改為 `LadderConfig` 格式（新增設定檔，舊檔標示廢止）。 |

## 10. 需要人決定、不要交給 AI 決定的事

- 各門檻的實際數值（由 100–200 張標記照片校準）。
- 逐步升級的最終步驟順序（由 E1 結果決定）。
- VLM 輸入的最終尺寸（由 E2 結果決定）。
- 是否引入 SAM 取代輪廓裁切。
