package workbench

import (
	"context"
	"os"
	"testing"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/coldstart"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
)

// 接真的 Python（開發模式，用來產生合成影像）：設定 TEST_AI_GRPC_ADDR 才執行，例如
// WORKBENCH_DEV_TOOLS=1 python -m dietai.server 後 TEST_AI_GRPC_ADDR=127.0.0.1:50051 go test ./internal/workbench/
func TestPreprocessorWithPython(t *testing.T) {
	addr := os.Getenv("TEST_AI_GRPC_ADDR")
	if addr == "" {
		t.Skip("未設定 TEST_AI_GRPC_ADDR，略過接 Python 的測試")
	}
	ai, err := aiclient.New(addr)
	if err != nil {
		t.Fatal(err)
	}
	defer ai.Close()
	ctx := context.Background()
	synth := func(scene, params string) []byte {
		t.Helper()
		ref, err := ai.Synthesize(ctx, &dietaiv1.SynthesizeRequest{Scene: scene, ParamsJson: params})
		if err != nil {
			t.Fatal(err)
		}
		art, err := ai.GetArtifact(ctx, &dietaiv1.GetArtifactRequest{Id: ref.GetImage().GetImageId()})
		if err != nil {
			t.Fatal(err)
		}
		return art.GetEncoded()
	}
	pre := NewPreprocessor(ai)

	got := pre.Preprocess(ctx, coldstart.KindBarcode, synth("ean13", `{"code":"4710088410108"}`))
	if got.Error != "" || got.QualityPassed == nil || len(got.Barcodes) != 1 || got.Barcodes[0].Text != "4710088410108" {
		t.Errorf("條碼照片 = %+v", got)
	}
	got = pre.Preprocess(ctx, coldstart.KindLabel, synth("nutrition", `{"seed":3}`))
	if got.Error != "" || len(got.LabelQuad) != 4 {
		t.Errorf("營養標示照片 = %+v", got)
	}
	got = pre.Preprocess(ctx, coldstart.KindFront, []byte("not an image"))
	if got.Error == "" {
		t.Error("無法解碼的影像應記錄錯誤")
	}
}
