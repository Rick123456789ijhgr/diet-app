package workbench

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/platform/aiclient"
)

// fakeAI 只實作測試用到的方法；其他方法呼叫到內嵌的 nil 介面會 panic，代表測試寫錯。
type fakeAI struct {
	AIClient
	quality     func(*dietaiv1.CheckQualityRequest) (*dietaiv1.CheckQualityResponse, error)
	putImage    func(*dietaiv1.PutImageRequest) (*dietaiv1.PutImageResponse, error)
	degrade     func(*dietaiv1.DegradeRequest) (*dietaiv1.DegradeResponse, error)
	renderView  func(*dietaiv1.RenderViewRequest) (*dietaiv1.RenderViewResponse, error)
	artifact    func(*dietaiv1.GetArtifactRequest) (*dietaiv1.GetArtifactResponse, error)
	barcode     func(*dietaiv1.DecodeBarcodeRequest) (*dietaiv1.DecodeBarcodeResponse, error)
	invoice     func(*dietaiv1.LocateInvoiceQrRequest) (*dietaiv1.LocateInvoiceQrResponse, error)
	label       func(*dietaiv1.PreprocessLabelRequest) (*dietaiv1.PreprocessLabelResponse, error)
	food        func(*dietaiv1.PreprocessFoodRequest) (*dietaiv1.PreprocessFoodResponse, error)
	schemasJSON string
}

func (f *fakeAI) CheckQuality(_ context.Context, r *dietaiv1.CheckQualityRequest, _ ...grpc.CallOption) (*dietaiv1.CheckQualityResponse, error) {
	return f.quality(r)
}

func (f *fakeAI) PutImage(_ context.Context, r *dietaiv1.PutImageRequest, _ ...grpc.CallOption) (*dietaiv1.PutImageResponse, error) {
	return f.putImage(r)
}

func (f *fakeAI) Degrade(_ context.Context, r *dietaiv1.DegradeRequest, _ ...grpc.CallOption) (*dietaiv1.DegradeResponse, error) {
	return f.degrade(r)
}

func (f *fakeAI) RenderView(_ context.Context, r *dietaiv1.RenderViewRequest, _ ...grpc.CallOption) (*dietaiv1.RenderViewResponse, error) {
	return f.renderView(r)
}

func (f *fakeAI) GetArtifact(_ context.Context, r *dietaiv1.GetArtifactRequest, _ ...grpc.CallOption) (*dietaiv1.GetArtifactResponse, error) {
	return f.artifact(r)
}

func (f *fakeAI) DecodeBarcode(_ context.Context, r *dietaiv1.DecodeBarcodeRequest, _ ...grpc.CallOption) (*dietaiv1.DecodeBarcodeResponse, error) {
	return f.barcode(r)
}

func (f *fakeAI) LocateInvoiceQr(_ context.Context, r *dietaiv1.LocateInvoiceQrRequest, _ ...grpc.CallOption) (*dietaiv1.LocateInvoiceQrResponse, error) {
	return f.invoice(r)
}

func (f *fakeAI) PreprocessLabel(_ context.Context, r *dietaiv1.PreprocessLabelRequest, _ ...grpc.CallOption) (*dietaiv1.PreprocessLabelResponse, error) {
	return f.label(r)
}

func (f *fakeAI) PreprocessFood(_ context.Context, r *dietaiv1.PreprocessFoodRequest, _ ...grpc.CallOption) (*dietaiv1.PreprocessFoodResponse, error) {
	return f.food(r)
}

func (f *fakeAI) GetConfigSchemas(context.Context, *dietaiv1.GetConfigSchemasRequest, ...grpc.CallOption) (*dietaiv1.GetConfigSchemasResponse, error) {
	return &dietaiv1.GetConfigSchemasResponse{Json: f.schemasJSON}, nil
}

func newServer(t *testing.T, ai *fakeAI, devTools bool) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(NewHTTPHandler(NewService(ai), Options{DevTools: devTools}))
	t.Cleanup(srv.Close)
	return srv
}

