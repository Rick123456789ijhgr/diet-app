# 研究模組與程式套件對照表

規劃書以「模組一至五」敘述研究內容；程式碼則依業務領域命名。新增套件時請更新本表。

| 研究模組 | Flutter（app/lib/features） | Go（api/internal） | Python（ai/src/dietai） |
| --- | --- | --- | --- |
| 模組一 影像前處理 | `scan`（簡易品質檢查、壓縮） | — | `preprocess.quality`（品質檢查）、`preprocess.barcode`（條碼逐步升級）、`preprocess.decoders`（解碼器介面）、`preprocess.invoice_qr`（電子發票雙 QR 定位）、`preprocess.label`（營養標示：表格定位、透視校正、光斑、對比）、`preprocess.food`（食物照片：切出各道菜、盤緣橢圓、VLM 輸入縮放壓縮）、`preprocess.ops`（基本操作）、`preprocess.config`（門檻）、`preprocess.types`（共用型別）；`synthetic`（合成影像與條碼、合成實驗資料集，測試與研究用）；`evaluation`（實驗評測：manifest、E1 批次執行與判定、Wilson／McNemar 統計；`research/experiments/e1_barcode` 只呼叫它） |
| 模組二 條碼、發票、營養標示 | `scan` | `barcode`、`invoice` | `label_parsing`、`preprocess` |
| 模組三 產品資料庫 | — | `product` | `adapters/db`（唯讀） |
| 模組四 LLM 辨識與校正 | `diary`（確認修正） | `diary`、`job` | `recognition`、`adapters/llm` |
| 營養計算（步驟 08） | — | `nutrition` | — |
| 模組五 營養分析與建議 | `insights`、`profile` | `profile` | `analytics` |
| 共用基礎 | `core` | `platform` | `domain`、`adapters`、`server` |
| 開發工作台（前端為 `workbench/`，React，ADR 0003） | — | `workbench`、`webui`（提供建置後的前端） | `server`、`devtools` |
| 冷啟動上傳（任務書 2.6 節） | — | `coldstart`（流程與規則）、`auth`（組員登入）、`barcode`（GTIN）、`pgstore`（PostgreSQL）、`platform/objstore`（MinIO） | `preprocess`（經 gRPC） |
