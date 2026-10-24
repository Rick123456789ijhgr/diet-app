package workbench

import (
	"encoding/json"
	"errors"
	"net/http"

	"google.golang.org/grpc/codes"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/coldstart"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
)

// Error 是回給前端的錯誤：Code 為英文代碼（前端對應中文），Field 為出錯的欄位名稱。
//
// Status 只用來決定 HTTP 狀態碼，不會出現在回應本文；本文格式為 {"code","message","field"}（見 errorBody）。
// handler 與 Service 可直接回傳 *Error 指定狀態碼，toError 會原樣採用。
type Error struct {
	Status  int
	Code    string
	Message string
	Field   string
}

// Error 實作 error 介面，供日誌與 errors.As 使用；回給前端的內容由 errorBody 產生。
func (e *Error) Error() string {
	return e.Code + ": " + e.Message
}

// 共用的固定錯誤。errDevToolsOff 回 404（與不存在的路徑相同），由 NewHTTPHandler 在開發工具未啟用時使用。
var (
	errNotImplemented = &Error{http.StatusNotImplemented, "NOT_IMPLEMENTED", "尚未實作", ""}
	errDevToolsOff    = &Error{http.StatusNotFound, "NOT_FOUND", "開發工具未啟用（WORKBENCH_DEV_TOOLS=1）", ""}
)

// grpcStatus 是 gRPC 狀態碼對應的 HTTP 狀態碼；未列出者為 500。
//
// Python 端（ai/src/dietai/server/rpc.py 等）目前的用法：設定或參數驗證失敗 InvalidArgument → 400；
// 暫存影像或本機路徑找不到 NotFound → 404；路徑屬於鎖定的測試集（SPLIT_LOCKED）PermissionDenied → 403；
// 以 image_id 呼叫但 Python 未開開發模式（DEV_TOOLS_DISABLED）FailedPrecondition → 409；
// Python 未開開發模式時 WorkbenchService 回 Unimplemented → 501；
// Python 沒啟動或連不上為 Unavailable → 503；逾時為 DeadlineExceeded → 504。
// Canceled（使用者中止請求）未列出，會落到 500，但 canceled() 會讓它不記成錯誤日誌。
var grpcStatus = map[codes.Code]int{
	codes.InvalidArgument:    http.StatusBadRequest,
	codes.NotFound:           http.StatusNotFound,
	codes.PermissionDenied:   http.StatusForbidden,
	codes.FailedPrecondition: http.StatusConflict,
	codes.ResourceExhausted:  http.StatusRequestEntityTooLarge,
	codes.Unimplemented:      http.StatusNotImplemented,
	codes.Unavailable:        http.StatusServiceUnavailable,
	codes.DeadlineExceeded:   http.StatusGatewayTimeout,
}

// toError 把任何錯誤轉成 *Error；Python 回傳的錯誤代碼與欄位名稱原樣保留。
//
// 判斷順序：
//  1. 已是 *Error（handler／Service 自行指定狀態碼）→ 原樣回傳。
//  2. 登入、冷啟動的領域錯誤 → domainError 的對應表。
//  3. *aiclient.Error → HTTP 狀態依 gRPC 狀態碼（grpcStatus）決定；Code 取自 Python 以
//     google.rpc.ErrorInfo 回傳的 reason（例如 INVALID_CONFIG、IMAGE_NOT_FOUND），
//     Field 取自 ErrorInfo.metadata["field"]，讓前端把錯誤標在對應的參數欄位上。
//     沒有 ErrorInfo 時 aiclient 依狀態碼補上 AI_UNAVAILABLE、AI_TIMEOUT 等代碼。
//  4. 其他（例如 JSON 解析失敗）→ 500 INTERNAL。
func toError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	if e := domainError(err); e != nil {
		return e
	}
	var aiErr *aiclient.Error
	if errors.As(err, &aiErr) {
		status, ok := grpcStatus[aiErr.Code]
		if !ok {
			status = http.StatusInternalServerError
		}
		return &Error{status, aiErr.Reason, aiErr.Message, aiErr.Field}
	}
	// 未預期的錯誤：訊息原樣回給前端，方便開發時除錯
	return &Error{http.StatusInternalServerError, "INTERNAL", err.Error(), ""}
}

