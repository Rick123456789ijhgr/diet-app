package workbench

import (
	"context"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/coldstart"
)

// Preprocessor 以 Python 的 PreprocessService 實作 coldstart.Preprocessor：
// 每張照片做品質檢查；條碼照片另做條碼解碼，營養標示照片另做標示前處理（只取四角與警告）。
//
// 與 Service 不同，這裡直接送出影像本體（ImageInput.Encoded）而非 image_id，因此不依賴 Python
// 的開發模式暫存區，也只需要正式的 PreprocessService。所有呼叫都用預設設定（不帶覆寫）。
type Preprocessor struct {
	ai dietaiv1.PreprocessServiceClient
}

// NewPreprocessor 以 PreprocessService 客戶端建立 Preprocessor（正式為 aiclient.Client）。
func NewPreprocessor(ai dietaiv1.PreprocessServiceClient) *Preprocessor {
	return &Preprocessor{ai: ai}
}

var _ coldstart.Preprocessor = (*Preprocessor)(nil)

// Preprocess 依照片種類依序呼叫 Python。依 coldstart.Preprocessor 的約定不回傳錯誤：
// 任一步失敗就把原因寫進 Error 並回傳已取得的部分結果，前處理失敗不會讓上傳失敗。
//
// 各呼叫依序執行；ctx 由 coldstart.Service 傳入，沒有期限時每次呼叫各自套用 aiclient 的預設逾時。
func (p *Preprocessor) Preprocess(ctx context.Context, kind coldstart.Kind, data []byte) coldstart.ImagePreprocess {
	out := coldstart.ImagePreprocess{Warnings: []string{}}
	// 每次呼叫各建一個 ImageInput（共用同一份 data，不複製位元組）
	input := func() *dietaiv1.ImageInput {
		return &dietaiv1.ImageInput{Source: &dietaiv1.ImageInput_Encoded{Encoded: data}}
	}
	// 品質檢查與後續步驟可能回報相同的警告代碼，合併時去除重複並保留先後順序
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
	// 品質未通過仍繼續做條碼／標示前處理，結果一併記錄；指標為 nil 表示品質檢查沒有執行成功
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

// contains 回報 xs 是否含有 x；警告清單很短，線性搜尋即可。
func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