func postJSON(t *testing.T, url, body string) *http.Response {
	t.Helper()
	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func decode[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestDevToolsDisabledReturns404(t *testing.T) {
	srv := newServer(t, &fakeAI{}, false)
	resp := postJSON(t, srv.URL+"/workbench/v1/dev/quality", `{"image_id":"x"}`)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	if e := decode[api.Error](t, resp); e.Code != "NOT_FOUND" {
		t.Errorf("code = %q", e.Code)
	}
}

func TestCheckQualityPassesOnlyOverriddenFields(t *testing.T) {
	var got *dietaiv1.CheckQualityRequest
	ai := &fakeAI{quality: func(r *dietaiv1.CheckQualityRequest) (*dietaiv1.CheckQualityResponse, error) {
		got = r
		return &dietaiv1.CheckQualityResponse{
			BlurScore: 123.456789,
			Warnings:  []string{"TOO_BLURRY"},
			Steps:     []*dietaiv1.Step{{Name: "blur_score", ElapsedMs: 1.5, ParamsJson: `{"blur_min":150}`}},
		}, nil
	}}
	srv := newServer(t, ai, true)

	tests := []struct {
		name, body, wantConfig string
	}{
		{"有覆寫", `{"image_id":"img1","config":{"blur_min":150}}`, `{"blur_min":150}`},
		{"空物件", `{"image_id":"img1","config":{}}`, ""},
		{"省略", `{"image_id":"img1"}`, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := postJSON(t, srv.URL+"/workbench/v1/dev/quality", tt.body)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("status = %d", resp.StatusCode)
			}
			out := decode[api.QualityResult](t, resp)
			if got.GetImage().GetImageId() != "img1" || got.GetConfig().GetJson() != tt.wantConfig {
				t.Errorf("request = %v", got)
			}
			if out.BlurScore != 123.456789 || out.Warnings[0] != "TOO_BLURRY" || out.Steps[0].Params["blur_min"] != 150.0 {
				t.Errorf("result = %+v", out)
			}
		})
	}
}

func TestAIErrorsMapToHTTP(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantField  string
	}{
		{"設定錯誤", &aiclient.Error{Code: codes.InvalidArgument, Reason: "INVALID_CONFIG", Field: "blur_min"},
			http.StatusBadRequest, "INVALID_CONFIG", "blur_min"},
		{"找不到影像", &aiclient.Error{Code: codes.NotFound, Reason: "IMAGE_NOT_FOUND"},
			http.StatusNotFound, "IMAGE_NOT_FOUND", ""},
		{"測試集鎖定", &aiclient.Error{Code: codes.PermissionDenied, Reason: "SPLIT_LOCKED"},
			http.StatusForbidden, "SPLIT_LOCKED", ""},
		{"Python 未啟動", &aiclient.Error{Code: codes.Unavailable, Reason: aiclient.ReasonUnavailable},
			http.StatusServiceUnavailable, "AI_UNAVAILABLE", ""},
		{"逾時", &aiclient.Error{Code: codes.DeadlineExceeded, Reason: aiclient.ReasonTimeout},
			http.StatusGatewayTimeout, "AI_TIMEOUT", ""},
		{"Python 內部錯誤", &aiclient.Error{Code: codes.Internal, Reason: "INTERNAL"},
			http.StatusInternalServerError, "INTERNAL", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ai := &fakeAI{quality: func(*dietaiv1.CheckQualityRequest) (*dietaiv1.CheckQualityResponse, error) {
				return nil, tt.err
			}}
			resp := postJSON(t, newServer(t, ai, true).URL+"/workbench/v1/dev/quality", `{"image_id":"x"}`)
			e := decode[api.Error](t, resp)
			field := ""
			if e.Field != nil {
				field = *e.Field
			}
			if resp.StatusCode != tt.wantStatus || e.Code != tt.wantCode || field != tt.wantField {
				t.Errorf("got (%d, %q, %q), want (%d, %q, %q)",
					resp.StatusCode, e.Code, field, tt.wantStatus, tt.wantCode, tt.wantField)
			}
		})
	}
}

