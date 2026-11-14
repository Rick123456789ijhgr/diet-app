# 研究模組與程式套件對照表

規劃書以「模組一至五」敘述研究內容；程式碼則依業務領域命名。新增套件時請更新本表。

| 研究模組 | Flutter（app/lib/features） | Go（api/internal） | Python（ai/src/dietai） |
| --- | --- | --- | --- |
| 模組一 影像前處理 | `scan`（簡易品質檢查、壓縮） | — | `preprocess.quality`（品質檢查）、`preprocess.features`（自適應策略用的品質量測值）、`preprocess.adaptive`（規則式自適應策略：依量測值排出嘗試順序）、`preprocess.barcode`（條碼逐步升級，含固定角度旋轉 `rotate` 階、以 OpenCV 條碼偵測器定位後轉正裁切的 `locate` 階與疊加型固定流程 `pipeline` 階，流程步驟可帶參數縮放、旋轉）、`preprocess.decoders`（解碼器介面）、`preprocess.invoice_qr`（電子發票雙 QR 定位）、`preprocess.label`（營養標示：表格定位、透視校正、光斑、對比）、`preprocess.food`（食物照片：切出各道菜、盤緣橢圓、VLM 輸入縮放壓縮）、`preprocess.ops`（基本操作）、`preprocess.config`（門檻）、`preprocess.types`（共用型別）；`synthetic`（合成影像與條碼、已知程度的劣化、合成實驗資料集，以及由真實照片產生劣化變體的半合成資料集 `synthetic.variants`；測試與研究用）；`evaluation`（實驗評測：manifest、E1 批次執行與判定、「每個方法都執行」結果表與離線逐步升級、貪婪選擇（`evaluation.methods`）、Wilson／McNemar 與以原始樣本為單位的集群 bootstrap、Holm 校正（`evaluation.stats`）、混合效果邏輯迴歸（`evaluation.glmm`）、自適應策略的離線評估與門檻調整（`evaluation.adaptive`）、找最佳流程的真值推定與依確認真值重新判定（`evaluation.best_flow`）、營養標示的真值格式與欄位評分（`evaluation.label`）與 OCR 批次評估（`evaluation.label_run`）、電子發票 QR 的判定與離線逐步升級（`evaluation.invoice`）；`research/experiments/e1_barcode`、`e2_label`、`e3_invoice_qr` 只呼叫它） |
| 模組二 條碼、發票、營養標示 | `scan` | `barcode`、`invoice` | `label_parsing`（營養標示欄位解析 `fields`、OCR 介面與文字行排版 `ocr`）、`adapters/ocr`（Tesseract；PaddleOCR 在獨立環境 `ai/.venv-paddle` 以子行程執行；結果經 `CachedOcr` 快取）、`preprocess` |
| 模組三 產品資料庫 | — | `product` | `adapters/db`（唯讀） |
| 模組四 LLM 辨識與校正 | `diary`（確認修正） | `diary`、`job` | `recognition`、`adapters/llm` |
| 營養計算（步驟 08） | — | `nutrition` | — |
| 模組五 營養分析與建議 | `insights`、`profile` | `profile` | `analytics` |
| 共用基礎 | `core` | `platform` | `domain`、`adapters`、`server` |
| 開發工作台（前端為 `workbench/`，React，ADR 0003） | — | `workbench`、`webui`（提供建置後的前端） | `server`、`devtools`（找最佳流程：`devtools.best_flow`） |
| 冷啟動上傳（任務書 2.6 節） | — | `coldstart`（流程與規則）、`auth`（組員登入）、`barcode`（GTIN）、`pgstore`（PostgreSQL）、`platform/objstore`（MinIO） | `preprocess`（經 gRPC） |
