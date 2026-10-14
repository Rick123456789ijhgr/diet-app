package workbench

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
)

// fakeStream 依序回傳訊息，最後回傳 end（nil 表示 io.EOF）。
type fakeStream[T any] struct {
	grpc.ClientStream
	msgs []*T
	end  error
}

func (f *fakeStream[T]) Recv() (*T, error) {
	if len(f.msgs) > 0 {
		m := f.msgs[0]
		f.msgs = f.msgs[1:]
		return m, nil
	}
	if f.end != nil {
		return nil, f.end
	}
	return nil, io.EOF
}

type streamAI struct {
	AIClient
	batch    func(*dietaiv1.RunBatchRequest) (grpc.ServerStreamingClient[dietaiv1.RunBatchResponse], error)
	e1       func(*dietaiv1.StartE1RunRequest) (grpc.ServerStreamingClient[dietaiv1.StartE1RunResponse], error)
	sweep    func(*dietaiv1.SweepRequest) (*dietaiv1.SweepResponse, error)
	listRuns func(*dietaiv1.ListE1RunsRequest) (*dietaiv1.ListE1RunsResponse, error)
	getRun   func(*dietaiv1.GetE1RunRequest) (*dietaiv1.GetE1RunResponse, error)
	sweepCtx context.Context
}

func (f *streamAI) RunBatch(_ context.Context, r *dietaiv1.RunBatchRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[dietaiv1.RunBatchResponse], error) {
	return f.batch(r)
}

func (f *streamAI) StartE1Run(_ context.Context, r *dietaiv1.StartE1RunRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[dietaiv1.StartE1RunResponse], error) {
	return f.e1(r)
}

func (f *streamAI) Sweep(ctx context.Context, r *dietaiv1.SweepRequest, _ ...grpc.CallOption) (*dietaiv1.SweepResponse, error) {
	f.sweepCtx = ctx
	return f.sweep(r)
}

func (f *streamAI) ListE1Runs(_ context.Context, r *dietaiv1.ListE1RunsRequest, _ ...grpc.CallOption) (*dietaiv1.ListE1RunsResponse, error) {
	return f.listRuns(r)
}

func (f *streamAI) GetE1Run(_ context.Context, r *dietaiv1.GetE1RunRequest, _ ...grpc.CallOption) (*dietaiv1.GetE1RunResponse, error) {
	return f.getRun(r)
}

func batchMsgs(jsons ...string) []*dietaiv1.RunBatchResponse {
	out := make([]*dietaiv1.RunBatchResponse, 0, len(jsons))
	for _, j := range jsons {
		out = append(out, &dietaiv1.RunBatchResponse{Json: j})
	}
	return out
}

// sseEvents 讀出整個串流的（事件名稱, data）。
func sseEvents(t *testing.T, resp *http.Response) [][2]string {
	t.Helper()
	var out [][2]string
	event := "message"
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			out = append(out, [2]string{event, strings.TrimPrefix(line, "data: ")})
			event = "message"
		}
	}
	return out
}

func TestRunBatchStreamsSSE(t *testing.T) {
	var got *dietaiv1.RunBatchRequest
	ai := &streamAI{batch: func(r *dietaiv1.RunBatchRequest) (grpc.ServerStreamingClient[dietaiv1.RunBatchResponse], error) {
		got = r
		return &fakeStream[dietaiv1.RunBatchResponse]{msgs: batchMsgs(
			`{"type":"start","total":2}`, `{"type":"row","index":0}`, `{"type":"summary","count":2}`,
		)}, nil
	}}
	resp := postJSON(t, newServerWith(t, ai)+"/workbench/v1/dev/batches",
		`{"folder":"D:/photos","recursive":true,"limit":10,"config":{"blur_min":150}}`)
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q", ct)
	}
	events := sseEvents(t, resp)
	if len(events) != 3 || events[0][1] != `{"type":"start","total":2}` || events[2][0] != "message" {
		t.Errorf("events = %v", events)
	}
	if got.GetFolder() != "D:/photos" || !got.GetRecursive() || got.GetLimit() != 10 || got.GetConfigJson() != `{"blur_min":150}` {
		t.Errorf("request = %v", got)
	}
}

