package workbench

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"google.golang.org/grpc"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
)

// foldersAI 是資料夾瀏覽的假實作，記下收到的路徑。
type foldersAI struct {
	AIClient
	got *dietaiv1.ListFoldersRequest
}

func (f *foldersAI) ListFolders(_ context.Context, r *dietaiv1.ListFoldersRequest, _ ...grpc.CallOption) (*dietaiv1.ListFoldersResponse, error) {
	f.got = r
	return &dietaiv1.ListFoldersResponse{Json: `{"path":"D:\\photos","folders":[]}`}, nil
}

func TestListFoldersPassesPath(t *testing.T) {
	ai := &foldersAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/folders"
	resp, err := http.Get(base + "?path=" + url.QueryEscape(`D:\photos`))
	if err != nil {
		t.Fatal(err)
	}
	out := decodeBody(t, resp)
	if out["path"] != `D:\photos` || ai.got.GetPath() != `D:\photos` {
		t.Errorf("response = %v, request = %v", out, ai.got)
	}
}

func TestListFoldersWithoutPathStartsAtRoots(t *testing.T) {
	ai := &foldersAI{}
	base := newServerWith(t, ai) + "/workbench/v1/dev/folders"
	resp, err := http.Get(base)
	if err != nil {
		t.Fatal(err)
	}
	decodeBody(t, resp)
	if ai.got == nil || ai.got.GetPath() != "" {
		t.Errorf("request = %v", ai.got)
	}
}
