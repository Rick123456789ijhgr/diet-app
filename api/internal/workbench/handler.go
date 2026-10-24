package workbench

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"
	"unicode/utf8"

	"google.golang.org/grpc/codes"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/coldstart"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
	"github.com/your-org/diet-app/api/internal/platform/requestid"
)

// MaxUploadBytes 是上傳影像的上限，與 gRPC 訊息上限一致。
const MaxUploadBytes = aiclient.MaxMessageBytes - 1<<20 // 留 1 MB 給其他欄位

// DefaultMaxJSONBytes 是 JSON 請求本文的預設上限（Options.MaxJSONBytes 為 0 時採用）。
// 工作台的 JSON 本文只有參數與設定，1 MB 綽綽有餘。
const DefaultMaxJSONBytes = 1 << 20

// maxMultipartBytes 是 multipart 請求本文的上限：一張影像（MaxUploadBytes）加上 1 MB 給其他欄位與分隔標頭，
// 讓過大的影像仍先由 readUpload 回報 IMAGE_TOO_LARGE。
const maxMultipartBytes = MaxUploadBytes + 1<<20

// maxNameBytes 是上傳時 name 欄位（顯示用名稱）的上限。
const maxNameBytes = 256

// devPrefix 是開發工具路由的前綴；Options.DevTools 為 false 時，NewHTTPHandler 在進入路由前就擋下。
const devPrefix = "/workbench/v1/dev/"

// Options 設定工作台路由。
type Options struct {
	// DevTools 為 false 時，/workbench/v1/dev/* 一律回 404（線上部署不開）。
	DevTools bool
	Logger   *slog.Logger
	// Auth、Coldstart 為 nil 時（沒有設定資料庫），登入與冷啟動路由回 503 DB_UNAVAILABLE。
	Auth      *auth.Service
	Coldstart *coldstart.Service
	// SecureCookie 在 HTTPS 部署時設為 true，工作階段 Cookie 加上 Secure。
	SecureCookie bool
	// MaxJSONBytes 是 JSON（非 multipart）請求本文的上限，超過時回 413 REQUEST_TOO_LARGE；
	// 0 表示使用 DefaultMaxJSONBytes。multipart 上傳另以 MaxUploadBytes 限制。
	MaxJSONBytes int64
}

// NewHTTPHandler 回傳 /workbench/v1/* 的 HTTP handler。
//
// 組成由外而內：開發工具開關 → 讀取工作階段 Cookie（withSession）→ oapi-codegen 產生的路由
// （路徑、查詢參數驗證）→ strict server（解析 JSON／multipart 本文）→ handler → Service。
// 所有錯誤統一輸出 {"code","message","field"}，與成功回應一樣由 OpenAPI 規格定義。
func NewHTTPHandler(svc *Service, opts Options) http.Handler {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	maxJSON := opts.MaxJSONBytes
	if maxJSON <= 0 {
		maxJSON = DefaultMaxJSONBytes
	}
	h := &handler{svc: svc, auth: opts.Auth, cs: opts.Coldstart, secureCookie: opts.SecureCookie}
	if h.cs == nil {
		h.cs = coldstart.NewService(nil, nil, nil, logger) // 所有操作回 ErrUnavailable
	}
	strict := api.NewStrictHandlerWithOptions(h, nil, api.StrictHTTPServerOptions{
		// 請求本文無法解析（JSON 格式錯誤、multipart 標頭錯誤等）一律 400
		// 本文超過上限（見 limitBody）則回 413 REQUEST_TOO_LARGE
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, requestError(err, ""))
		},
		// handler 回傳的 error 都會到這裡：轉成 HTTP 狀態與錯誤代碼（見 toError），只有 5xx 記錄日誌。
		// 產生的程式碼在 Visit*Response（例如 SSE 寫出）失敗時也會呼叫這裡。
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			if headerSent(w) {
				// 標頭已送出（SSE 或影像寫到一半失敗，通常是使用者離開）：狀態碼已無法更改，
				// 再寫錯誤本文只會接在已送出的內容後面，因此只記日誌。使用者取消不算錯誤。
				level := slog.LevelError
				if canceled(r, err) {
					level = slog.LevelDebug
				}
				logger.Log(r.Context(), level, "workbench: 回應寫出中途失敗",
					"request_id", requestid.From(r.Context()), "path", r.URL.Path, "err", err)
				return
			}
			e := toError(err)
			// 使用者取消（換參數、離開頁面）與「沒有設定資料庫」（設定問題，回應已說明）不記成錯誤
			if e.Status >= http.StatusInternalServerError && !canceled(r, err) && e.Code != "DB_UNAVAILABLE" {
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
		// 路徑或查詢參數綁定失敗（例如型別不符）時呼叫
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, &Error{http.StatusBadRequest, "INVALID_REQUEST", err.Error(), ""})
		},
	})
	// 開發工具開關放在最外層：關閉時連請求本文都不解析，也不查詢工作階段
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, devPrefix) && !opts.DevTools {
			writeError(w, errDevToolsOff)
			return
		}
		limitBody(w, r, maxJSON)
		// 包裝 ResponseWriter 以記錄標頭是否已送出（見 ResponseErrorHandlerFunc）
		routes.ServeHTTP(&trackingWriter{ResponseWriter: w}, h.withSession(r))
	})
}

