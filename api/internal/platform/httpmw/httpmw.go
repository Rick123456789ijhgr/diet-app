// Package httpmw 提供共用的 HTTP 中介層：請求 ID、存取日誌、panic 復原。
package httpmw

import (
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/your-org/diet-app/api/internal/platform/requestid"
)

// 只接受簡單的請求 ID，避免把任意字串寫進日誌與 gRPC metadata
var validID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// Chain 依序套用中介層：Chain(h, a, b) 的執行順序為 a → b → h。
func Chain(h http.Handler, mws ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// RequestID 沿用呼叫端的 X-Request-ID（格式合法時），否則產生新的；寫入 context 與回應標頭。
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestid.Header)
		if !validID.MatchString(id) {
			id = requestid.New()
		}
		w.Header().Set(requestid.Header, id)
		next.ServeHTTP(w, r.WithContext(requestid.With(r.Context(), id)))
	})
}

// AccessLog 記錄每個請求的方法、路徑、狀態碼與耗時。
func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			logger.InfoContext(r.Context(), "http",
				"request_id", requestid.From(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"elapsed_ms", float64(time.Since(start).Microseconds())/1000,
			)
		})
	}
}

// Recover 把 handler 的 panic 轉成 500（JSON 錯誤格式），並記錄 panic 的值。
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if v := recover(); v != nil {
					if v == http.ErrAbortHandler {
						panic(v)
					}
					logger.ErrorContext(r.Context(), "panic",
						"request_id", requestid.From(r.Context()), "panic", v)
					w.Header().Set("Content-Type", "application/json; charset=utf-8")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"code":"INTERNAL","message":"internal error"}`))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// Unwrap 讓 http.ResponseController 能取得底層的 ResponseWriter（SSE 需要 Flush）。
func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}
