// Command server 啟動 Go 主伺服器。
// 本檔只負責讀取設定、組裝依賴並啟動 HTTP 伺服器，不放業務邏輯。
//
// 環境變數：
//   - PORT：HTTP 埠，預設 8080
//   - AI_GRPC_ADDR：Python gRPC 服務位址，預設 localhost:50051
//   - WORKBENCH_DEV_TOOLS=1：啟用開發工作台的開發工具路由（/workbench/v1/dev/*），只在本機開發時開啟
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/your-org/diet-app/api/internal/platform/aiclient"
	"github.com/your-org/diet-app/api/internal/platform/httpmw"
	"github.com/your-org/diet-app/api/internal/workbench"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	aiAddr := getenv("AI_GRPC_ADDR", "localhost:50051")
	devTools := os.Getenv("WORKBENCH_DEV_TOOLS") == "1"

	ai, err := aiclient.New(aiAddr)
	if err != nil {
		return err
	}
	defer ai.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("/workbench/", workbench.NewHTTPHandler(
		workbench.NewService(ai), workbench.Options{DevTools: devTools, Logger: logger},
	))
	// TODO: 依 openapi/openapi.yaml 以 oapi-codegen 產生路由後註冊各領域 handler

	srv := &http.Server{
		Addr:              ":" + getenv("PORT", "8080"),
		Handler:           httpmw.Chain(mux, httpmw.RequestID, httpmw.AccessLog(logger), httpmw.Recover(logger)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	logger.Info("api listening", "addr", srv.Addr, "ai_grpc_addr", aiAddr, "workbench_dev_tools", devTools)

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
