package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"google.golang.org/grpc"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
)

// 參數掃描、資料夾批次、E1（階段 3）。批次與 E1 快速執行以 Server-Sent Events 逐筆回報。
//
// 串流的生命週期：handler 回傳 sseResponse 後，產生的程式碼在同一個 ServeHTTP 中呼叫 write，
// 逐筆把 gRPC 訊息轉寫成 SSE。gRPC 串流綁定請求的 context：使用者關閉頁面或中止請求時 context
// 被取消，Recv 隨即以 Canceled 結束；ServeHTTP 返回後 net/http 也會取消該 context，
// 因此 gRPC 串流的資源一定會釋放，這裡不需要另外 cancel。串流本身不設期限（aiclient 的
// 串流攔截器也不補預設逾時），批次可能跑很久，由使用者決定何時中止。

// Events 逐筆取出 Python 串流回傳的 JSON；結束時回傳 io.EOF。
// 抽成介面讓 sseResponse 不依賴 gRPC，測試可用假串流。
type Events interface {
	Next() (string, error)
}

// jsonMessage 是只帶一個 JSON 字串的串流訊息（RunBatchResponse、StartE1RunResponse）。
// 以泛型約束「*T 有 GetJson()」，讓兩種訊息共用 grpcEvents 與 openStream。
type jsonMessage[T any] interface {
	*T
	GetJson() string
}

// grpcEvents 把 gRPC 串流轉成 Events；第一筆已先收下（見 openStream）。
type grpcEvents[T any, PT jsonMessage[T]] struct {
	stream grpc.ServerStreamingClient[T]
	first  *string
}

// Next 先交出 openStream 預先收下的第一筆，之後才向串流 Recv。
// 串流錯誤經 aiclient.FromError 轉成 *aiclient.Error，保留 Python 的錯誤代碼與欄位。
func (e *grpcEvents[T, PT]) Next() (string, error) {
	if e.first != nil {
		s := *e.first
		e.first = nil
		return s, nil
	}
	msg, err := e.stream.Recv()
	if err != nil {
		if errors.Is(err, io.EOF) {
			return "", io.EOF
		}
		return "", aiclient.FromError(err)
	}
	return PT(msg).GetJson(), nil
}

// openStream 先收第一筆：路徑被鎖定、參數錯誤等一開始就失敗的情況以 HTTP 錯誤回應，
// 而不是在已開始的事件串流中途回報。
func openStream[T any, PT jsonMessage[T]](stream grpc.ServerStreamingClient[T], err error) (Events, error) {
	if err != nil {
		return nil, err
	}
	msg, err := stream.Recv()
	if err != nil {
		if errors.Is(err, io.EOF) {
			// 串流沒有任何訊息就正常結束：以空字串佔第一筆（write 會略過空字串），
			// 下一次 Next 再由 Recv 取得 io.EOF
			empty := ""
			return &grpcEvents[T, PT]{stream: stream, first: &empty}, nil
		}
		// 第一筆就失敗（例如 SPLIT_LOCKED、INVALID_PARAMS）：尚未寫出任何回應，可以回一般 HTTP 錯誤
		return nil, aiclient.FromError(err)
	}
	first := PT(msg).GetJson()
	return &grpcEvents[T, PT]{stream: stream, first: &first}, nil
}

// sweepTimeout 是參數掃描的期限：條碼掃描最多 30 個等級 × 30 個樣本、每個都跑完整階梯，
// 預設的 aiclient.DefaultTimeout（30 秒）不夠。
const sweepTimeout = 3 * time.Minute

// Sweep 參數掃描（target 為 quality 或 barcode）。掃描是一次性的 unary 呼叫，結果整份回傳。
func (s *Service) Sweep(ctx context.Context, req api.SweepRequest) (api.FreeJson, error) {
	params, err := objectJSON(req.Params)
	if err != nil {
		return nil, err
	}
	// 設了期限後 aiclient 的攔截器就不會再套用 30 秒預設逾時；使用者中止請求時仍會提早取消
	ctx, cancel := context.WithTimeout(ctx, sweepTimeout)
	defer cancel()
	resp, err := s.ai.Sweep(ctx, &dietaiv1.SweepRequest{Target: string(req.Target), ParamsJson: params})
	if err != nil {
		return nil, err
	}
	return object(resp.GetJson())
}

