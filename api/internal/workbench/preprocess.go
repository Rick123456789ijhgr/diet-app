package workbench

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
)

// 條碼、發票 QR、營養標示、食物照片：把工作台的請求轉成 PreprocessService 呼叫（階段 2）。

func byID(id string) *dietaiv1.ImageInput {
	return &dietaiv1.ImageInput{Source: &dietaiv1.ImageInput_ImageId{ImageId: id}}
}

func override(o *api.ConfigOverride) (*dietaiv1.ConfigOverride, error) {
	s, err := overrideJSON(o)
	if err != nil {
		return nil, err
	}
	return &dietaiv1.ConfigOverride{Json: s}, nil
}

// DecodeBarcode 以條碼逐步升級解碼。
func (s *Service) DecodeBarcode(ctx context.Context, req api.LadderRequest) (api.BarcodeResult, error) {
	var out api.BarcodeResult
	ladder, err := override(req.Ladder)
	if err != nil {
		return out, err
	}
	zxing, err := override(req.Zxing)
	if err != nil {
		return out, err
	}
	resp, err := s.ai.DecodeBarcode(ctx, &dietaiv1.DecodeBarcodeRequest{
		Image: byID(req.ImageId), Ladder: ladder, Zxing: zxing,
	})
	if err != nil {
		return out, err
	}
	attempts, err := attemptList(resp.GetAttempts())
	if err != nil {
		return out, err
	}
	steps, err := stepList(resp.GetSteps())
	if err != nil {
		return out, err
	}
	out = api.BarcodeResult{
		Success:      resp.GetSuccess(),
		SuccessIndex: int(resp.GetSuccessIndex()),
		Hits:         hitList(resp.GetHits()),
		Attempts:     attempts,
		Warnings:     nonNil(resp.GetWarnings()),
		Steps:        steps,
	}
	if r := resp.GetSuccessRung(); r != "" {
		out.SuccessRung = &r
	}
	return out, nil
}

// LocateInvoiceQr 定位電子發票的左右兩個 QR；內容為原始位元組（中文由之後的發票模組解碼）。
func (s *Service) LocateInvoiceQr(ctx context.Context, req api.LadderRequest) (api.InvoiceQrResult, error) {
	var out api.InvoiceQrResult
	ladder, err := override(req.Ladder)
	if err != nil {
		return out, err
	}
	zxing, err := override(req.Zxing)
	if err != nil {
		return out, err
	}
	resp, err := s.ai.LocateInvoiceQr(ctx, &dietaiv1.LocateInvoiceQrRequest{
		Image: byID(req.ImageId), Ladder: ladder, Zxing: zxing,
	})
	if err != nil {
		return out, err
	}
	attempts, err := attemptList(resp.GetAttempts())
	if err != nil {
		return out, err
	}
	steps, err := stepList(resp.GetSteps())
	if err != nil {
		return out, err
	}
	out = api.InvoiceQrResult{Attempts: attempts, Warnings: nonNil(resp.GetWarnings()), Steps: steps}
	if resp.GetLeft() != nil {
		h := hit(resp.GetLeft())
		out.Left = &h
	}
	if resp.GetRight() != nil {
		h := hit(resp.GetRight())
		out.Right = &h
	}
	return out, nil
}

// PreprocessLabel 定位並校正營養標示。
func (s *Service) PreprocessLabel(ctx context.Context, req api.ConfigRequest) (api.LabelResult, error) {
	var out api.LabelResult
	cfg, err := override(req.Config)
	if err != nil {
		return out, err
	}
	resp, err := s.ai.PreprocessLabel(ctx, &dietaiv1.PreprocessLabelRequest{Image: byID(req.ImageId), Config: cfg})
	if err != nil {
		return out, err
	}
	img, err := imageOutput(resp.GetImage())
	if err != nil {
		return out, err
	}
	steps, err := stepList(resp.GetSteps())
	if err != nil {
		return out, err
	}
	out = api.LabelResult{
		Image:      img,
		Quad:       pointList(resp.GetQuad()),
		GlareRatio: resp.GetGlareRatio(),
		Warnings:   nonNil(resp.GetWarnings()),
		Steps:      steps,
	}
	if m := resp.GetQuadMethod(); m != "" {
		out.QuadMethod = &m
	}
	return out, nil
}

