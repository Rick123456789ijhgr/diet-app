package workbench

import (
	"context"
	"os"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/coldstart"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
)

// 接真的 Python（開發模式，用來產生合成影像；營養標示讀取需要 OCR 引擎）：設定 TEST_AI_GRPC_ADDR 才執行，例如
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
	pre := NewPreprocessor(ai, ai)

	got := pre.Preprocess(ctx, coldstart.KindBarcode, synth("ean13", `{"code":"4710088410108"}`))
	if got.Error != "" || got.QualityPassed == nil || len(got.Barcodes) != 1 || got.Barcodes[0].Text != "4710088410108" {
		t.Errorf("條碼照片 = %+v", got)
	}
	got = pre.Preprocess(ctx, coldstart.KindLabel, synth("nutrition", `{"seed":3}`))
	if got.Error != "" || len(got.LabelQuad) != 4 {
		t.Errorf("營養標示照片 = %+v", got)
	}
	// 營養標示讀取（需要 Python 端的 OCR 引擎，AI_OCR_ENGINE）
	if r := got.LabelReading; r == nil || len(r.Cells) == 0 || len(r.Lines) == 0 || r.OCREngine == "" {
		t.Errorf("營養標示讀取 = %+v", r)
	} else {
		t.Logf("營養標示讀取：%s，欄 %v，%d 格，警告 %v", r.OCREngine, r.Columns, len(r.Cells), r.Warnings)
	}
	got = pre.Preprocess(ctx, coldstart.KindFront, []byte("not an image"))
	if got.Error == "" {
		t.Error("無法解碼的影像應記錄錯誤")
	}
}

// fakeLabel 是 LabelServiceClient 的假實作。
type fakeLabel struct {
	resp *dietaiv1.ParseLabelResponse
	err  error
}

func (f fakeLabel) ParseLabel(_ context.Context, _ *dietaiv1.ParseLabelRequest, _ ...grpc.CallOption) (*dietaiv1.ParseLabelResponse, error) {
	return f.resp, f.err
}

func labelAI() *fakeAI {
	return &fakeAI{
		quality: func(*dietaiv1.CheckQualityRequest) (*dietaiv1.CheckQualityResponse, error) {
			return &dietaiv1.CheckQualityResponse{Passed: true}, nil
		},
		label: func(*dietaiv1.PreprocessLabelRequest) (*dietaiv1.PreprocessLabelResponse, error) {
			return &dietaiv1.PreprocessLabelResponse{
				Quad:     []*dietaiv1.Point{{X: 1, Y: 2}, {X: 3, Y: 2}, {X: 3, Y: 4}, {X: 1, Y: 4}},
				Warnings: []string{"GLARE_RETAKE"},
			}, nil
		},
	}
}

func TestPreprocessorReadsLabel(t *testing.T) {
	read := &dietaiv1.ParseLabelResponse{
		Columns: []string{"per_serving"},
		Cells: []*dietaiv1.LabelCell{
			{Field: "protein", Basis: "per_serving", Quantity: &dietaiv1.LabelQuantity{Value: "2.1", Unit: "g"}},
		},
		Lines:     []string{"蛋白質 2.1 公克"},
		Checks:    []*dietaiv1.LabelRuleResult{{Rule: "atwater", Passed: false, Detail: "差距過大"}},
		OcrEngine: "fake 1.0",
	}
	got := NewPreprocessor(labelAI(), fakeLabel{resp: read}).Preprocess(context.Background(), coldstart.KindLabel, []byte("img"))
	if got.Error != "" || len(got.LabelQuad) != 4 {
		t.Fatalf("前處理 = %+v", got)
	}
	r := got.LabelReading
	if r == nil {
		t.Fatal("應有讀取結果")
	}
	want := coldstart.LabelCell{Field: "protein", Basis: "per_serving", Value: "2.1", Unit: "g"}
	if len(r.Cells) != 1 || r.Cells[0] != want {
		t.Errorf("格 = %+v", r.Cells)
	}
	if r.OCREngine != "fake 1.0" || r.Lines[0] != "蛋白質 2.1 公克" || r.Checks[0].Passed {
		t.Errorf("讀取結果 = %+v", r)
	}
	// 空的 repeated 欄位編成 []，符合 API 必填陣列
	if r.Warnings == nil {
		t.Error("Warnings 應為空陣列而非 nil")
	}
}

func TestPreprocessorLabelReadingFailureKeepsQuad(t *testing.T) {
	failing := fakeLabel{err: &aiclient.Error{Code: codes.FailedPrecondition, Reason: "OCR_UNAVAILABLE", Message: "找不到 PaddleOCR"}}
	got := NewPreprocessor(labelAI(), failing).Preprocess(context.Background(), coldstart.KindLabel, []byte("img"))
	if got.LabelReading != nil || len(got.LabelQuad) != 4 || got.Warnings[0] != "GLARE_RETAKE" {
		t.Errorf("前處理 = %+v", got)
	}
	if got.Error != "營養標示讀取失敗：找不到 PaddleOCR" {
		t.Errorf("Error = %q", got.Error)
	}
	// 沒有 LabelService 時不讀取
	got = NewPreprocessor(labelAI(), nil).Preprocess(context.Background(), coldstart.KindLabel, []byte("img"))
	if got.LabelReading != nil || got.Error != "" {
		t.Errorf("前處理 = %+v", got)
	}
}
