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
| `preprocess_food(img, cfg)`（Phase 4 開工時新增） | 串接切菜、盤緣與縮放壓縮，回傳整張與各裁切的 VLM 輸入、`steps`、`warnings` |

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
- [ ] 新設定類別的欄位以 `param()` 宣告並加入 `dietai/devtools/configs.py` 的 `CONFIG_CLASSES`；在工作台新增該 Phase 的頁面（見 `workbench/README.md`「新增一個頁面」）。

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

### Phase 2 開工時

| 衝突或未定義處 | 決議 |
| --- | --- |
| `pipeline.py` 去留 | 刪除 `pipeline.py`、`steps.py` 與其測試；逐步升級（`LadderConfig.rungs`）取代其消融用途。`research/.../step*.yaml` 已標示廢止，Phase 5 改寫。 |
| 階梯各階是否疊加 | 各階**獨立**由原圖（或其灰階）產生，不疊加前一階，以便 E1 判斷是哪一步救回。「銳化／去雜訊」拆成 `sharpen`、`denoise` 兩階。 |
| zxing-cpp 內建的 90° 旋轉、縮小、反色嘗試 | 由 `ZxingConfig` 控制，預設與 zxing-cpp 相同（全開）；E1 可關閉以量測階梯本身的貢獻。 |
| 旋轉校正的做法 | 以梯度結構張量估計主方向（`ops.estimate_skew`），角度小於 `deskew_min_deg` 時略過。 |
| 四角座標的座標系 | 一律回推到原圖座標（旋轉、縮放階以仿射矩陣反推）。 |
| 發票只找到一個 QR 時放哪邊 | 放在 `left` 並附 `INVOICE_QR_PARTIAL`（單一碼無法判斷左右）。找到超過兩個時取面積最大的兩個。 |
| `InvoiceQrResult` 的 `image` 欄位 | 不提供：兩碼可能來自不同的階，沒有單一處理後影像（與 `QualityReport` 相同）。 |
| pyzbar | 提供 `PyzbarDecoder` 作為 E1 對照；ZBar 會轉碼 QR 內容，不可用於電子發票正式流程。CI 安裝 `libzbar0`。 |
| `LadderConfig` 的序列欄位（`rungs`、`scales`） | 不以 `param()` 宣告；工作台參數面板只處理純量欄位，序列由頁面元件提供，以 `extra_keys` 登記，匯入 JSON 與「還原」時寫回元件。 |

### Phase 3 開工時

| 衝突或未定義處 | 決議 |
| --- | --- |
| 步驟順序 | 定位＋校正 → 光斑 → 對比。光斑在校正後偵測，面積比例以標示本身為分母，不受背景大小影響。 |
| 「每步可開關」的粒度 | 三個開關：`enable_rectify`（定位與校正共用，只定位不校正沒有用途；`quad` 仍放在結果）、`enable_glare`、`enable_contrast`。全部關閉時輸出等於輸入（副本）。 |
| `GLARE_RETAKE` 後是否繼續 | 不修補，但對比增強照常執行，讓流程有輸出；是否要求重拍由 APP 依警告決定。 |
| 白色包裝被誤判為光斑 | 白紙本身高亮度、低飽和度，預設門檻採嚴格值（`glare_v_min=250`、`glare_s_max=30`），列為優先校準。改用「相對局部亮度」偵測列為後續事項。 |
| 灰階輸入 | 光斑只看亮度；CLAHE 一律作用於灰階並輸出灰階。彩色輸入由 `clahe_on_lab` 決定保留色彩（LAB 的 L 通道，預設）或輸出灰階。 |
| 定位速度與像素參數 | 定位前縮小到短邊 `detect_short_side`（預設 720，不放大），像素參數以該尺寸為準，座標再換回原圖。 |
| 雜訊或紋理形成整張畫面的假輪廓 | 新增 `max_quad_area_ratio`（預設 0.95）：面積比例超過者不採用。標示幾乎填滿畫面時本來就不需校正。 |
| 校正輸出尺寸 | 寬取上下兩邊較長者、高取左右兩邊較長者；長邊超過 `rectify_max_side`（預設 2000 px）時等比縮小。 |
| 四角順序 | `ops.order_quad`：依重心角度排成順時針，再以 `x + y` 最小者為左上；`Quad` 為 `float32 (4, 2)`、原圖座標。 |
| 直線法如何取外框 | 線段分近水平／近垂直兩組，以延長線在影像中心處的位置取最外側，只收共線（短邊 0.5% 內）的線段擬合，避免粗外框內側的另一條邊把結果往內拉。 |
| 已知限制 | 光斑或遮擋蓋住整段外框時，直線法可能把表格內的橫線當成外框，回傳偏差很大的四邊形且不附警告。需以真實照片評估發生率後再決定對策（例如以表格內容的一致性或品質分數拒絕）。 |
| 合成資料 | `synthetic.nutrition_label`（表格）與 `synthetic.label_perspective_scene`（已知四角的透視場景，回傳影像與真實四角）。 |