// limitBody 以 http.MaxBytesReader 限制請求本文大小：multipart 上傳為 maxMultipartBytes，其餘（JSON）為 maxJSON。
// 產生的程式碼解碼 JSON 時讀到上限會失敗，錯誤經 RequestErrorHandlerFunc 轉成 413（見 requestError）。
func limitBody(w http.ResponseWriter, r *http.Request, maxJSON int64) {
	if r.Body == nil || r.Body == http.NoBody {
		return
	}
	limit := maxJSON
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err == nil && strings.HasPrefix(mt, "multipart/") {
		limit = maxMultipartBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
}

// requestError 把讀取請求本文的錯誤轉成 *Error：超過本文上限為 413 REQUEST_TOO_LARGE，其餘為 400 INVALID_REQUEST。
func requestError(err error, field string) *Error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return &Error{http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE",
			fmt.Sprintf("請求本文超過 %d 位元組", tooLarge.Limit), field}
	}
	return &Error{http.StatusBadRequest, "INVALID_REQUEST", err.Error(), field}
}

// handler 實作產生的 StrictServerInterface；只做轉接，邏輯在 Service、auth.Service、coldstart.Service。
type handler struct {
	svc          *Service
	auth         *auth.Service
	cs           *coldstart.Service
	secureCookie bool
}

// 編譯期檢查：OpenAPI 規格新增操作而 handler 未實作時，這裡會編譯失敗。
var _ api.StrictServerInterface = (*handler)(nil)

// 以下各方法的 ctx 即 r.Context()：使用者中止請求（換參數、離開頁面）時會被取消，
// 進行中的 gRPC 呼叫也隨之取消。單次呼叫的逾時由 aiclient 補上（預設 30 秒），參數掃描另見 sweepTimeout。

func (h *handler) GetConfigSchemas(ctx context.Context, _ api.GetConfigSchemasRequestObject) (api.GetConfigSchemasResponseObject, error) {
	out, err := h.svc.ConfigSchemas(ctx)
	if err != nil {
		return nil, err
	}
	return api.GetConfigSchemas200JSONResponse(out), nil
}

// PutImage 接收 multipart 上傳的影像，交給 Python 暫存並回傳 image_id。
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

// GetArtifact 回傳影像位元組而非 JSON，因此使用自訂的 artifactResponse。
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

