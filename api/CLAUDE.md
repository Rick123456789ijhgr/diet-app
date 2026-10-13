# CLAUDE.md（api／Go 主伺服器）

先讀根目錄 `CLAUDE.md`。

## 職責

API 路由與參數驗證、身分驗證、資料庫存取（唯一寫入者）、任務管理與 SSE、條碼查詢、發票 QR 解析、營養計算、需求比對與每日彙總。
不做：影像處理、OCR、LLM 呼叫（一律經 gRPC 交給 `ai/`）。

## 結構

```
cmd/server/       只負責組裝依賴與啟動，不放業務邏輯
internal/<領域>/  handler.go → service.go → repository.go
internal/platform 資料庫、gRPC 客戶端、物件儲存、設定、日誌
gen/              oapi-codegen、sqlc、buf 產生的程式碼，不手改
```

## 規則

- 領域之間只透過對方 service 的介面互相呼叫，不直接使用別人的 repository。
- `internal/nutrition` 必須是純函式：不得 import 資料庫、網路、時間或任何 `platform` 套件。
- handler 不寫業務邏輯；service 不知道 HTTP（不接收 `*http.Request`）。
- 錯誤用 `fmt.Errorf("...: %w", err)` 包裝；日誌用 `log/slog`，並帶 `request_id`。
- 金額與營養數值的計算要有表格驅動測試（table-driven tests）。
- 新增資料表：先在 `db/migrations/` 新增 migration，再寫 sqlc 查詢，最後 `make gen`。
- 呼叫 Python 一律經 `internal/platform/aiclient`（自動帶 `request_id`、預設逾時）；錯誤以 `errors.As(err, &*aiclient.Error)` 取得 Python 回傳的錯誤代碼（`Reason`）與欄位（`Field`）。
- 由 OpenAPI 產生的路由採 strict server：handler 只做轉接，錯誤一律回傳 `error`，由統一的錯誤處理輸出 `{"code","message","field"}`（見 `internal/workbench/errors.go`）。
- 開發工作台路由（`internal/workbench`）的開發工具只在 `WORKBENCH_DEV_TOOLS=1` 時啟用，線上部署不開。

## 指令

```bash
go test ./...
go vet ./...
gofmt -l .
```
