package httpmw

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/your-org/diet-app/api/internal/platform/requestid"
)

func TestRequestID(t *testing.T) {
	tests := []struct {
		name, incoming string
		keep           bool
	}{
		{"沿用合法的 ID", "abc-123", true},
		{"沒有就產生", "", false},
		{"不合法就換掉", "bad id\n", false},
		{"過長就換掉", strings.Repeat("a", 65), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var seen string
			h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				seen = requestid.From(r.Context())
			}))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.incoming != "" {
				req.Header.Set(requestid.Header, tt.incoming)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if seen == "" || rec.Header().Get(requestid.Header) != seen {
				t.Fatalf("context %q, header %q", seen, rec.Header().Get(requestid.Header))
			}
			if (seen == tt.incoming) != tt.keep {
				t.Errorf("id = %q, incoming %q, keep %v", seen, tt.incoming, tt.keep)
			}
		})
	}
}

func TestRecoverAndAccessLog(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	h := Chain(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }),
		RequestID, AccessLog(logger), Recover(logger))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"INTERNAL"`) {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(logs.String(), `"panic":"boom"`) || !strings.Contains(logs.String(), `"status":500`) {
		t.Errorf("logs = %s", logs.String())
	}
}
