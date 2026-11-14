package workbench

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"google.golang.org/grpc"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
)

// namingAI 是圖片批次命名三個 RPC 的假實作，記下收到的請求。
type namingAI struct {
	AIClient
	preview *dietaiv1.PreviewImageNamesRequest
	apply   *dietaiv1.ApplyImageNamesRequest
	undo    *dietaiv1.UndoImageNamesRequest
}

func (f *namingAI) PreviewImageNames(_ context.Context, r *dietaiv1.PreviewImageNamesRequest, _ ...grpc.CallOption) (*dietaiv1.PreviewImageNamesResponse, error) {
	f.preview = r
	return &dietaiv1.PreviewImageNamesResponse{Json: `{"counts":{"rename":2}}`}, nil
}

func (f *namingAI) ApplyImageNames(_ context.Context, r *dietaiv1.ApplyImageNamesRequest, _ ...grpc.CallOption) (*dietaiv1.ApplyImageNamesResponse, error) {
	f.apply = r
	return &dietaiv1.ApplyImageNamesResponse{Json: `{"renamed":2}`}, nil
}

func (f *namingAI) UndoImageNames(_ context.Context, r *dietaiv1.UndoImageNamesRequest, _ ...grpc.CallOption) (*dietaiv1.UndoImageNamesResponse, error) {
	f.undo = r
	return &dietaiv1.UndoImageNamesResponse{Json: `{"restored":2,"problems":[]}`}, nil
}

func decodeBody(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, b)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestPreviewImageNamesPassesOptions(t *testing.T) {
	ai := &namingAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/image-naming/"
	body := `{"folder":"D:/photos","category":"f","batch":"a01","start":7,"width":4,
		"order":"name","include_unknown":true,"no_code":"none"}`
	out := decodeBody(t, postJSON(t, base+"preview", body))
	if out["counts"].(map[string]any)["rename"] != 2.0 {
		t.Errorf("response = %v", out)
	}
	o := ai.preview.GetOptions()
	if o.GetFolder() != "D:/photos" || o.GetCategory() != "f" || o.GetBatch() != "a01" ||
		o.GetStart() != 7 || o.GetWidth() != 4 || o.GetOrder() != "name" ||
		!o.GetIncludeUnknown() || o.GetNoCode() != "none" {
		t.Errorf("options = %v", o)
	}
}

func TestApplyImageNamesDefaultsToZeroValues(t *testing.T) {
	ai := &namingAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/image-naming/"
	out := decodeBody(t, postJSON(t, base+"apply", `{"folder":"D:/photos"}`))
	if out["renamed"] != 2.0 {
		t.Errorf("response = %v", out)
	}
	o := ai.apply.GetOptions()
	// 未填的欄位送零值，由 Python 換成預設值
	if o.GetFolder() != "D:/photos" || o.GetWidth() != 0 || o.GetOrder() != "" || o.GetNoCode() != "" {
		t.Errorf("options = %v", o)
	}
}

func TestUndoImageNames(t *testing.T) {
	ai := &namingAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/image-naming/"
	out := decodeBody(t, postJSON(t, base+"undo", `{"folder":"D:/photos"}`))
	if out["restored"] != 2.0 || ai.undo.GetFolder() != "D:/photos" {
		t.Errorf("response = %v, request = %v", out, ai.undo)
	}
}

func TestImageNamingRejectsBadOrder(t *testing.T) {
	ai := &namingAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/image-naming/"
	resp := postJSON(t, base+"preview", `{"folder":"D:/photos","order":"random"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest || ai.preview != nil {
		t.Errorf("status = %d, forwarded = %v", resp.StatusCode, ai.preview)
	}
}
