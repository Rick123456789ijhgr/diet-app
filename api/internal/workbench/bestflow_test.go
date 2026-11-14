package workbench

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"google.golang.org/grpc"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
)

// bestFlowAI 是找最佳流程四個 RPC 的假實作，記下收到的請求。
type bestFlowAI struct {
	AIClient
	start *dietaiv1.StartBestFlowRunRequest
	get   *dietaiv1.GetBestFlowRunRequest
	set   *dietaiv1.SetBestFlowTruthRequest
}

func (f *bestFlowAI) StartBestFlowRun(_ context.Context, r *dietaiv1.StartBestFlowRunRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[dietaiv1.StartBestFlowRunResponse], error) {
	f.start = r
	return &fakeStream[dietaiv1.StartBestFlowRunResponse]{msgs: []*dietaiv1.StartBestFlowRunResponse{
		{Json: `{"type":"start","total":2}`},
		{Json: `{"type":"done","name":"20261105-bestflow"}`},
	}}, nil
}

func (f *bestFlowAI) ListBestFlowPresets(_ context.Context, _ *dietaiv1.ListBestFlowPresetsRequest, _ ...grpc.CallOption) (*dietaiv1.ListBestFlowPresetsResponse, error) {
	return &dietaiv1.ListBestFlowPresetsResponse{Json: `{"presets":[{"id":"raw_only"}]}`}, nil
}

func (f *bestFlowAI) GetBestFlowRun(_ context.Context, r *dietaiv1.GetBestFlowRunRequest, _ ...grpc.CallOption) (*dietaiv1.GetBestFlowRunResponse, error) {
	f.get = r
	return &dietaiv1.GetBestFlowRunResponse{Json: `{"counts":{"images":2}}`}, nil
}

func (f *bestFlowAI) SetBestFlowTruth(_ context.Context, r *dietaiv1.SetBestFlowTruthRequest, _ ...grpc.CallOption) (*dietaiv1.SetBestFlowTruthResponse, error) {
	f.set = r
	return &dietaiv1.SetBestFlowTruthResponse{Json: `{"counts":{"images":2}}`}, nil
}

func TestStartBestFlowRunStreamsEvents(t *testing.T) {
	ai := &bestFlowAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/best-flow/runs"
	resp := postJSON(t, base, `{"image_ids":["a","b"],"limit":10,"root":"D:/runs"}`)
	events := sseEvents(t, resp)
	if len(events) != 2 || events[1][1] != `{"type":"done","name":"20261105-bestflow"}` {
		t.Errorf("events = %v", events)
	}
	if got := ai.start; strings.Join(got.GetImageIds(), ",") != "a,b" || got.GetLimit() != 10 ||
		got.GetRoot() != "D:/runs" || got.GetFolder() != "" {
		t.Errorf("request = %v", got)
	}
}

func TestStartBestFlowRunPassesArm(t *testing.T) {
	ai := &bestFlowAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/best-flow/runs"
	resp := postJSON(t, base, `{"folder":"D:/x","arm":{"name":"mine","ladder":{"rungs":["raw"]}},"preset_id":"raw_only"}`)
	sseEvents(t, resp)
	got := ai.start
	if got.GetPresetId() != "raw_only" || got.GetArmJson() != `{"ladder":{"rungs":["raw"]},"name":"mine"}` {
		t.Errorf("request = %v", got)
	}
	// 沒送 arm 時不帶設定，由 Python 用 c0_all_methods
	sseEvents(t, postJSON(t, base, `{"folder":"D:/x"}`))
	if ai.start.GetArmJson() != "" || ai.start.GetPresetId() != "" {
		t.Errorf("request = %v", ai.start)
	}
}

func TestListBestFlowPresets(t *testing.T) {
	base := newServerWith(t, &bestFlowAI{})
	resp, err := http.Get(base + "/workbench/v1/dev/best-flow/presets")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK || strings.TrimSpace(string(body)) != `{"presets":[{"id":"raw_only"}]}` {
		t.Errorf("status = %d, body = %s", resp.StatusCode, body)
	}
}

func TestGetBestFlowRunPassesCriteria(t *testing.T) {
	ai := &bestFlowAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/best-flow/runs/"
	resp, err := http.Get(base + "20261105-bestflow?root=D:/runs&min_gain=2&max_new_wrong=1&max_mean_ms=12.5")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if g := ai.get; g.GetRunDir() != "D:/runs/20261105-bestflow" || g.GetMinGain() != 2 ||
		g.GetMaxNewWrong() != 1 || g.GetMaxMeanMs() != 12.5 {
		t.Errorf("request = %v", g)
	}

	// 省略準則時送零值，由 Python 用預設值
	resp, err = http.Get(base + "20261105-bestflow")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	if g := ai.get; g.GetRunDir() != "20261105-bestflow" || g.GetMinGain() != 0 || g.GetMaxMeanMs() != 0 {
		t.Errorf("request = %v", g)
	}

	resp, err = http.Get(base + "%2E%2E")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("上層目錄 status = %d", resp.StatusCode)
	}
}

func put(t *testing.T, url, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func TestSetBestFlowTruthKeepsNull(t *testing.T) {
	ai := &bestFlowAI{}
	url := newServerWith(t, ai) + "/workbench/v1/dev/best-flow/runs/20261105-bestflow/truth"
	resp := put(t, url, `{"truths":{"a.png":"4710088410108","b.png":"","c.png":null}}`)
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	// null（取消確認）與空字串（沒有條碼）要分得出來
	want := `{"a.png":"4710088410108","b.png":"","c.png":null}`
	if got := ai.set.GetTruthsJson(); got != want {
		t.Errorf("truths_json = %s, want %s", got, want)
	}

	if resp := put(t, url, `{}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("缺少 truths status = %d", resp.StatusCode)
	}
}
