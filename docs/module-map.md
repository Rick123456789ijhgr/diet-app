# 研究模組與程式套件對照表

規劃書以「模組一至五」敘述研究內容；程式碼則依業務領域命名。新增套件時請更新本表。

| 研究模組 | Flutter（app/lib/features） | Go（api/internal） | Python（ai/src/dietai） |
| --- | --- | --- | --- |
| 模組一 影像前處理 | `scan`（簡易品質檢查、壓縮） | — | `preprocess.quality`（品質檢查）、`preprocess.barcode`（條碼逐步升級）、`preprocess.decoders`（解碼器介面）、`preprocess.invoice_qr`（電子發票雙 QR 定位）、`preprocess.label`（營養標示：表格定位、透視校正、光斑、對比）、`preprocess.ops`（基本操作）、`preprocess.config`（門檻）、`preprocess.types`（共用型別）；`synthetic`（合成影像與條碼，測試用） |
| 模組二 條碼、發票、營養標示 | `scan` | `barcode`、`invoice` | `label_parsing`、`preprocess` |
| 模組三 產品資料庫 | — | `product` | `adapters/db`（唯讀） |
| 模組四 LLM 辨識與校正 | `diary`（確認修正） | `diary`、`job` | `recognition`、`adapters/llm` |
| 營養計算（步驟 08） | — | `nutrition` | — |
| 模組五 營養分析與建議 | `insights`、`profile` | `profile` | `analytics` |
| 共用基礎 | `core` | `platform` | `domain`、`adapters`、`server` |
| 開發工作台 | — | — | `ai/workbench`（不屬於 `dietai`，只呼叫其公開函式） |
