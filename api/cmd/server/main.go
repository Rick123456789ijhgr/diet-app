// Command server 啟動 Go 主伺服器。
// 本檔只負責讀取設定、組裝依賴並啟動 HTTP 伺服器，不放業務邏輯。
package main

import (
	"log/slog"
	"net/http"
	"os"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	// TODO: 依 openapi/openapi.yaml 以 oapi-codegen 產生路由後註冊各領域 handler

	addr := ":" + getenv("PORT", "8080")
	logger.Info("api listening", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		logger.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
