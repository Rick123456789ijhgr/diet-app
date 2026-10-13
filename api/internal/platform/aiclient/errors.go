package aiclient

import (
	"errors"
	"fmt"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// 不是由 Python 明確回傳、而是連線層級的錯誤代碼。
const (
	ReasonUnavailable    = "AI_UNAVAILABLE"
	ReasonTimeout        = "AI_TIMEOUT"
	ReasonNotImplemented = "NOT_IMPLEMENTED"
	ReasonInternal       = "INTERNAL"
)

// Error 是呼叫 Python 失敗的結果。Reason 為英文錯誤代碼（例如 IMAGE_NOT_FOUND），
// Field 為出錯的欄位名稱（設定驗證失敗時）。
type Error struct {
	Code    codes.Code
	Reason  string
	Message string
	Field   string
}

func (e *Error) Error() string {
	return fmt.Sprintf("ai: %s (%s): %s", e.Reason, e.Code, e.Message)
}

// FromError 把 gRPC 錯誤轉成 *Error；已經是 *Error 時原樣回傳。
func FromError(err error) error {
	if err == nil {
		return nil
	}
	var aiErr *Error
	if errors.As(err, &aiErr) {
		return err
	}
	st, ok := status.FromError(err)
	if !ok {
		return &Error{Code: codes.Unknown, Reason: ReasonInternal, Message: err.Error()}
	}
	e := &Error{Code: st.Code(), Message: st.Message()}
	for _, d := range st.Details() {
		if info, ok := d.(*errdetails.ErrorInfo); ok {
			e.Reason = info.GetReason()
			e.Field = info.GetMetadata()["field"]
			break
		}
	}
	if e.Reason == "" {
		e.Reason = defaultReason(st.Code())
	}
	return e
}

func defaultReason(c codes.Code) string {
	switch c {
	case codes.Unavailable:
		return ReasonUnavailable
	case codes.DeadlineExceeded:
		return ReasonTimeout
	case codes.Unimplemented:
		return ReasonNotImplemented
	default:
		return ReasonInternal
	}
}
