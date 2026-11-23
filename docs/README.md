# 文件索引

新增、改名或改變狀態時一併更新本表。研究規劃書（V3.2）不在 repo 中；文件裡的「規劃書 6.1」等章節編號指的是它。

## 先讀這些

| 文件 | 用途 |
| --- | --- |
| [`../CLAUDE.md`](../CLAUDE.md) | 專案規則（不可違反的 8 條）、溝通語言、常用指令 |
| [`../ONBOARDING.md`](../ONBOARDING.md) | 新組員上手 |
| [`module-map.md`](module-map.md) | 研究模組一至五 ↔ 各服務的程式套件 |

## 任務書（`tasks/`）：交給 AI 工具或組員實作，一個 Phase 一個 PR

| 文件 | 範圍 | 狀態 |
| --- | --- | --- |
| [`tasks/m1-preprocess.md`](tasks/m1-preprocess.md) | 模組一：影像前處理 | Phase 1–5 完成 |
| [`tasks/m2-barcode-invoice-label.md`](tasks/m2-barcode-invoice-label.md) | 模組二：條碼查詢、電子發票、營養標示讀取 | Phase 0、1 完成；下一步 Phase 2 |
| [`tasks/workbench-react.md`](tasks/workbench-react.md) | 開發工作台改版（React＋Go）與冷啟動上傳 | 已實作 |

## 架構決策（`adr/`）

| 文件 | 決策 | 狀態 |
| --- | --- | --- |
| [`adr/0000-template.md`](adr/0000-template.md) | 範本 | — |
| [`adr/0001-three-services-in-monorepo.md`](adr/0001-three-services-in-monorepo.md) | 三個服務放在同一個 repo | 已採納 |
| [`adr/0002-experiment-records.md`](adr/0002-experiment-records.md) | 實驗紀錄寫成本機資料夾（不用 MLflow／W&B） | 已採納 |
| [`adr/0003-workbench-react-go.md`](adr/0003-workbench-react-go.md) | 工作台改為 React，經 Go 存取 | 已採納 |
| [`adr/0004-preprocess-scope-static-photos.md`](adr/0004-preprocess-scope-static-photos.md) | 伺服器前處理只服務靜態照片；APP 即時掃描用現成套件 | 已採納 |
| [`adr/0005-preprocess-experiment-design.md`](adr/0005-preprocess-experiment-design.md) | 前處理實驗改為「每個方法都執行」，以原始樣本為統計單位 | 已採納 |

## 實驗設計

| 文件 | 內容 |
| --- | --- |
| [`preprocess-experiment-design.md`](preprocess-experiment-design.md) | 模組一前處理實驗（E1 條碼、E2 營養標示、E3 發票 QR）的設計修訂版，ADR 0005 的依據 |

各實驗的執行方式與結果在 `research/experiments/eN_*/README.md`。

## 審查紀錄（`reviews/`）

| 文件 | 內容 | 狀態 |
| --- | --- | --- |
| [`reviews/module1-code-review.md`](reviews/module1-code-review.md) | 第一輪（M1）：模組一與工作台的疑似問題清單 | 已處理 |
| [`reviews/round2-full-review-plan.md`](reviews/round2-full-review-plan.md) | 第二輪（M2）：全專案 code review 的方法與範圍（「M2」是第二輪，不是模組二） | 規劃中，尚未執行 |

## 工具

| 文件 | 內容 |
| --- | --- |
| [`codebase-memory-mcp.md`](codebase-memory-mcp.md) | 選用的程式碼圖索引（Claude Code 查呼叫鏈）：安裝、使用、移除 |
| [`../workbench/README.md`](../workbench/README.md) | 開發工作台：啟動、新增頁面 |

## 命名慣例

- 任務書：`tasks/m<模組編號>-<主題>.md`；跨模組的工具用主題命名（例如 `workbench-react.md`）。
- 審查：`reviews/module<N>-…`（針對單一模組）或 `reviews/round<N>-…`（全專案第 N 輪）。
- ADR：`adr/NNNN-標題.md`，格式見範本。
