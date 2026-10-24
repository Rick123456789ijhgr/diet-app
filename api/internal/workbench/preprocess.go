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
//
// 共同模式：前端以 image_id 指定先前暫存在 Python 的影像（不重傳影像本體），參數只送與預設值
// 不同的覆寫（ConfigOverride JSON）；回應中的 *_json 欄位在這裡解析成物件，空清單補成 []，
// 讓前端拿到的 JSON 形狀固定。Go 不做任何影像處理或判斷，只轉接。

// byID 以暫存影像 ID 指定輸入；暫存區只在 Python 開發模式存在。
func byID(id string) *dietaiv1.ImageInput {
	return &dietaiv1.ImageInput{Source: &dietaiv1.ImageInput_ImageId{ImageId: id}}
}

// override 把前端的設定覆寫轉成 proto；沒有覆寫時 Json 為空字串，Python 全部用預設值。
func override(o *api.ConfigOverride) (*dietaiv1.ConfigOverride, error) {
	s, err := overrideJSON(o)
	if err != nil {
		return nil, err
	}
	return &dietaiv1.ConfigOverride{Json: s}, nil
}

// DecodeBarcode 以條碼逐步升級解碼。
//
// Ladder 為各階（rung）的開關與參數，Zxing 為解碼器參數。Attempts 是每一階的嘗試紀錄
// （含被拒絕的結果與是否略過），供工作台逐階檢視；SuccessIndex 為 -1 表示失敗。
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
	// 失敗時 proto 為空字串，轉成 OpenAPI 的選填欄位（省略）
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
	// 左右 QR 各自可能找不到；找不到時保持 nil（JSON 省略），不以空物件表示
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
//
// Image 為校正後的影像（以 artifact_id 參照，前端再經 GetArtifact 取得）；Quad 為原圖上的四角，
// QuadMethod 為找到四角所用的方法（contour／hough，找不到時省略）。GlareRatio 在光斑步驟未啟用時為 -1。
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
	// Whole 為送給 VLM 的整張影像，Crops 為各道菜的裁切；兩者都只回傳 artifact 參照
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

// hit 轉換一筆解碼結果。Raw 為原始位元組（JSON 中以 base64 表示），發票 QR 的中文
// 由之後的發票模組自行解碼，這裡不轉成字串。
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

// attemptList 轉換逐階嘗試紀錄；Python 回傳的參數 JSON 解析失敗時視為內部錯誤（500）。
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

// vlmImage 轉換送給 VLM 的影像；影像同樣必須是 artifact 參照，NumBytes 與 Scale 原樣轉傳。
func vlmImage(v *dietaiv1.VlmImage) (api.VlmImage, error) {
	img, err := imageOutput(v.GetImage())
	if err != nil {
		return api.VlmImage{}, err
	}
	return api.VlmImage{Image: img, NumBytes: v.GetNumBytes(), Scale: v.GetScale()}, nil
}
