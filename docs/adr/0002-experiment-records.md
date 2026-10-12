# 0002. 實驗紀錄採本地執行資料夾，暫不引入 MLflow／W&B

- 狀態：已採納
- 日期：2026-10-12
- 決策者：模組一 Phase 5（E1 實驗骨架）實作時提議，待研究組確認

## 情境

任務書 Phase 5 要求「依 `research/CLAUDE.md` 的規範記錄參數與結果（MLflow／W&B，以專案既定者為準）」，
但專案尚未選定工具（`.gitignore` 只預留了 `mlruns/`）。`research/CLAUDE.md` 要求的是：
結果由設定檔決定、改參數就新增設定檔、記錄模型版本與日期與隨機種子、測試集鎖定。

目前的實驗（E1）是確定性的影像處理＋解碼：沒有訓練、沒有隨機性（合成資料除外，種子已記錄），
一次執行數秒到數分鐘，需要比較的是「同一批影像上的幾組設定」，而不是大量超參數搜尋。

## 決策

每次執行寫成一個本地資料夾 `research/experiments/<實驗>/runs/<時間>_<label>/`，內含：

- `run.json`：時間、git commit 與是否有未提交變更、Python／套件版本、manifest 路徑與 sha256、
  資料產生參數（含種子）、每個實驗組的**完整**設定（含預設值，日後預設值改變仍可重現）。
- 明細（`results.csv`、`attempts.csv`）與彙整（`summary.md`、`summary*.csv`）。

執行資料夾不進 git（可由設定檔＋資料版本＋commit 重現）；正式結論抄進各實驗 `README.md` 的「結論」。
寫入邏輯集中在 `dietai.evaluation`，研究腳本與工作台共用。

## 考慮過的其他方案

| 方案 | 優點 | 缺點 | 未採用原因 |
| --- | --- | --- | --- |
| MLflow（本地 file store） | 內建比較介面、參數／指標查詢 | 依賴大（含 Flask、SQLAlchemy 等）、新版 file store 已不建議使用；E1 的分組表格仍要自己產生 | 目前只有一個確定性實驗，成本大於效益 |
| Weights & Biases | 雲端共享、圖表好看 | 需要帳號與網路；資料上傳到外部服務 | 研究資料（含照片路徑）不宜外送；CI 不可依賴網路 |
| 只寫 CSV、不記錄中繼資料 | 最簡單 | 無法確認結果對應哪個 commit／哪份 manifest | 不符合 research/CLAUDE.md 的紀錄要求 |

## 後果

- 好處：零新依賴、離線可用、CSV 可直接用 pandas／Excel 開啟；工作台已有檢視頁。
- 代價：跨多次執行的比較要自己寫（目前 `list_runs` 只列出資料夾）。
- 後續：E3 以後若需要大量 LLM 提示／模型比較，再評估 MLflow；屆時 `run.json` 的欄位可直接對應成
  MLflow 的 params／tags，`summary.csv` 對應 metrics，不需要改實驗腳本。