### Phase 4 開工時

| 衝突或未定義處 | 決議 |
| --- | --- |
| `resize_for_vlm` 簽名與 `fn(image, cfg)` 慣例不同 | 保留本任務書的 `resize_for_vlm(img, max_side, jpeg_quality)`：它是通用基本操作，模組四送營養標示給 VLM 時也會用；`preprocess_food` 由 `FoodConfig.vlm_max_side`、`vlm_jpeg_quality` 傳入。 |
| 「回傳影像與位元組大小」 | 回傳 `VlmImage`：`image` 為縮放後、壓縮前的影像，`jpeg` 為實際送出的位元組（`num_bytes` 即大小），`scale` 供把 VLM 回傳的座標換回原圖。 |
| 結果的 `steps`／`warnings` | 比照 Phase 3：`crop_dishes`、`detect_plate_ellipse` 只回傳框／橢圓（如 `locate_label_quad`），新增 `preprocess_food` 串接並回傳 `FoodResult`。E2 比較「整張 vs. 裁切」與模組四都需要同一入口。 |
| 切菜做法 | 背景色差：以四周邊框的 LAB 中位數為桌面色，ΔE（CIE76）超過 `bg_distance` 為前景，閉／開運算後**填洞**（與桌面同色的食物仍屬於盤子），取外輪廓的外接矩形。不用 Canny 輪廓：食物紋理會產生大量碎輪廓。 |
| 框的格式 | 新增 `types.Box`（原圖整數座標 `x, y, w, h`），依面積由大到小，向外擴張 `box_pad_ratio`。不含輪廓或分數，之後換成 SAM 時介面不變。 |
| 「高度重疊」的定義 | IoU 超過 `max_overlap` 時只留較大者（與一般 NMS 相同）；另以 `max_dishes` 限制數量。 |
| 切不出任何框 | 附 `DISH_NOT_FOUND`，`crops` 為空、仍輸出整張。不把整張當成一個框，避免下游誤以為只有一道菜。 |
| 盤緣橢圓（選做） | 已實作但預設關閉（`enable_plate=False`），因尚無下游使用。Canny＋`cv2.fitEllipse`，以正規化半徑殘差與圓周覆蓋比例過濾；中心落在較大橢圓內者（內圈盤緣、盤中食物）不採用。新增 `types.Ellipse`（長短軸為全長、角度為長軸方向）。 |
| 灰階輸入 | 切菜只剩亮度差（等同 ΔL）；JPEG 輸出灰階。 |
| 暫定預設值 | `morph_px=4`、`min_dish_area_ratio=0.005` 依合成場景（含俯拍傾斜 0.6 的小盤子）掃描選出，**不是校準值**，仍標示待校準。 |
| 已知限制 | ① 相鄰或接觸的盤子併成一個框；② 背景以單一顏色估計，桌布花紋、明暗梯度、特寫（菜佔滿邊框）、白盤放白桌時會失準；③ 盤緣只偵測完整度高的橢圓，被遮擋一半以上的盤子找不到。對策列為後續事項（以盤緣橢圓拆分合併框、距離轉換＋watershed、多色背景模型）。 |
| 合成資料 | `synthetic.food_scene`：木紋桌面、白盤（含內圈盤緣）、不規則食物與一雙筷子，回傳真實盤緣橢圓。 |

### Phase 5 開工時

