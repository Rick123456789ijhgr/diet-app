# CLAUDE.md（research／研究實驗）

先讀根目錄 `CLAUDE.md`。

## 規則

- **只 import `dietai` 套件**，不得在 notebook 或腳本中複製、改寫處理邏輯。需要新功能就加到 `ai/` 並寫測試。
- 每個實驗一個資料夾：`experiments/eN_描述/`，內含 `configs/`（設定檔）、`run.py`（執行腳本）、`README.md`（目的、對應 RQ、結論）。
- 實驗結果由設定檔決定：改參數就新增設定檔，不覆寫舊的。
- **測試集鎖定**：`data/splits/test` 只在正式實驗時使用，不得用於調整門檻、規則或提示。
- 記錄每次實驗的 LLM 模型名稱、版本、日期與隨機種子；LLM 回應一律經快取。
- 原始資料（照片、標註）由 DVC 管理，不 commit 進 git。
- notebook 只做探索與畫圖；commit 前清除輸出（`nbstripout`）。

## 環境

```bash
pip install -e "../ai[dev,vision,ocr,llm,analytics]"
```
