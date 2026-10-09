# CLAUDE.md（ai／Python 外掛服務）

先讀根目錄 `CLAUDE.md`。

## 職責

影像前處理（模組一）、營養標示解析與驗證（模組二）、VLM 辨識與校正（模組四）、缺口偵測與建議（模組五），以及研究實驗共用的所有處理邏輯。

## 結構

```
src/dietai/
  domain/         Pydantic 資料模型，不依賴任何外部套件以外的東西
  preprocess/     影像前處理：品質檢查、條碼逐步升級、發票 QR 定位（之後：營養標示、食物照片）
  label_parsing/  營養標示欄位解析與邏輯驗證規則
  recognition/    RAG、自我一致性、數值替換、統計校正
  analytics/      缺口偵測、規則版與最佳化版建議
  adapters/       外部世界：LLM（LiteLLM）、OCR、資料庫（唯讀）、物件儲存、快取
  server/         gRPC 外殼：只做 proto ↔ domain 轉換，不放邏輯
  synthetic/      合成影像與已知退化（測試、工作台、研究共用；不放處理邏輯）
tests/
workbench/        開發工作台（Streamlit），見 workbench/README.md；系統執行時不依賴
```

## 規則

- `domain`、`preprocess`、`label_parsing`、`recognition`、`analytics` 不得 import `adapters` 的具體實作，只能依賴介面（`typing.Protocol`）。
- 外部模型（VLM、OCR）一律透過 `adapters` 中的介面呼叫，並經過快取層；快取鍵包含模型名稱、提示版本與影像雜湊。
- **不得寫入資料庫**。只能讀取 `db/` 中定義的 view。
- LLM 回應一律以 Pydantic 模型驗證；LLM 輸出的數字不得直接當作營養數值使用。
- 前處理函式簽名為 `fn(image, cfg: XxxConfig = XxxConfig())`，門檻與參數一律放在 `preprocess/config.py` 的 frozen dataclass，不寫死在函式內；消融實驗以設定檔產生不同的 config 切換，不改程式。結果回傳 frozen dataclass，含 `steps`（`StepRecord`）與 `warnings`（`PreprocessWarning` 代碼）。
- 影像一律為 `uint8` 的 `numpy.ndarray`，彩色為 BGR（OpenCV 慣例），灰階為 2 維；入口函式檢查格式並不得修改輸入。
- 工作台（`workbench/`）只 import `dietai`，不得複製處理邏輯；需要的中間結果（如 `laplacian_map`）加到 `dietai` 的公開函式。介面文字中文為主、英文為輔。
- 設定欄位以 `config.param()` 宣告中英文名稱、說明、範圍與 `calibrate`，工作台據此自動產生表單。
- 條碼／QR 解碼只透過 `preprocess.decoders.Decoder` 介面；`ZxingDecoder` 為預設實作，`PyzbarDecoder` 僅供實驗對照（ZBar 會轉碼 QR 內容，不可用於電子發票）。
- 條碼逐步升級的每一階都由原圖獨立產生，順序與啟用由 `LadderConfig.rungs` 控制；新增一階時加到 `types.Rung` 與 `barcode.ladder_variants`。
- 單元測試不得呼叫真實 LLM 或網路；使用假實作（fake）。
- 隨機性（抽樣、bootstrap）一律接受 `seed` 參數。

## 指令

```bash
pip install -e ".[dev]"          # 最小開發環境
pip install -e ".[dev,vision]"   # 加上 OpenCV 等影像套件（preprocess 測試必需）
pip install -e ".[dev,vision,workbench]" && streamlit run workbench/streamlit_app.py
                                 # 開發工作台：調參數、模擬退化、參數掃描、資料夾批次、跑測試
pytest                           # 含 slow 效能測試；CI 用 pytest -m "not slow"
ruff check . && ruff format --check . && mypy
```
