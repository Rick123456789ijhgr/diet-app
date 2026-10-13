package workbench

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
	"github.com/your-org/diet-app/api/internal/platform/requestid"
)

// MaxUploadBytes 是上傳影像的上限，與 gRPC 訊息上限一致。
const MaxUploadBytes = aiclient.MaxMessageBytes - 1<<20 // 留 1 MB 給其他欄位

const devPrefix = "/workbench/v1/dev/"

// Options 設定工作台路由。
type Options struct {
	// DevTools 為 false 時，/workbench/v1/dev/* 一律回 404（線上部署不開）。
	DevTools bool
	Logger   *slog.Logger
}

// NewHTTPHandler 回傳 /workbench/v1/* 的 HTTP handler。
func NewHTTPHandler(svc *Service, opts Options) http.Handler {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	strict := api.NewStrictHandlerWithOptions(&handler{svc: svc}, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, &Error{http.StatusBadRequest, "INVALID_REQUEST", err.Error(), ""})
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			e := toError(err)
			if e.Status >= http.StatusInternalServerError {
				logger.ErrorContext(r.Context(), "workbench",
					"request_id", requestid.From(r.Context()), "path", r.URL.Path, "err", err)
			}
			writeError(w, e)
		},
	})
	mux := http.NewServeMux()
	// 不存在的路徑也回 JSON 錯誤格式（產生的路由比這個前綴更精確，會優先比對）
	mux.HandleFunc("/workbench/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, &Error{http.StatusNotFound, "NOT_FOUND", "找不到路徑 " + r.URL.Path, ""})
	})
	routes := api.HandlerWithOptions(strict, api.StdHTTPServerOptions{
		BaseRouter: mux,
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, &Error{http.StatusBadRequest, "INVALID_REQUEST", err.Error(), ""})
		},
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, devPrefix) && !opts.DevTools {
			writeError(w, errDevToolsOff)
			return
		}
		routes.ServeHTTP(w, r)
	})
}

// handler 實作產生的 StrictServerInterface；只做轉接，邏輯在 Service。
type handler struct {
	svc *Service
}

var _ api.StrictServerInterface = (*handler)(nil)

func (h *handler) GetConfigSchemas(ctx context.Context, _ api.GetConfigSchemasRequestObject) (api.GetConfigSchemasResponseObject, error) {
	out, err := h.svc.ConfigSchemas(ctx)
	if err != nil {
		return nil, err
	}
	return api.GetConfigSchemas200JSONResponse(out), nil
}

func (h *handler) PutImage(ctx context.Context, req api.PutImageRequestObject) (api.PutImageResponseObject, error) {
	name, data, err := readUpload(req.Body)
	if err != nil {
		return nil, err
	}
	out, err := h.svc.PutImage(ctx, name, data)
	if err != nil {
		return nil, err
	}
	return api.PutImage201JSONResponse(out), nil
}

