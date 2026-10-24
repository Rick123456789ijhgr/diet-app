// Package workbench 是開發工作台的後端：把前端的 REST 請求轉成對 Python 的 gRPC 呼叫。
//
// 開發工具（/workbench/v1/dev/*）只在 WORKBENCH_DEV_TOOLS=1 時啟用；
// 冷啟動上傳與登入於階段 5 加入（ADR 0003）。
//
// 分層：handler.go（HTTP 轉接、錯誤輸出）→ Service（REST 型別 ↔ proto 型別）→ AIClient（gRPC）。
// Go 不做影像處理，只負責參數轉換、錯誤代碼轉換（errors.go）與 SSE 串流（stream.go）。
// Service 回傳的錯誤保持原樣（*aiclient.Error 或 *Error），由 handler 統一轉成 HTTP 狀態。
package workbench

import (
	"context"
	"encoding/json"
	"fmt"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
)

// AIClient 是 Python 服務的介面；正式實作為 aiclient.Client，測試使用假實作。
type AIClient interface {
	dietaiv1.PreprocessServiceClient
	dietaiv1.WorkbenchServiceClient
}

// Service 不知道 HTTP：輸入與輸出為 OpenAPI 產生的資料型別。
type Service struct {
	ai AIClient
}

// NewService 以 Python 客戶端建立 Service。
func NewService(ai AIClient) *Service {
	return &Service{ai: ai}
}

// ConfigSchemas 回傳參數表單結構（由 Python 的 param() 宣告產生）。
// 結構以 JSON 字串經 gRPC 傳遞，新增或修改參數欄位不必改 proto（ADR 0003 第 4 點）。
func (s *Service) ConfigSchemas(ctx context.Context) (api.ConfigSchemas, error) {
	var out api.ConfigSchemas
	resp, err := s.ai.GetConfigSchemas(ctx, &dietaiv1.GetConfigSchemasRequest{})
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal([]byte(resp.GetJson()), &out); err != nil {
		return out, fmt.Errorf("workbench: 解析設定結構: %w", err)
	}
	return out, nil
}

// PutImage 暫存一張影像。暫存在 Python 端，之後的呼叫只帶 image_id，不再重傳影像本體。
func (s *Service) PutImage(ctx context.Context, name string, encoded []byte) (api.ImageRef, error) {
	resp, err := s.ai.PutImage(ctx, &dietaiv1.PutImageRequest{Encoded: encoded, Name: name})
	if err != nil {
		return api.ImageRef{}, err
	}
	return imageRef(resp.GetImage())
}

// Synthesize 產生合成影像並暫存。
func (s *Service) Synthesize(ctx context.Context, req api.SynthesizeRequest) (api.ImageRef, error) {
	params, err := objectJSON(req.Params)
	if err != nil {
		return api.ImageRef{}, err
	}
	resp, err := s.ai.Synthesize(ctx, &dietaiv1.SynthesizeRequest{
		Scene: string(req.Scene), ParamsJson: params,
	})
	if err != nil {
		return api.ImageRef{}, err
	}
	return imageRef(resp.GetImage())
}

// Degrade 套用模擬退化，回傳新的暫存影像（全為預設值時回傳原影像）。
func (s *Service) Degrade(ctx context.Context, imageID string, d api.ConfigOverride) (api.ImageRef, error) {
	degradation, err := overrideJSON(&d)
	if err != nil {
		return api.ImageRef{}, err
	}
	resp, err := s.ai.Degrade(ctx, &dietaiv1.DegradeRequest{
		ImageId: imageID, DegradationJson: degradation,
	})
	if err != nil {
		return api.ImageRef{}, err
	}
	return imageRef(resp.GetImage())
}

// RenderView 產生診斷影像（Image）或圖表資料（Data）；依視圖種類兩者可能只有其一，沒有的欄位省略。
func (s *Service) RenderView(ctx context.Context, req api.RenderViewRequest) (api.RenderViewResult, error) {
	var out api.RenderViewResult
	cfg, err := overrideJSON(req.Config)
	if err != nil {
		return out, err
	}
	resp, err := s.ai.RenderView(ctx, &dietaiv1.RenderViewRequest{
		ImageId: req.ImageId, View: string(req.View), ConfigJson: cfg,
	})
	if err != nil {
		return out, err
	}
	if resp.GetImage() != nil {
		ref, err := imageRef(resp.GetImage())
		if err != nil {
			return out, err
		}
		out.Image = &ref
	}
	if out.Data, err = freeJSON(resp.GetDataJson()); err != nil {
		return out, err
	}
	return out, nil
}

