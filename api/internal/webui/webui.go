// Package webui 提供建置後的工作台前端（workbench/，ADR 0003）。
//
// 前端以 vite build 輸出到 static/app/（不進 git），編譯時以 embed 打包進執行檔；
// 尚未建置時顯示說明頁。/workbench/v1/* 的 API 由 internal/workbench 處理，比本 handler 的 "/" 更精確。
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:static
var static embed.FS

// Built 回報執行檔是否含建置後的前端。
func Built() bool {
	_, err := fs.Stat(static, "static/app/index.html")
	return err == nil
}

// Handler 回傳提供前端的 handler：存在的檔案直接回傳，其餘路徑一律回 index.html（前端路由）。
func Handler() http.Handler {
	if !Built() {
		return http.HandlerFunc(notBuilt)
	}
	app, err := fs.Sub(static, "static/app")
	if err != nil {
		panic(err) // Built() 已確認存在
	}
	return newHandler(app)
}

func newHandler(app fs.FS) http.Handler {
	return handler{app: app, files: http.FileServerFS(app)}
}

type handler struct {
	app   fs.FS
	files http.Handler
}

func (h handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name != "" && name != "index.html" {
		if st, err := fs.Stat(h.app, name); err == nil && !st.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				// Vite 輸出的檔名含內容雜湊，可長期快取
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			h.files.ServeHTTP(w, r)
			return
		}
		if path.Ext(name) != "" {
			http.NotFound(w, r) // 找不到的靜態檔（例如舊版的 assets）不回 index.html
			return
		}
	}
	// index.html 不快取：前端更新後重新整理即可拿到新版
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, h.app, "index.html")
}

func notBuilt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><title>工作台尚未建置</title>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;line-height:1.7">
<h1>工作台前端尚未建置</h1>
<p>這個 Go 執行檔沒有包含前端。請在專案根目錄執行 <code>make workbench</code>
（或雙擊 <code>啟動工作台.bat</code>），會先建置前端再啟動服務。</p>
<p>只改前端時可用 <code>make workbench-dev</code>（Vite 熱更新，網址 http://localhost:5173）。</p>
</body>`))
}
