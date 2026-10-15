package coldstart

import "errors"

var (
	// ErrNotFound 表示找不到上傳、照片或產品。
	ErrNotFound = errors.New("找不到")
	// ErrClosed 表示上傳已確認或已退回，不能再修改（SUBMISSION_CLOSED）。
	ErrClosed = errors.New("這筆上傳已確認或已退回，不能再修改")
	// ErrStale 表示 If-Match 與目前版本不同（PRECONDITION_FAILED）。
	ErrStale = errors.New("這筆上傳已被其他人修改，請重新載入")
	// ErrUnavailable 表示沒有設定資料庫或物件儲存（DB_UNAVAILABLE）。
	ErrUnavailable = errors.New("冷啟動上傳需要資料庫與物件儲存（設定 DATABASE_URL、MINIO_ENDPOINT）")
)

// InvalidError 是請求內容不合法（HTTP 400）。
type InvalidError struct {
	Code    string // 例如 INVALID_BARCODE、UNSUPPORTED_IMAGE、BARCODE_MISMATCH
	Field   string
	Message string
}

func (e *InvalidError) Error() string { return e.Code + ": " + e.Message }

// BarcodeExistsError 表示同一條碼的產品已存在（HTTP 409 BARCODE_EXISTS）。
type BarcodeExistsError struct {
	Product Product
}

func (e *BarcodeExistsError) Error() string {
	return "條碼 " + e.Product.Barcode + " 的產品已存在：" + e.Product.Name
}

// ProblemError 是確認時草稿不完整或數值不一致（HTTP 422）。
type ProblemError struct {
	Code    string // DRAFT_INCOMPLETE 或 NUTRITION_INCONSISTENT
	Message string
	Missing []string
	Issues  []Issue
}

func (e *ProblemError) Error() string { return e.Code + ": " + e.Message }