// Artifact 取得暫存影像或診斷影像的編碼位元組與 content type。
// 整張影像一次讀進記憶體；大小受 gRPC 訊息上限（aiclient.MaxMessageBytes）限制。
func (s *Service) Artifact(ctx context.Context, id string) ([]byte, string, error) {
	resp, err := s.ai.GetArtifact(ctx, &dietaiv1.GetArtifactRequest{Id: id})
	if err != nil {
		return nil, "", err
	}
	return resp.GetEncoded(), resp.GetContentType(), nil
}

// CheckQuality 對暫存影像做品質檢查。
func (s *Service) CheckQuality(ctx context.Context, req api.ConfigRequest) (api.QualityResult, error) {
	var out api.QualityResult
	cfg, err := overrideJSON(req.Config)
	if err != nil {
		return out, err
	}
	resp, err := s.ai.CheckQuality(ctx, &dietaiv1.CheckQualityRequest{
		Image:  &dietaiv1.ImageInput{Source: &dietaiv1.ImageInput_ImageId{ImageId: req.ImageId}},
		Config: &dietaiv1.ConfigOverride{Json: cfg},
	})
	if err != nil {
		return out, err
	}
	steps, err := stepList(resp.GetSteps())
	if err != nil {
		return out, err
	}
	return api.QualityResult{
		Passed:         resp.GetPassed(),
		BlurScore:      resp.GetBlurScore(),
		MeanBrightness: resp.GetMeanBrightness(),
		DarkRatio:      resp.GetDarkRatio(),
		BrightRatio:    resp.GetBrightRatio(),
		ResolutionOk:   resp.GetResolutionOk(),
		Warnings:       nonNil(resp.GetWarnings()),
		Steps:          steps,
	}, nil
}

// imageRef 轉換暫存影像的參照；Truth 為合成影像的真值（實拍照片沒有，為 nil）。
func imageRef(ref *dietaiv1.ImageRef) (api.ImageRef, error) {
	truth, err := freeJSON(ref.GetTruthJson())
	if err != nil {
		return api.ImageRef{}, err
	}
	return api.ImageRef{
		ImageId:     ref.GetImageId(),
		Width:       ref.GetWidth(),
		Height:      ref.GetHeight(),
		Description: ref.GetDescription(),
		Truth:       truth,
	}, nil
}

// stepList 轉換前處理各步驟的紀錄（名稱、耗時、實際使用的參數），供工作台顯示流程。
// 參數 JSON 解析失敗表示 Python 回傳格式有誤，視為內部錯誤（500）。
func stepList(steps []*dietaiv1.Step) ([]api.Step, error) {
	out := make([]api.Step, 0, len(steps))
	for _, s := range steps {
		params := map[string]any{}
		if s.GetParamsJson() != "" {
			if err := json.Unmarshal([]byte(s.GetParamsJson()), &params); err != nil {
				return nil, fmt.Errorf("workbench: 解析步驟 %s 的參數: %w", s.GetName(), err)
			}
		}
		out = append(out, api.Step{Name: s.GetName(), ElapsedMs: s.GetElapsedMs(), Params: params})
	}
	return out, nil
}

// overrideJSON 把設定覆寫編成 JSON；沒有覆寫時回傳空字串（Python 視為全部用預設值）。
func overrideJSON(o *api.ConfigOverride) (string, error) {
	if o == nil {
		return "", nil
	}
	return objectJSON((*map[string]any)(o))
}

// objectJSON 把選填的 JSON 物件編成字串；nil 或空物件都回傳空字串，與「沒有覆寫」同義。
func objectJSON(m *map[string]any) (string, error) {
	if m == nil || len(*m) == 0 {
		return "", nil
	}
	b, err := json.Marshal(*m)
	if err != nil {
		return "", fmt.Errorf("workbench: 編碼 JSON: %w", err)
	}
	return string(b), nil
}

// freeJSON 解析 Python 回傳的 JSON 物件；空字串表示沒有。
func freeJSON(s string) (*api.FreeJson, error) {
	if s == "" {
		return nil, nil
	}
	var m api.FreeJson
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, fmt.Errorf("workbench: 解析 Python 回傳的 JSON: %w", err)
	}
	return &m, nil
}

// nonNil 讓空清單編成 [] 而不是 null。
func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
