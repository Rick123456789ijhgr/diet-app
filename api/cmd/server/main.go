// Command server 啟動 Go 主伺服器。
// 本檔只負責讀取設定、組裝依賴並啟動 HTTP 伺服器，不放業務邏輯。
//
// 環境變數：
//   - PORT：HTTP 埠，預設 8080
//   - AI_GRPC_ADDR：Python gRPC 服務位址，預設 localhost:50051
//   - WORKBENCH_DEV_TOOLS=1：啟用開發工作台的開發工具路由（/workbench/v1/dev/*），只在本機開發時開啟
//   - DATABASE_URL：PostgreSQL；未設定或無法連線時，登入與冷啟動上傳回 503（開發工具照常可用）
//   - MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY、MINIO_BUCKET（預設 diet-coldstart）、
//     MINIO_USE_SSL=1：冷啟動照片的物件儲存
//   - WORKBENCH_SECURE_COOKIE=1：工作階段 Cookie 加上 Secure（HTTPS 部署時）
//
// 工作台前端（建置後以 embed 打包，見 internal/webui）由同一個埠的 / 提供。
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

	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/coldstart"
	"github.com/your-org/diet-app/api/internal/pgstore"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
	"github.com/your-org/diet-app/api/internal/platform/httpmw"
	"github.com/your-org/diet-app/api/internal/platform/objstore"
	"github.com/your-org/diet-app/api/internal/webui"
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
	opts := workbench.Options{
		DevTools: devTools, Logger: logger, SecureCookie: os.Getenv("WORKBENCH_SECURE_COOKIE") == "1",
	}
	if db, objects := openStorage(logger); db != nil {
		defer db.Close()
		opts.Auth = auth.NewService(db)
		if objects != nil {
			opts.Coldstart = coldstart.NewService(db, objects, workbench.NewPreprocessor(ai), logger)
		}
	}
	mux.Handle("/workbench/", workbench.NewHTTPHandler(workbench.NewService(ai), opts))
	// 其餘路徑交給工作台前端（前端路由一律回 index.html）
	mux.Handle("/", webui.Handler())
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
	logger.Info("api listening", "addr", srv.Addr, "ai_grpc_addr", aiAddr, "workbench_dev_tools", devTools, "webui_built", webui.Built(),
		"coldstart", opts.Coldstart != nil)

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

// openStorage 連線資料庫與 MinIO。冷啟動上傳需要兩者；未設定或失敗時記錄原因並回傳 nil，
// 其他功能（開發工具）照常啟動。
func openStorage(logger *slog.Logger) (*pgstore.DB, *objstore.MinIO) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		logger.Info("未設定 DATABASE_URL：登入與冷啟動上傳停用")
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := pgstore.Open(ctx, url)
	if err != nil {
		logger.Warn("無法連線資料庫：登入與冷啟動上傳停用", "err", err)
		return nil, nil
	}
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		logger.Warn("未設定 MINIO_ENDPOINT：冷啟動上傳停用")
		return db, nil
	}
	objects, err := objstore.New(ctx, objstore.Config{
		Endpoint: endpoint, AccessKey: os.Getenv("MINIO_ACCESS_KEY"), SecretKey: os.Getenv("MINIO_SECRET_KEY"),
		Bucket: getenv("MINIO_BUCKET", "diet-coldstart"), UseSSL: os.Getenv("MINIO_USE_SSL") == "1",
	})
	if err != nil {
		logger.Warn("無法連線 MinIO：冷啟動上傳停用", "err", err)
		return db, nil
	}
	return db, objects
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