// errorBody 是 HTTP 錯誤回應與 SSE 的 event: error 共用的內容。
// Field 為空時省略（指標為 nil），JSON 中不出現 "field"。
func errorBody(e *Error) api.Error {
	body := api.Error{Code: e.Code, Message: e.Message}
	if e.Field != "" {
		body.Field = &e.Field
	}
	return body
}

// writeError 以 JSON 輸出錯誤回應。必須在尚未寫出任何標頭時呼叫；
// 編碼失敗時狀態碼已送出，無從補救，因此忽略錯誤。
func writeError(w http.ResponseWriter, e *Error) {
	body := errorBody(e)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(body)
}

// trackingWriter 記錄回應標頭是否已送出（WriteHeader 或 Write 被呼叫過），
// 讓 ResponseErrorHandlerFunc 知道還能不能改狀態碼、寫出錯誤本文（見 headerSent）。
type trackingWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *trackingWriter) WriteHeader(status int) {
	// 1xx 是資訊性回應，之後仍可送出最終狀態碼
	if status >= http.StatusOK {
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *trackingWriter) Write(b []byte) (int, error) {
	w.wroteHeader = true
	return w.ResponseWriter.Write(b)
}

// Unwrap 讓 http.ResponseController 能取得底層的 ResponseWriter（SSE 需要 Flush）。
func (w *trackingWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// headerSent 回報 w（或它包裝的 ResponseWriter）是否已送出標頭；找不到 trackingWriter 時視為尚未送出。
func headerSent(w http.ResponseWriter) bool {
	for {
		switch t := w.(type) {
		case *trackingWriter:
			return t.wroteHeader
		case interface{ Unwrap() http.ResponseWriter }:
			w = t.Unwrap()
		default:
			return false
		}
	}
}

// domainError 把登入與冷啟動的領域錯誤對應成 HTTP 錯誤；不是這些錯誤時回傳 nil。
func domainError(err error) *Error {
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		return &Error{http.StatusUnauthorized, "INVALID_CREDENTIALS", err.Error(), ""}
	case errors.Is(err, auth.ErrTooManyAttempts):
		return &Error{http.StatusTooManyRequests, "TOO_MANY_ATTEMPTS", err.Error(), ""}
	case errors.Is(err, auth.ErrUnauthenticated):
		return &Error{http.StatusUnauthorized, "UNAUTHORIZED", err.Error(), ""}
	case errors.Is(err, coldstart.ErrUnavailable):
		return &Error{http.StatusServiceUnavailable, "DB_UNAVAILABLE", err.Error(), ""}
	case errors.Is(err, coldstart.ErrNotFound):
		return &Error{http.StatusNotFound, "NOT_FOUND", "找不到這筆上傳、照片或產品", ""}
	case errors.Is(err, coldstart.ErrClosed):
		return &Error{http.StatusConflict, "SUBMISSION_CLOSED", err.Error(), ""}
	case errors.Is(err, coldstart.ErrStale):
		return &Error{http.StatusPreconditionFailed, "PRECONDITION_FAILED", err.Error(), ""}
	}
	// 欄位驗證錯誤：代碼與欄位由 coldstart 決定，只有檔案過大另外對應 413
	var invalid *coldstart.InvalidError
	if errors.As(err, &invalid) {
		status := http.StatusBadRequest
		if invalid.Code == "IMAGE_TOO_LARGE" {
			status = http.StatusRequestEntityTooLarge
		}
		return &Error{status, invalid.Code, invalid.Message, invalid.Field}
	}
	return nil
}
