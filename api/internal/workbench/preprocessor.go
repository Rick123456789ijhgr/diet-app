package workbench

import (
	"context"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/coldstart"
)

// Preprocessor 以 Python 的 PreprocessService 實作 coldstart.Preprocessor：
// 每張照片做品質檢查；條碼照片另做條碼解碼，營養標示照片另做標示前處理（只取四角與警告）。
type Preprocessor struct {
	ai dietaiv1.PreprocessServiceClient
}

func NewPreprocessor(ai dietaiv1.PreprocessServiceClient) *Preprocessor {
	return &Preprocessor{ai: ai}
}

var _ coldstart.Preprocessor = (*Preprocessor)(nil)

func (p *Preprocessor) Preprocess(ctx context.Context, kind coldstart.Kind, data []byte) coldstart.ImagePreprocess {
	out := coldstart.ImagePreprocess{Warnings: []string{}}
	input := func() *dietaiv1.ImageInput {
		return &dietaiv1.ImageInput{Source: &dietaiv1.ImageInput_Encoded{Encoded: data}}
	}
	addWarnings := func(ws []string) {
		for _, w := range ws {
			if !contains(out.Warnings, w) {
				out.Warnings = append(out.Warnings, w)
			}
		}
	}

	q, err := p.ai.CheckQuality(ctx, &dietaiv1.CheckQualityRequest{Image: input()})
	if err != nil {
		out.Error = "品質檢查失敗：" + toError(err).Message
		return out
	}
	passed := q.GetPassed()
	out.QualityPassed = &passed
	addWarnings(q.GetWarnings())

	switch kind {
	case coldstart.KindBarcode:
		resp, err := p.ai.DecodeBarcode(ctx, &dietaiv1.DecodeBarcodeRequest{Image: input()})
		if err != nil {
			out.Error = "條碼解碼失敗：" + toError(err).Message
			return out
		}
		for _, h := range resp.GetHits() {
			out.Barcodes = append(out.Barcodes, coldstart.BarcodeHit{Format: h.GetFormat(), Text: h.GetText()})
		}
		addWarnings(resp.GetWarnings())
	case coldstart.KindLabel:
		resp, err := p.ai.PreprocessLabel(ctx, &dietaiv1.PreprocessLabelRequest{Image: input()})
		if err != nil {
			out.Error = "營養標示前處理失敗：" + toError(err).Message
			return out
		}
		for _, pt := range resp.GetQuad() {
			out.LabelQuad = append(out.LabelQuad, coldstart.Point{X: pt.GetX(), Y: pt.GetY()})
		}
		addWarnings(resp.GetWarnings())
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
