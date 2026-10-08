# CLAUDE.md（ai／Python 外掛服務）

先讀根目錄 `CLAUDE.md`。

## 職責

影像前處理（模組一）、營養標示解析與驗證（模組二）、VLM 辨識與校正（模組四）、缺口偵測與建議（模組五），以及研究實驗共用的所有處理邏輯。

## 結構

```
src/dietai/
  domain/         Pydantic 資料模型，不依賴任何外部套件以外的東西
  preprocess/     影像前處理步驟與 pipeline
  label_parsing/  營養標示欄位解析與邏輯驗證規則
  recognition/    RAG、自我一致性、數值替換、統計校正
  analytics/      缺口偵測、規則版與最佳化版建議
  adapters/       外部世界：LLM（LiteLLM）、OCR、資料庫（唯讀）、物件儲存、快取
  server/         gRPC 外殼：只做 proto ↔ domain 轉換，不放邏輯
tests/
```

## 規則

- `domain`、`preprocess`、`label_parsing`、`recognition`、`analytics` 不得 import `adapters` 的具體實作，只能依賴介面（`typing.Protocol`）。
- 外部模型（VLM、OCR）一律透過 `adapters` 中的介面呼叫，並經過快取層；快取鍵包含模型名稱、提示版本與影像雜湊。
- **不得寫入資料庫**。只能讀取 `db/` 中定義的 view。
- LLM 回應一律以 Pydantic 模型驗證；LLM 輸出的數字不得直接當作營養數值使用。
- 前處理步驟以 `@register("名稱")` 註冊到 pipeline，參數由呼叫端傳入，不寫死在函式內，以便消融實驗以設定檔切換。
- 單元測試不得呼叫真實 LLM 或網路；使用假實作（fake）。
- 隨機性（抽樣、bootstrap）一律接受 `seed` 參數。

## 指令

```bash
pip install -e ".[dev]"          # 最小開發環境
pip install -e ".[dev,vision]"   # 加上 OpenCV 等影像套件
pytest
ruff check . && ruff format --check .
```