func (h *handler) RunSweep(ctx context.Context, req api.RunSweepRequestObject) (api.RunSweepResponseObject, error) {
	out, err := h.svc.Sweep(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.RunSweep200JSONResponse(out), nil
}

// RunBatch 與 StartE1Run 回傳 SSE 串流。Service 已先收下第一筆（見 openStream），
// 因此一開始就失敗的情況仍以一般 HTTP 錯誤回應；串流開始後的錯誤改以 event: error 回報。
// 串流沒有額外期限，持續到 Python 結束或使用者中止請求（ctx 取消）。
func (h *handler) RunBatch(ctx context.Context, req api.RunBatchRequestObject) (api.RunBatchResponseObject, error) {
	events, err := h.svc.RunBatch(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return sseResponse{events}, nil
}

func (h *handler) ListE1Runs(ctx context.Context, req api.ListE1RunsRequestObject) (api.ListE1RunsResponseObject, error) {
	out, err := h.svc.ListE1Runs(ctx, deref(req.Params.Root))
	if err != nil {
		return nil, err
	}
	return api.ListE1Runs200JSONResponse(out), nil
}

func (h *handler) StartE1Run(ctx context.Context, req api.StartE1RunRequestObject) (api.StartE1RunResponseObject, error) {
	events, err := h.svc.StartE1Run(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return sseResponse{events}, nil
}

func (h *handler) GetE1Run(ctx context.Context, req api.GetE1RunRequestObject) (api.GetE1RunResponseObject, error) {
	out, err := h.svc.GetE1Run(ctx, deref(req.Params.Root), req.RunId)
	if err != nil {
		return nil, err
	}
	return api.GetE1Run200JSONResponse(out), nil
}

// artifactResponse 依 Python 回傳的 content type 輸出影像；ID 對應的內容不會改變，可長期快取。
type artifactResponse struct {
	data        []byte
	contentType string
}

// VisitGetArtifactResponse 寫出影像；回傳的錯誤（通常是使用者已離開）交給 ResponseErrorHandlerFunc。
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
	// 產生的程式碼提供串流式的 multipart.Reader，這裡逐段讀取；
	// 只有 file 與 name 兩段會讀進記憶體，且都以 LimitReader 限制大小，其餘欄位略過。
	var name string
	var data []byte
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", nil, requestError(err, "")
		}
		switch part.FormName() {
		case "file":
			// 多讀 1 位元組：讀到的長度超過上限即表示檔案過大，不必讀完整個本文
			data, err = io.ReadAll(io.LimitReader(part, MaxUploadBytes+1))
			if err != nil {
				return "", nil, requestError(err, "file")
			}
			if len(data) > MaxUploadBytes {
				return "", nil, &Error{http.StatusRequestEntityTooLarge, "IMAGE_TOO_LARGE",
					fmt.Sprintf("影像檔超過 %d MB", MaxUploadBytes>>20), "file"}
			}
			// 明確的 name 欄位優先；沒有時才用上傳檔名
			if name == "" {
				name = part.FileName()
			}
		case "name":
			// 顯示用名稱，只取前 maxNameBytes 位元組；截斷處若切在 UTF-8 字元中間則往前修剪
			b, _ := io.ReadAll(io.LimitReader(part, maxNameBytes))
			name = truncateUTF8(b)
		}
		_ = part.Close()
	}
	if len(data) == 0 {
		return "", nil, &Error{http.StatusBadRequest, "IMAGE_REQUIRED", "缺少影像檔", "file"}
	}
	return name, data, nil
}

// truncateUTF8 去掉 b 結尾不完整的 UTF-8 字元（LimitReader 截斷時可能切在多位元組字元中間）。
// 從結尾往回找最後一個字元的起點，若從起點起的位元組不足一個完整字元就截掉；
// 其他不合法的內容（不是截斷造成的）原樣保留。
func truncateUTF8(b []byte) string {
	for i := len(b) - 1; i >= 0 && i >= len(b)-utf8.UTFMax; i-- {
		if utf8.RuneStart(b[i]) {
			if !utf8.FullRune(b[i:]) {
				b = b[:i]
			}
			break
		}
	}
	return string(b)
}

// deref 把選填的查詢參數轉成字串；未提供時為空字串（交給 Python 用預設值）。
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// canceled 判斷請求是否因使用者取消而失敗（瀏覽器中止請求後，呼叫 Python 會以 Canceled 結束）。
// 三種情況都算：錯誤本身是 context.Canceled、請求的 context 已取消，或 Python 回傳 gRPC Canceled。
func canceled(r *http.Request, err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(r.Context().Err(), context.Canceled) {
		return true
	}
	var aiErr *aiclient.Error
	return errors.As(err, &aiErr) && aiErr.Code == codes.Canceled
}
