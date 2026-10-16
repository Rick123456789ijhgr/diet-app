package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHandlerServesFilesAndFallsBackToIndex(t *testing.T) {
	h := newHandler(fstest.MapFS{
		"index.html":       {Data: []byte("<html>index</html>")},
		"icon.svg":         {Data: []byte("<svg/>")},
		"assets/app-1a.js": {Data: []byte("console.log(1)")},
	})
	tests := []struct {
		name, method, path string
		wantStatus         int
		wantBody, wantCC   string
	}{
		{"首頁", http.MethodGet, "/", 200, "index", "no-cache"},
		{"前端路由回 index.html", http.MethodGet, "/module1/quality", 200, "index", "no-cache"},
		{"靜態檔", http.MethodGet, "/icon.svg", 200, "<svg/>", ""},
		{"帶雜湊的資源長期快取", http.MethodGet, "/assets/app-1a.js", 200, "console", "immutable"},
		{"找不到的資源不回 index.html", http.MethodGet, "/assets/old-9z.js", 404, "", ""},
		{"不接受 POST", http.MethodPost, "/", 405, "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d", rec.Code)
			}
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("body = %q", rec.Body.String())
			}
			if !strings.Contains(rec.Header().Get("Cache-Control"), tt.wantCC) {
				t.Errorf("Cache-Control = %q", rec.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestNotBuiltExplainsHowToBuild(t *testing.T) {
	rec := httptest.NewRecorder()
	notBuilt(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "make workbench") {
		t.Errorf("status %d body %q", rec.Code, rec.Body.String())
	}
}