func TestRunBatchFirstErrorIsHTTPError(t *testing.T) {
	ai := &streamAI{batch: func(*dietaiv1.RunBatchRequest) (grpc.ServerStreamingClient[dietaiv1.RunBatchResponse], error) {
		return &fakeStream[dietaiv1.RunBatchResponse]{end: &aiclient.Error{
			Code: codes.PermissionDenied, Reason: "SPLIT_LOCKED", Message: "測試集已鎖定"}}, nil
	}}
	resp := postJSON(t, newServerWith(t, ai)+"/workbench/v1/dev/batches", `{"folder":"x/splits/test"}`)
	if resp.StatusCode != http.StatusForbidden || decode[api.Error](t, resp).Code != "SPLIT_LOCKED" {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestStreamErrorAfterStartIsErrorEvent(t *testing.T) {
	ai := &streamAI{e1: func(r *dietaiv1.StartE1RunRequest) (grpc.ServerStreamingClient[dietaiv1.StartE1RunResponse], error) {
		if len(r.GetArms()) != 1 || r.GetNCodes() != 2 {
			t.Errorf("request = %v", r)
		}
		return &fakeStream[dietaiv1.StartE1RunResponse]{
			msgs: []*dietaiv1.StartE1RunResponse{{Json: `{"type":"start","total":4}`}},
			end:  &aiclient.Error{Code: codes.InvalidArgument, Reason: "INVALID_PARAMS", Message: "boom", Field: "n_codes"},
		}, nil
	}}
	resp := postJSON(t, newServerWith(t, ai)+"/workbench/v1/dev/e1/runs", `{"arms":["a0_raw"],"n_codes":2}`)
	events := sseEvents(t, resp)
	// 內容與 HTTP 錯誤回應相同，包含出錯的欄位
	if len(events) != 2 || events[1][0] != "error" ||
		events[1][1] != `{"code":"INVALID_PARAMS","field":"n_codes","message":"boom"}` {
		t.Errorf("events = %v", events)
	}
}

func TestSweepAndE1Runs(t *testing.T) {
	var gotRun *dietaiv1.GetE1RunRequest
	var gotList *dietaiv1.ListE1RunsRequest
	ai := &streamAI{
		sweep: func(r *dietaiv1.SweepRequest) (*dietaiv1.SweepResponse, error) {
			if r.GetTarget() != "barcode" || r.GetParamsJson() != `{"axis":"rotate_deg"}` {
				t.Errorf("sweep request = %v", r)
			}
			return &dietaiv1.SweepResponse{Json: `{"overall":{"raw":0.5}}`}, nil
		},
		listRuns: func(r *dietaiv1.ListE1RunsRequest) (*dietaiv1.ListE1RunsResponse, error) {
			gotList = r
			return &dietaiv1.ListE1RunsResponse{Json: `{"runs":[]}`}, nil
		},
		getRun: func(r *dietaiv1.GetE1RunRequest) (*dietaiv1.GetE1RunResponse, error) {
			gotRun = r
			return &dietaiv1.GetE1RunResponse{Json: `{"arms":["a0_raw"]}`}, nil
		},
	}
	base := newServerWith(t, ai) + "/workbench/v1/dev"
	sw := decode[map[string]any](t, postJSON(t, base+"/sweeps", `{"target":"barcode","params":{"axis":"rotate_deg"}}`))
	if sw["overall"].(map[string]any)["raw"] != 0.5 {
		t.Errorf("sweep = %v", sw)
	}
	// 條碼掃描可能超過 30 秒，期限要比預設的長
	if dl, ok := ai.sweepCtx.Deadline(); !ok || time.Until(dl) <= aiclient.DefaultTimeout {
		t.Errorf("sweep deadline = %v, %v", dl, ok)
	}

	get := func(url string) *http.Response {
		resp, err := http.Get(url)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = resp.Body.Close() })
		return resp
	}
	if resp := get(base + "/e1/runs?root=D:/runs"); resp.StatusCode != 200 || gotList.GetRoot() != "D:/runs" {
		t.Errorf("list status %d root %q", resp.StatusCode, gotList.GetRoot())
	}
	tests := []struct {
		name, url, wantDir string
		wantStatus         int
	}{
		{"只給名稱", base + "/e1/runs/20261014-run", "20261014-run", 200},
		{"指定資料夾", base + "/e1/runs/20261014-run?root=D:/runs", "D:/runs/20261014-run", 200},
		{"不得是上層目錄", base + "/e1/runs/%2E%2E", "", 400},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotRun = nil
			resp := get(tt.url)
			if resp.StatusCode != tt.wantStatus {
				t.Fatalf("status = %d", resp.StatusCode)
			}
			if tt.wantDir != "" && gotRun.GetRunDir() != tt.wantDir {
				t.Errorf("run_dir = %q", gotRun.GetRunDir())
			}
		})
	}
}