func (h *handler) SynthesizeImage(ctx context.Context, req api.SynthesizeImageRequestObject) (api.SynthesizeImageResponseObject, error) {
	out, err := h.svc.Synthesize(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.SynthesizeImage201JSONResponse(out), nil
}

func (h *handler) DegradeImage(ctx context.Context, req api.DegradeImageRequestObject) (api.DegradeImageResponseObject, error) {
	out, err := h.svc.Degrade(ctx, req.ImageId, req.Body.Degradation)
	if err != nil {
		return nil, err
	}
	return api.DegradeImage201JSONResponse(out), nil
}

func (h *handler) RenderView(ctx context.Context, req api.RenderViewRequestObject) (api.RenderViewResponseObject, error) {
	out, err := h.svc.RenderView(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.RenderView200JSONResponse(out), nil
}

func (h *handler) GetArtifact(ctx context.Context, req api.GetArtifactRequestObject) (api.GetArtifactResponseObject, error) {
	data, contentType, err := h.svc.Artifact(ctx, req.ArtifactId)
	if err != nil {
		return nil, err
	}
	return artifactResponse{data: data, contentType: contentType}, nil
}

func (h *handler) CheckQuality(ctx context.Context, req api.CheckQualityRequestObject) (api.CheckQualityResponseObject, error) {
	out, err := h.svc.CheckQuality(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.CheckQuality200JSONResponse(out), nil
}

func (h *handler) DecodeBarcode(ctx context.Context, req api.DecodeBarcodeRequestObject) (api.DecodeBarcodeResponseObject, error) {
	out, err := h.svc.DecodeBarcode(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.DecodeBarcode200JSONResponse(out), nil
}

func (h *handler) LocateInvoiceQr(ctx context.Context, req api.LocateInvoiceQrRequestObject) (api.LocateInvoiceQrResponseObject, error) {
	out, err := h.svc.LocateInvoiceQr(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.LocateInvoiceQr200JSONResponse(out), nil
}

func (h *handler) PreprocessLabel(ctx context.Context, req api.PreprocessLabelRequestObject) (api.PreprocessLabelResponseObject, error) {
	out, err := h.svc.PreprocessLabel(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.PreprocessLabel200JSONResponse(out), nil
}

func (h *handler) PreprocessFood(ctx context.Context, req api.PreprocessFoodRequestObject) (api.PreprocessFoodResponseObject, error) {
	out, err := h.svc.PreprocessFood(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.PreprocessFood200JSONResponse(out), nil
}

// 以下於之後的階段實作（任務書第 4 節）。

func (h *handler) Login(context.Context, api.LoginRequestObject) (api.LoginResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) Logout(context.Context, api.LogoutRequestObject) (api.LogoutResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) GetMe(context.Context, api.GetMeRequestObject) (api.GetMeResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) RunSweep(context.Context, api.RunSweepRequestObject) (api.RunSweepResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) RunBatch(context.Context, api.RunBatchRequestObject) (api.RunBatchResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) ListE1Runs(context.Context, api.ListE1RunsRequestObject) (api.ListE1RunsResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) StartE1Run(context.Context, api.StartE1RunRequestObject) (api.StartE1RunResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) GetE1Run(context.Context, api.GetE1RunRequestObject) (api.GetE1RunResponseObject, error) {
	return nil, errNotImplemented
}

// artifactResponse 依 Python 回傳的 content type 輸出影像；ID 對應的內容不會改變，可長期快取。
type artifactResponse struct {
	data        []byte
	contentType string
}

func (r artifactResponse) VisitGetArtifactResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", r.contentType)
	w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
	w.WriteHeader(http.StatusOK)
	_, err := io.Copy(w, bytes.NewReader(r.data))
	return err
}

// readUpload 讀取 multipart 的 file 與 name 欄位；檔案超過 MaxUploadBytes 時回 413。
func readUpload(mr *multipart.Reader) (string, []byte, error) {
	if mr == nil {
		return "", nil, &Error{http.StatusBadRequest, "IMAGE_REQUIRED", "缺少影像檔", "file"}
	}
	var name string
	var data []byte
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", nil, &Error{http.StatusBadRequest, "INVALID_REQUEST", err.Error(), ""}
		}
		switch part.FormName() {
		case "file":
			data, err = io.ReadAll(io.LimitReader(part, MaxUploadBytes+1))
			if err != nil {
				return "", nil, &Error{http.StatusBadRequest, "INVALID_REQUEST", err.Error(), "file"}
			}
			if len(data) > MaxUploadBytes {
				return "", nil, &Error{http.StatusRequestEntityTooLarge, "IMAGE_TOO_LARGE",
					fmt.Sprintf("影像檔超過 %d MB", MaxUploadBytes>>20), "file"}
			}
			if name == "" {
				name = part.FileName()
			}
		case "name":
			b, _ := io.ReadAll(io.LimitReader(part, 256))
			name = string(b)
		}
		_ = part.Close()
	}
	if len(data) == 0 {
		return "", nil, &Error{http.StatusBadRequest, "IMAGE_REQUIRED", "缺少影像檔", "file"}
	}
	return name, data, nil
}
