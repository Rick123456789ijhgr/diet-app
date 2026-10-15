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
type Error struct {
	Status  int
	Code    string
	Message string
	Field   string
}

func (e *Error) Error() string {
	return e.Code + ": " + e.Message
}

var (
	errNotImplemented = &Error{http.StatusNotImplemented, "NOT_IMPLEMENTED", "尚未實作", ""}
	errDevToolsOff    = &Error{http.StatusNotFound, "NOT_FOUND", "開發工具未啟用（WORKBENCH_DEV_TOOLS=1）", ""}
)

// grpcStatus 是 gRPC 狀態碼對應的 HTTP 狀態碼；未列出者為 500。
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
	return &Error{http.StatusInternalServerError, "INTERNAL", err.Error(), ""}
}

// errorBody 是 HTTP 錯誤回應與 SSE 的 event: error 共用的內容。
func errorBody(e *Error) api.Error {
	body := api.Error{Code: e.Code, Message: e.Message}
	if e.Field != "" {
		body.Field = &e.Field
	}
	return body
}

func writeError(w http.ResponseWriter, e *Error) {
	body := errorBody(e)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(body)
}

// domainError 把登入與冷啟動的領域錯誤對應成 HTTP 錯誤；不是這些錯誤時回傳 nil。
func domainError(err error) *Error {
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		return &Error{http.StatusUnauthorized, "INVALID_CREDENTIALS", err.Error(), ""}
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
