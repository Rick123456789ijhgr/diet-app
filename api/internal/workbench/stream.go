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

	"google.golang.org/grpc"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
)

// 參數掃描、資料夾批次、E1（階段 3）。批次與 E1 快速執行以 Server-Sent Events 逐筆回報。

// Events 逐筆取出 Python 串流回傳的 JSON；結束時回傳 io.EOF。
type Events interface {
	Next() (string, error)
}

// jsonMessage 是只帶一個 JSON 字串的串流訊息（RunBatchResponse、StartE1RunResponse）。
type jsonMessage[T any] interface {
	*T
	GetJson() string
}

// grpcEvents 把 gRPC 串流轉成 Events；第一筆已先收下（見 openStream）。
type grpcEvents[T any, PT jsonMessage[T]] struct {
	stream grpc.ServerStreamingClient[T]
	first  *string
}

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
			empty := ""
			return &grpcEvents[T, PT]{stream: stream, first: &empty}, nil
		}
		return nil, aiclient.FromError(err)
	}
	first := PT(msg).GetJson()
	return &grpcEvents[T, PT]{stream: stream, first: &first}, nil
}

// Sweep 參數掃描（target 為 quality 或 barcode）。
func (s *Service) Sweep(ctx context.Context, req api.SweepRequest) (api.FreeJson, error) {
	params, err := objectJSON(req.Params)
	if err != nil {
		return nil, err
	}
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
	r := &dietaiv1.RunBatchRequest{Folder: req.Folder, ConfigJson: cfg}
	if req.Recursive != nil {
		r.Recursive = *req.Recursive
	}
	if req.Limit != nil {
		r.Limit = int32(*req.Limit)
	}
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
	if runID == "" || runID == "." || runID == ".." || strings.ContainsAny(runID, `/\`) {
		return nil, &Error{http.StatusBadRequest, "INVALID_PARAMS", "run_id 只能是執行資料夾名稱", "run_id"}
	}
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

func object(s string) (api.FreeJson, error) {
	var m api.FreeJson
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, fmt.Errorf("workbench: 解析 Python 回傳的 JSON: %w", err)
	}
	return m, nil
}

// sseResponse 以 Server-Sent Events 逐筆輸出；中途出錯時送出 event: error 後結束。
type sseResponse struct {
	events Events
}

func (r sseResponse) VisitRunBatchResponse(w http.ResponseWriter) error   { return r.write(w) }
func (r sseResponse) VisitStartE1RunResponse(w http.ResponseWriter) error { return r.write(w) }

func (r sseResponse) write(w http.ResponseWriter) error {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no") // 反向代理不要緩衝
	w.WriteHeader(http.StatusOK)
	rc := http.NewResponseController(w)
	for {
		data, err := r.events.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			e := toError(err)
			body, _ := json.Marshal(api.Error{Code: e.Code, Message: e.Message})
			_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", body)
			_ = rc.Flush()
			return nil
		}
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