func TestInvalidJSONIs400(t *testing.T) {
	resp := postJSON(t, newServer(t, &fakeAI{}, true).URL+"/workbench/v1/dev/quality", `{not json`)
	if resp.StatusCode != http.StatusBadRequest || decode[api.Error](t, resp).Code != "INVALID_REQUEST" {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestUnknownPathIsJSON404(t *testing.T) {
	resp, err := http.Get(newServer(t, &fakeAI{}, true).URL + "/workbench/v1/nope")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound || decode[api.Error](t, resp).Code != "NOT_FOUND" {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestLaterStageRoutesAre501(t *testing.T) {
	resp := postJSON(t, newServer(t, &fakeAI{}, true).URL+"/workbench/v1/dev/sweeps", `{"target":"quality"}`)
	if resp.StatusCode != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", resp.StatusCode)
	}
}

func multipartBody(t *testing.T, fields map[string]string, file []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	if file != nil {
		fw, _ := mw.CreateFormFile("file", "photo.jpg")
		_, _ = fw.Write(file)
	}
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func TestPutImage(t *testing.T) {
	var got *dietaiv1.PutImageRequest
	ai := &fakeAI{putImage: func(r *dietaiv1.PutImageRequest) (*dietaiv1.PutImageResponse, error) {
		got = r
		return &dietaiv1.PutImageResponse{Image: &dietaiv1.ImageRef{ImageId: "id1", Width: 4, Height: 3}}, nil
	}}
	srv := newServer(t, ai, true)
	url := srv.URL + "/workbench/v1/dev/images"

	t.Run("檔名取自上傳檔", func(t *testing.T) {
		body, ct := multipartBody(t, nil, []byte("jpeg-bytes"))
		resp, err := http.Post(url, ct, body)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("status = %d", resp.StatusCode)
		}
		if ref := decode[api.ImageRef](t, resp); ref.ImageId != "id1" || ref.Truth != nil {
			t.Errorf("ref = %+v", ref)
		}
		if string(got.GetEncoded()) != "jpeg-bytes" || got.GetName() != "photo.jpg" {
			t.Errorf("request = %v", got)
		}
	})
	t.Run("缺少檔案", func(t *testing.T) {
		body, ct := multipartBody(t, map[string]string{"name": "x"}, nil)
		resp, err := http.Post(url, ct, body)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest || decode[api.Error](t, resp).Code != "IMAGE_REQUIRED" {
			t.Errorf("status = %d", resp.StatusCode)
		}
	})
	t.Run("檔案過大", func(t *testing.T) {
		body, ct := multipartBody(t, nil, make([]byte, MaxUploadBytes+1))
		resp, err := http.Post(url, ct, body)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Errorf("status = %d, want 413", resp.StatusCode)
		}
	})
}

func TestDegradeAndTruth(t *testing.T) {
	var got *dietaiv1.DegradeRequest
	ai := &fakeAI{degrade: func(r *dietaiv1.DegradeRequest) (*dietaiv1.DegradeResponse, error) {
		got = r
		return &dietaiv1.DegradeResponse{Image: &dietaiv1.ImageRef{ImageId: "d1", TruthJson: `{"quad":[1,2]}`}}, nil
	}}
	resp := postJSON(t, newServer(t, ai, true).URL+"/workbench/v1/dev/images/src1/degrade",
		`{"degradation":{"blur_sigma":2}}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	ref := decode[api.ImageRef](t, resp)
	if got.GetImageId() != "src1" || got.GetDegradationJson() != `{"blur_sigma":2}` {
		t.Errorf("request = %v", got)
	}
	if ref.Truth == nil || len((*ref.Truth)["quad"].([]any)) != 2 {
		t.Errorf("truth = %v", ref.Truth)
	}
}

func TestRenderView(t *testing.T) {
	ai := &fakeAI{renderView: func(r *dietaiv1.RenderViewRequest) (*dietaiv1.RenderViewResponse, error) {
		if r.GetView() == "histogram" {
			return &dietaiv1.RenderViewResponse{DataJson: `{"counts":[1,2,3]}`}, nil
		}
		return &dietaiv1.RenderViewResponse{Image: &dietaiv1.ImageRef{ImageId: "v1"}}, nil
	}}
	srv := newServer(t, ai, true)

	hist := decode[api.RenderViewResult](t, postJSON(t, srv.URL+"/workbench/v1/dev/views",
		`{"image_id":"x","view":"histogram"}`))
	if hist.Image != nil || hist.Data == nil || len((*hist.Data)["counts"].([]any)) != 3 {
		t.Errorf("histogram = %+v", hist)
	}
	lap := decode[api.RenderViewResult](t, postJSON(t, srv.URL+"/workbench/v1/dev/views",
		`{"image_id":"x","view":"laplacian"}`))
	if lap.Image == nil || lap.Image.ImageId != "v1" || lap.Data != nil {
		t.Errorf("laplacian = %+v", lap)
	}
}

func TestArtifactHeaders(t *testing.T) {
	ai := &fakeAI{artifact: func(r *dietaiv1.GetArtifactRequest) (*dietaiv1.GetArtifactResponse, error) {
		return &dietaiv1.GetArtifactResponse{Encoded: []byte{0xff, 0xd8}, ContentType: "image/jpeg"}, nil
	}}
	resp, err := http.Get(newServer(t, ai, true).URL + "/workbench/v1/dev/artifacts/a1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.Header.Get("Content-Type") != "image/jpeg" || !strings.Contains(resp.Header.Get("Cache-Control"), "immutable") {
		t.Errorf("headers = %v", resp.Header)
	}
	if !bytes.Equal(body, []byte{0xff, 0xd8}) {
		t.Errorf("body = %v", body)
	}
}

func TestConfigSchemas(t *testing.T) {
	ai := &fakeAI{schemasJSON: `{"classes":[{"name":"QualityConfig","doc":"d","defaults":{"blur_min":100},
		"fields":[{"name":"blur_min","type":"float","default":100.0,"label":"模糊下限","label_en":"Blur min",
		"help":"h","calibrate":true,"group":"blur","min":0,"max":2000,"step":5}]}],"enums":{"Rung":["raw"]}}`}
	resp, err := http.Get(newServer(t, ai, true).URL + "/workbench/v1/dev/config-schemas")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatal(err)
	}
	field := raw["classes"].([]any)[0].(map[string]any)["fields"].([]any)[0].(map[string]any)
	if field["default"] != 100.0 || field["label"] != "模糊下限" || field["step"] != 5.0 {
		t.Errorf("field = %v", field)
	}
}

func corners() []*dietaiv1.Point {
	return []*dietaiv1.Point{{X: 1, Y: 2}, {X: 3, Y: 2}, {X: 3, Y: 4}, {X: 1, Y: 4}}
}

func TestDecodeBarcode(t *testing.T) {
	var got *dietaiv1.DecodeBarcodeRequest
	ai := &fakeAI{barcode: func(r *dietaiv1.DecodeBarcodeRequest) (*dietaiv1.DecodeBarcodeResponse, error) {
		got = r
		if r.GetLadder().GetJson() == `{"rungs":["raw"]}` {
			return &dietaiv1.DecodeBarcodeResponse{SuccessIndex: -1, Warnings: []string{"BARCODE_NOT_FOUND"},
				Attempts: []*dietaiv1.RungAttempt{{Rung: "raw", ParamsJson: "{}"}}}, nil
		}
		h := &dietaiv1.DecodeHit{Format: "EAN13", Text: "4710088410108", Raw: []byte("4710088410108"), Corners: corners()}
		return &dietaiv1.DecodeBarcodeResponse{
			Success: true, SuccessRung: "gray", SuccessIndex: 1, Hits: []*dietaiv1.DecodeHit{h},
			Attempts: []*dietaiv1.RungAttempt{
				{Rung: "raw", ParamsJson: "{}"},
				{Rung: "gray", ParamsJson: `{"scale":1}`, Hits: []*dietaiv1.DecodeHit{h}},
			},
		}, nil
	}}
	srv := newServer(t, ai, true)

	ok := decode[api.BarcodeResult](t, postJSON(t, srv.URL+"/workbench/v1/dev/barcode",
		`{"image_id":"x","zxing":{"try_rotate":false}}`))
	if !ok.Success || *ok.SuccessRung != "gray" || ok.SuccessIndex != 1 || ok.Hits[0].Text != "4710088410108" {
		t.Errorf("result = %+v", ok)
	}
	if string(ok.Hits[0].Raw) != "4710088410108" || len(ok.Hits[0].Corners) != 4 || ok.Attempts[1].Params["scale"] != 1.0 {
		t.Errorf("hit = %+v attempts = %+v", ok.Hits[0], ok.Attempts)
	}
	if got.GetZxing().GetJson() != `{"try_rotate":false}` || got.GetLadder().GetJson() != "" {
		t.Errorf("request = %v", got)
	}

	failed := decode[api.BarcodeResult](t, postJSON(t, srv.URL+"/workbench/v1/dev/barcode",
		`{"image_id":"x","ladder":{"rungs":["raw"]}}`))
	if failed.Success || failed.SuccessRung != nil || failed.SuccessIndex != -1 || failed.Hits == nil {
		t.Errorf("failed = %+v", failed)
	}
}

func TestInvoiceRawBytesAreBase64(t *testing.T) {
	big5 := []byte{0xAF, 0xF9, 0xB8, 0xA6} // 「茶葉」的 Big5
	ai := &fakeAI{invoice: func(*dietaiv1.LocateInvoiceQrRequest) (*dietaiv1.LocateInvoiceQrResponse, error) {
		return &dietaiv1.LocateInvoiceQrResponse{
			Left:     &dietaiv1.DecodeHit{Format: "QR_CODE", Raw: big5, Corners: corners()},
			Warnings: []string{"INVOICE_QR_PARTIAL"},
		}, nil
	}}
	resp := postJSON(t, newServer(t, ai, true).URL+"/workbench/v1/dev/invoice-qr", `{"image_id":"x"}`)
	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatal(err)
	}
	left := raw["left"].(map[string]any)
	if left["raw"] != "r/m4pg==" || raw["right"] != nil {
		t.Errorf("left = %v right = %v", left, raw["right"])
	}
}

func TestPreprocessLabel(t *testing.T) {
	ai := &fakeAI{label: func(r *dietaiv1.PreprocessLabelRequest) (*dietaiv1.PreprocessLabelResponse, error) {
		out := &dietaiv1.ImageOutput{Data: &dietaiv1.ImageOutput_ArtifactId{ArtifactId: "a1"}, Width: 600, Height: 900}
		if r.GetConfig().GetJson() != "" {
			// Python 沒開開發模式時直接附上檔案
			out = &dietaiv1.ImageOutput{Data: &dietaiv1.ImageOutput_Encoded{Encoded: []byte("png")}}
		}
		return &dietaiv1.PreprocessLabelResponse{Image: out, Quad: corners(), QuadMethod: "contour", GlareRatio: -1}, nil
	}}
	srv := newServer(t, ai, true)
	got := decode[api.LabelResult](t, postJSON(t, srv.URL+"/workbench/v1/dev/label", `{"image_id":"x"}`))
	if got.Image.ArtifactId != "a1" || got.Image.Width != 600 || len(got.Quad) != 4 || *got.QuadMethod != "contour" || got.GlareRatio != -1 {
		t.Errorf("label = %+v", got)
	}
	resp := postJSON(t, srv.URL+"/workbench/v1/dev/label", `{"image_id":"x","config":{"enable_glare":false}}`)
	if resp.StatusCode != http.StatusBadGateway || decode[api.Error](t, resp).Code != "AI_NOT_DEV_MODE" {
		t.Errorf("status = %d", resp.StatusCode)
	}
}

func TestPreprocessFood(t *testing.T) {
	img := func(id string) *dietaiv1.VlmImage {
		return &dietaiv1.VlmImage{
			Image:    &dietaiv1.ImageOutput{Data: &dietaiv1.ImageOutput_ArtifactId{ArtifactId: id}, Width: 10, Height: 8},
			NumBytes: 1234, Scale: 0.5,
		}
	}
	ai := &fakeAI{food: func(*dietaiv1.PreprocessFoodRequest) (*dietaiv1.PreprocessFoodResponse, error) {
		return &dietaiv1.PreprocessFoodResponse{
			Whole: img("w"), DishesEnabled: true,
			Dishes: []*dietaiv1.Box{{X: 1, Y: 2, W: 3, H: 4}}, Crops: []*dietaiv1.VlmImage{img("c0")},
			PlatesEnabled: false,
		}, nil
	}}
	got := decode[api.FoodResult](t, postJSON(t, newServer(t, ai, true).URL+"/workbench/v1/dev/food", `{"image_id":"x"}`))
	if got.Whole.Image.ArtifactId != "w" || got.Whole.NumBytes != 1234 || got.Dishes[0].W != 3 ||
		got.Crops[0].Image.ArtifactId != "c0" || got.PlatesEnabled || got.Plates == nil {
		t.Errorf("food = %+v", got)
	}
}