// PreprocessFood 切菜、盤緣與 VLM 輸入。
func (s *Service) PreprocessFood(ctx context.Context, req api.ConfigRequest) (api.FoodResult, error) {
	var out api.FoodResult
	cfg, err := override(req.Config)
	if err != nil {
		return out, err
	}
	resp, err := s.ai.PreprocessFood(ctx, &dietaiv1.PreprocessFoodRequest{Image: byID(req.ImageId), Config: cfg})
	if err != nil {
		return out, err
	}
	whole, err := vlmImage(resp.GetWhole())
	if err != nil {
		return out, err
	}
	crops := make([]api.VlmImage, 0, len(resp.GetCrops()))
	for _, c := range resp.GetCrops() {
		v, err := vlmImage(c)
		if err != nil {
			return out, err
		}
		crops = append(crops, v)
	}
	steps, err := stepList(resp.GetSteps())
	if err != nil {
		return out, err
	}
	dishes := make([]api.Box, 0, len(resp.GetDishes()))
	for _, b := range resp.GetDishes() {
		dishes = append(dishes, api.Box{X: int(b.GetX()), Y: int(b.GetY()), W: int(b.GetW()), H: int(b.GetH())})
	}
	plates := make([]api.Ellipse, 0, len(resp.GetPlates()))
	for _, e := range resp.GetPlates() {
		plates = append(plates, api.Ellipse{
			Cx: e.GetCx(), Cy: e.GetCy(), Major: e.GetMajor(), Minor: e.GetMinor(), Angle: e.GetAngle(),
		})
	}
	return api.FoodResult{
		Whole:         whole,
		DishesEnabled: resp.GetDishesEnabled(),
		Dishes:        dishes,
		Crops:         crops,
		PlatesEnabled: resp.GetPlatesEnabled(),
		Plates:        plates,
		Warnings:      nonNil(resp.GetWarnings()),
		Steps:         steps,
	}, nil
}

func hit(h *dietaiv1.DecodeHit) api.DecodeHit {
	return api.DecodeHit{
		Format:  h.GetFormat(),
		Text:    h.GetText(),
		Raw:     nonNil(h.GetRaw()),
		Corners: pointList(h.GetCorners()),
	}
}

func hitList(hits []*dietaiv1.DecodeHit) []api.DecodeHit {
	out := make([]api.DecodeHit, 0, len(hits))
	for _, h := range hits {
		out = append(out, hit(h))
	}
	return out
}

func attemptList(attempts []*dietaiv1.RungAttempt) ([]api.RungAttempt, error) {
	out := make([]api.RungAttempt, 0, len(attempts))
	for _, a := range attempts {
		params := map[string]any{}
		if a.GetParamsJson() != "" {
			if err := json.Unmarshal([]byte(a.GetParamsJson()), &params); err != nil {
				return nil, fmt.Errorf("workbench: 解析 %s 階的參數: %w", a.GetRung(), err)
			}
		}
		out = append(out, api.RungAttempt{
			Rung:      a.GetRung(),
			Params:    params,
			ElapsedMs: a.GetElapsedMs(),
			Hits:      hitList(a.GetHits()),
			Rejected:  hitList(a.GetRejected()),
			Skipped:   a.GetSkipped(),
		})
	}
	return out, nil
}

func pointList(points []*dietaiv1.Point) []api.Point {
	out := make([]api.Point, 0, len(points))
	for _, p := range points {
		out = append(out, api.Point{X: p.GetX(), Y: p.GetY()})
	}
	return out
}

// imageOutput 轉成工作台的影像參照。開發模式下 Python 一律回傳 artifact_id；
// 直接附上檔案表示 Python 沒有開啟開發模式。
func imageOutput(o *dietaiv1.ImageOutput) (api.ImageOutput, error) {
	id := o.GetArtifactId()
	if id == "" {
		return api.ImageOutput{}, &Error{http.StatusBadGateway, "AI_NOT_DEV_MODE", "Python 未以開發模式啟動（WORKBENCH_DEV_TOOLS=1），沒有回傳暫存影像", ""}
	}
	return api.ImageOutput{ArtifactId: id, Width: o.GetWidth(), Height: o.GetHeight()}, nil
}

func vlmImage(v *dietaiv1.VlmImage) (api.VlmImage, error) {
	img, err := imageOutput(v.GetImage())
	if err != nil {
		return api.VlmImage{}, err
	}
	return api.VlmImage{Image: img, NumBytes: v.GetNumBytes(), Scale: v.GetScale()}, nil
}
