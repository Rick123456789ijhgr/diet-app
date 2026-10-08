# CLAUDE.md（專案根目錄）

本檔給 AI 程式工具與新組員閱讀。各服務資料夾另有自己的 CLAUDE.md，規則以「越近越優先」為準。

## 專案概要

飲食紀錄 APP：以包裝標示、條碼、電子發票建立有真值的產品資料庫，用來評測、約束、校正外部 LLM／VLM 的飲食辨識結果。
三個服務：Flutter APP（`app/`）、Go 主伺服器（`api/`）、Python 外掛服務（`ai/`）。

## 不可違反的規則

1. **數字由程式決定**：營養素、克數、熱量一律由資料庫或確定性程式計算，不可採用 LLM 輸出的數字。
2. **Go 是資料庫唯一寫入者**：Python 只能透過唯讀帳號讀取 `db/` 中定義的 view，不得寫入。
3. **規格優先**：`openapi/`、`proto/`、`db/migrations/` 的變更必須由人主導並在 PR 中明確說明；AI 工具不得順手修改。
4. **產生的程式碼不手改**：所有 `gen/` 目錄由工具產生，要改就改規格後重新產生。
5. **不訓練、不微調神經網路**：只使用現成工具、傳統影像處理、規則與統計方法。
6. **API 金鑰只在 Python 服務**：APP 與 Go 中不得出現任何 LLM 金鑰。
7. **測試集鎖定**：`research/` 中標記為 test split 的資料不得用於調整規則、門檻或提示。
8. **migration 只往前**：已合併的 migration 檔不可修改，要改就新增一支。

## 程式碼組織原則

- 依業務領域命名（`barcode`、`invoice`、`label_parsing`），不依「模組一到五」編號命名。對照表見 `docs/module-map.md`。
- 依賴方向朝內：核心邏輯不得 import 資料庫、HTTP、gRPC 或 LLM 廠商套件；外部元件透過介面接入。
- 系統與研究共用程式碼：`research/` 只 import `ai/` 套件，不得複製處理邏輯。

## 常用指令

```bash
make up        # 啟動所有服務
make test      # 全部測試
make lint      # 全部 lint
make gen       # 依規格重新產生程式碼（OpenAPI、proto、sqlc）
```

## 工作流程

- 從 `main` 開短命分支，命名：`feat/ai-preprocess-deskew`、`fix/api-barcode-checksum`。
- Commit 採 Conventional Commits：`feat(ai/preprocess): 新增 CLAHE 步驟`。
- 每個 PR 必須附測試；保持小而單一目的。
- 重大設計決策寫 ADR：`docs/adr/NNNN-標題.md`，格式見 `0000-template.md`。