// RunBatch 資料夾批次；folder 也可以是單一檔案（回傳的列附 image_id，供檢視該張）。
func (s *Service) RunBatch(ctx context.Context, req api.BatchRequest) (Events, error) {
	cfg, err := overrideJSON(req.Config)
	if err != nil {
		return nil, err
	}
	// 選填欄位未提供時保留 proto 零值（零值的意義由 Python 決定）
	r := &dietaiv1.RunBatchRequest{Folder: req.Folder, ConfigJson: cfg}
	if req.Recursive != nil {
		r.Recursive = *req.Recursive
	}
	if req.Limit != nil {
		r.Limit = int32(*req.Limit)
	}
	// ctx 為請求的 context（不另設期限），見檔案開頭的生命週期說明
	return openStream[dietaiv1.RunBatchResponse](s.ai.RunBatch(ctx, r))
}

// ListE1Runs 列出 E1 執行結果；root 為空時用預設的結果資料夾。
func (s *Service) ListE1Runs(ctx context.Context, root string) (api.FreeJson, error) {
	resp, err := s.ai.ListE1Runs(ctx, &dietaiv1.ListE1RunsRequest{Root: root})
	if err != nil {
		return nil, err
	}
	return object(resp.GetJson())
}

// GetE1Run 一次執行的彙整；runID 只能是資料夾名稱（不得含路徑）。
func (s *Service) GetE1Run(ctx context.Context, root, runID string) (api.FreeJson, error) {
	// run_id 來自 URL 路徑，先擋掉可以跳出結果資料夾的值（路徑分隔字元、. 與 ..）
	if runID == "" || runID == "." || runID == ".." || strings.ContainsAny(runID, `/\`) {
		return nil, &Error{http.StatusBadRequest, "INVALID_PARAMS", "run_id 只能是執行資料夾名稱", "run_id"}
	}
	// root 為空時只送資料夾名稱，由 Python 接上預設的結果資料夾。
	// Windows 路徑先把 \ 換成 /，才能用 path.Join（path 套件只認 /）。root 本身不檢查，可指向任何本機資料夾，
	// 測試集鎖定由 Python 端負責。
	runDir := runID
	if root != "" {
		runDir = path.Join(strings.ReplaceAll(root, `\`, "/"), runID)
	}
	resp, err := s.ai.GetE1Run(ctx, &dietaiv1.GetE1RunRequest{RunDir: runDir})
	if err != nil {
		return nil, err
	}
	return object(resp.GetJson())
}

// StartE1Run 以合成資料快速執行 E1。
func (s *Service) StartE1Run(ctx context.Context, req api.StartE1RunRequest) (Events, error) {
	r := &dietaiv1.StartE1RunRequest{Arms: req.Arms}
	if req.NCodes != nil {
		r.NCodes = int32(*req.NCodes)
	}
	if req.Root != nil {
		r.Root = *req.Root
	}
	return openStream[dietaiv1.StartE1RunResponse](s.ai.StartE1Run(ctx, r))
}

// object 解析 Python 回傳的 JSON 物件；與 freeJSON 不同，這裡的回應一定要有內容，空字串視為錯誤。
func object(s string) (api.FreeJson, error) {
	var m api.FreeJson
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, fmt.Errorf("workbench: 解析 Python 回傳的 JSON: %w", err)
	}
	return m, nil
}

// sseResponse 以 Server-Sent Events 逐筆輸出；中途出錯時送出 event: error 後結束。
// 同一型別同時實作 RunBatch 與 StartE1Run 兩個產生的回應介面。
type sseResponse struct {
	events Events
}

func (r sseResponse) VisitRunBatchResponse(w http.ResponseWriter) error   { return r.write(w) }
func (r sseResponse) VisitStartE1RunResponse(w http.ResponseWriter) error { return r.write(w) }

// write 寫出 SSE。每筆訊息為一行 "data: <JSON>"，後接空行；每筆寫完立即 Flush，前端才能即時看到進度。
// 標頭一旦送出就無法再改 HTTP 狀態，因此串流中途的錯誤改以 event: error 傳遞（內容同 HTTP 錯誤本文）。
func (r sseResponse) write(w http.ResponseWriter) error {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no") // 反向代理不要緩衝
	w.WriteHeader(http.StatusOK)
	// ResponseController 經由 Unwrap 穿透中介層包裝的 ResponseWriter（見 httpmw.statusRecorder）取得 Flush
	rc := http.NewResponseController(w)
	for {
		data, err := r.events.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			body, _ := json.Marshal(errorBody(toError(err)))
			_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", body)
			_ = rc.Flush()
			return nil
		}
		// 空字串沒有內容可送（例如 openStream 的空串流佔位），略過
		if data == "" {
			continue
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			return err // 使用者已離開
		}
		if err := rc.Flush(); err != nil {
			return err
		}
	}
}