| 衝突或未定義處 | 決議 |
| --- | --- |
| 實驗邏輯放哪裡 | 「跑哪些設定、怎麼判對錯、怎麼統計」放在新套件 `dietai.evaluation`（`manifest`、`stats`、`barcode`），研究腳本（`run.py`、`analyze.py`、`make_synthetic.py`）只解析參數；工作台的 E1 頁面共用同一套函式，CI 可測試。合成資料集產生器放在 `dietai.synthetic.datasets`。 |
| MLflow／W&B（專案未選定） | 都不用：每次執行寫成本地資料夾（`run.json`＋CSV），見 `docs/adr/0002-experiment-records.md`。 |
| CSV／Parquet | 只輸出 CSV（零新依賴、Excel 可開）；需要時可用 pandas 轉 Parquet。 |
| 設定檔格式 | JSON（不新增 PyYAML 依賴，且與工作台的設定匯出格式相容）。舊的 `step*.yaml` 從未產生結果，直接刪除。 |
| 消融設計 | `a0_raw`～`a6_full`：依 `DEFAULT_RUNGS` 逐階累加，zxing-cpp 內建嘗試關閉；另有上線情境（`z*`，內建嘗試開啟）與 pyzbar 對照（`p*`）。 |
| 「成功」的定義 | 解出且文字等於真值才算 `correct`；解出但不符為 `misread`（階梯在誤讀時停止，這是真實行為），與 `missed` 分開統計。`truth` 空白為負樣本，量測 `false_positive`。讀檔／處理失敗記為 `error`，不中斷整批、不計入成功率。 |
| 統計方法 | 成功率附 Wilson 95% CI；與基準組（預設為第一組）以同一批影像配對做 McNemar 精確檢定。只用標準函式庫，不需 scipy。 |
| manifest 欄位 | 必填 `image`、`truth`；選填 `split`、`id`；其餘欄位一律視為拍攝條件標籤，分析時可依任一欄分組。 |
| 測試集鎖定 | `split=test` 或路徑含 `splits/test` 的列預設排除並計數；正式實驗須加 `--include-test`，並記錄在 `run.json`。工作台的 `wb.images` 改用同一個 `is_test_split`。 |
| 結果不覆寫 | 執行資料夾以時間戳記命名，已存在且非空時拒絕寫入；`runs/`、`synthetic/` 加入 gitignore。 |
| research 的 lint | `research/ruff.toml` 沿用 `ai/pyproject.toml`；`make lint-ai` 與 CI 一併檢查 `../research`，mypy 涵蓋 E1 腳本；CI 的 ai job 在 `research/**` 變更時也執行。 |
| 已知觀察 | 合成資料上，`sharpen` 會把縮小 0.35 倍的條碼解成另一個**檢查碼正確**的 EAN-13，所有含 sharpen 的實驗組都繼承這個誤讀。是否調整階梯（例如要求兩階結果一致才採用）屬第 10 節「由人依 E1 結果決定」，本 Phase 不改。 |

### Phase 5 後續：誤讀對策

| 衝突或未定義處 | 決議 |
| --- | --- |
| 誤讀的來源 | E1 合成資料找出兩類：① 斜拍 EAN-13 被部分掃描成合法的 **UPC-E**（`verify_ean13` 只檢查 EAN-13）；② `sharpen` 產生檢查碼正確的另一個 EAN-13。`results.csv` 新增 `formats` 欄、`attempts.csv` 新增 `rejected_texts` 欄，方便診斷。 |
| 新增 `LadderConfig.accept_formats` | 採用的格式（空 = 全部）；其他格式的結果歸入 `rejected`、階梯繼續。序列欄位，工作台由條碼頁元件提供。電子發票不受影響（`invoice_qr` 一律忽略此欄位，只取 QR）。`CodeFormat` 移到 `types.py`，`decoders` 保留舊匯入路徑。 |
| 新增 `LadderConfig.min_agree` | 同一個（格式, 內容）須在幾次不同嘗試中解出才採用（多尺度每個倍率算一次）；未確認時附新警告 `BARCODE_UNCONFIRMED`。只作用於 `decode_with_ladder`。 |
| 預設值（2026-10-12 由專案負責人決定） | `accept_formats` 預設為 `RETAIL_FORMATS`（EAN-13／EAN-8／UPC-A）；`DEFAULT_RUNGS` 改為 sharpen 最後（raw → gray → binarize → denoise → deskew → multiscale → sharpen）；`min_agree` 維持 1（合成資料上 2 使成功率由 84% 降到 56%）。合成資料：上線組態成功率 84.4% → 88.3%、誤讀 6 → 1。真實照片的 E1 結果出來後再複核。 |
| 預設改變與舊實驗組 | 所有實驗組設定一律明寫 `rungs` 與 `accept_formats`（測試檢查），舊實驗組釘在 Phase 2 的值，結果可重現；新增 `z2_default_v2` 對應新預設（測試確認與程式預設一致，預設再改時應新增實驗組）。 |
| 新實驗組 | `m0`～`m5`（sharpen 移後、兩次一致、格式限制及其組合），結果見 E1 README。 |

## 10. 需要人決定、不要交給 AI 決定的事

- 各門檻的實際數值（由 100–200 張標記照片校準）。
- 逐步升級的最終步驟順序（由 E1 結果決定）。
- `LadderConfig.accept_formats`、`min_agree` 的上線預設值（已於 2026-10-12 依合成資料暫定，見第 9 節；以真實照片 E1 複核）。
- VLM 輸入的最終尺寸（由 E2 結果決定）。
- 是否引入 SAM 取代輪廓裁切。
