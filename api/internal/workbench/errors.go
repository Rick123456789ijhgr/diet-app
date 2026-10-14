package workbench

import (
	"encoding/json"
	"errors"
	"net/http"

	"google.golang.org/grpc/codes"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
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
