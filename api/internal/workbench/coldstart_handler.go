package workbench

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/coldstart"
)

// 冷啟動上傳（任務書 2.6 節）：只做登入檢查與型別轉換，流程在 coldstart.Service。

// currentUser 取出登入者；未登入時回 401。
func currentUser(ctx context.Context) (auth.User, error) {
	u, ok := auth.UserFrom(ctx)
	if !ok {
		return auth.User{}, auth.ErrUnauthenticated
	}
	return u, nil
}

func ifMatch(v *api.IfMatch) string {
	if v == nil {
		return ""
	}
	return *v
}

func (h *handler) ListSubmissions(ctx context.Context, req api.ListSubmissionsRequestObject) (api.ListSubmissionsResponseObject, error) {
	if _, err := currentUser(ctx); err != nil {
		return nil, err
	}
	var status coldstart.Status
	if req.Params.Status != nil {
		status = coldstart.Status(*req.Params.Status)
	}
	limit := 50
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	items, err := h.cs.List(ctx, status, limit)
	if err != nil {
		return nil, err
	}
	out := api.ListSubmissions200JSONResponse{Items: make([]api.SubmissionSummary, 0, len(items))}
	for _, s := range items {
		sum := api.SubmissionSummary{
			Id: s.ID, Status: api.SubmissionStatus(s.Status), CreatedBy: userRef(s.CreatedBy),
			UpdatedAt: s.UpdatedAt, Images: make([]api.ImageKind, len(s.Images)),
		}
		for i, k := range s.Images {
			sum.Images[i] = api.ImageKind(k)
		}
		if s.Barcode != "" {
			sum.Barcode = &s.Barcode
		}
		if s.Name != "" {
			sum.Name = &s.Name
		}
		out.Items = append(out.Items, sum)
	}
	return out, nil
}

func (h *handler) CreateSubmission(ctx context.Context, _ api.CreateSubmissionRequestObject) (api.CreateSubmissionResponseObject, error) {
	u, err := currentUser(ctx)
	if err != nil {
		return nil, err
	}
	sub, err := h.cs.Create(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	out, err := submission(sub)
	return api.CreateSubmission201JSONResponse(out), err
}

func (h *handler) GetSubmission(ctx context.Context, req api.GetSubmissionRequestObject) (api.GetSubmissionResponseObject, error) {
	if _, err := currentUser(ctx); err != nil {
		return nil, err
	}
	sub, err := h.cs.Get(ctx, req.SubmissionId)
	if err != nil {
		return nil, err
	}
	out, err := submission(sub)
	return api.GetSubmission200JSONResponse(out), err
}

func (h *handler) UploadSubmissionImage(ctx context.Context, req api.UploadSubmissionImageRequestObject) (api.UploadSubmissionImageResponseObject, error) {
	if _, err := currentUser(ctx); err != nil {
		return nil, err
	}
	_, data, err := readUpload(req.Body)
	if err != nil {
		return nil, err
	}
	sub, err := h.cs.UploadImage(ctx, req.SubmissionId, coldstart.Kind(req.Kind), data)
	if err != nil {
		return nil, err
	}
	out, err := submission(sub)
	return api.UploadSubmissionImage200JSONResponse(out), err
}

func (h *handler) GetSubmissionImage(ctx context.Context, req api.GetSubmissionImageRequestObject) (api.GetSubmissionImageResponseObject, error) {
	if _, err := currentUser(ctx); err != nil {
		return nil, err
	}
	data, contentType, err := h.cs.ImageData(ctx, req.SubmissionId, coldstart.Kind(req.Kind))
	if err != nil {
		return nil, err
	}
	return imageResponse{data: data, contentType: contentType}, nil
}

func (h *handler) SaveDraft(ctx context.Context, req api.SaveDraftRequestObject) (api.SaveDraftResponseObject, error) {
	if _, err := currentUser(ctx); err != nil {
		return nil, err
	}
	var draft coldstart.Draft
	if err := convert(*req.Body, &draft); err != nil {
		return nil, err
	}
	sub, err := h.cs.SaveDraft(ctx, req.SubmissionId, draft, ifMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	out, err := submission(sub)
	return api.SaveDraft200JSONResponse(out), err
}

func (h *handler) ConfirmSubmission(ctx context.Context, req api.ConfirmSubmissionRequestObject) (api.ConfirmSubmissionResponseObject, error) {
	u, err := currentUser(ctx)
	if err != nil {
		return nil, err
	}
	creq := coldstart.ConfirmRequest{Mode: coldstart.Mode(req.Body.Mode)}
	if req.Body.ProductId != nil {
		creq.ProductID = *req.Body.ProductId
	}
	if req.Body.AcceptWarnings != nil {
		creq.AcceptWarnings = *req.Body.AcceptWarnings
	}
	sub, product, err := h.cs.Confirm(ctx, u.ID, req.SubmissionId, creq, ifMatch(req.Params.IfMatch))

	var exists *coldstart.BarcodeExistsError
	if errors.As(err, &exists) {
		p := productOut(exists.Product)
		return api.ConfirmSubmission409JSONResponse{ConflictJSONResponse: api.ConflictJSONResponse{
			Code: "BARCODE_EXISTS", Message: exists.Error(), Product: &p,
		}}, nil
	}
	var problem *coldstart.ProblemError
	if errors.As(err, &problem) {
		return api.ConfirmSubmission422JSONResponse(problemOut(problem)), nil
	}
	if err != nil {
		return nil, err
	}
	out, err := submission(sub)
	return api.ConfirmSubmission200JSONResponse{Submission: out, Product: productOut(product)}, err
}

func (h *handler) RejectSubmission(ctx context.Context, req api.RejectSubmissionRequestObject) (api.RejectSubmissionResponseObject, error) {
	if _, err := currentUser(ctx); err != nil {
		return nil, err
	}
	sub, err := h.cs.Reject(ctx, req.SubmissionId, req.Body.Reason, ifMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	out, err := submission(sub)
	return api.RejectSubmission200JSONResponse(out), err
}

func (h *handler) GetProduct(ctx context.Context, req api.GetProductRequestObject) (api.GetProductResponseObject, error) {
	if _, err := currentUser(ctx); err != nil {
		return nil, err
	}
	p, err := h.cs.Product(ctx, req.Barcode)
	if err != nil {
		return nil, err
	}
	return api.GetProduct200JSONResponse(productOut(p)), nil
}

// ── 型別轉換 ──

// convert 以 JSON 轉換欄位名稱相同的型別（API 的 Draft、Nutrients 與 coldstart 的對應型別）。
func convert(from, to any) error {
	b, err := json.Marshal(from)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, to); err != nil {
		return fmt.Errorf("workbench: 轉換 %T: %w", to, err)
	}
	return nil
}

func userRef(u coldstart.UserRef) api.User {
	return api.User{Id: u.ID, Username: u.Username, DisplayName: u.DisplayName}
}

func submission(s coldstart.Submission) (api.Submission, error) {
	out := api.Submission{
		Id: s.ID, Status: api.SubmissionStatus(s.Status), CreatedBy: userRef(s.CreatedBy),
		CreatedAt: s.CreatedAt, UpdatedAt: s.Version(), ConfirmedAt: s.ConfirmedAt,
		Images: make([]api.SubmissionImage, 0, len(s.Images)),
	}
	if err := convert(s.Draft, &out.Draft); err != nil {
		return out, err
	}
	if s.ProductID != "" {
		out.ProductId = &s.ProductID
	}
	if s.RejectReason != "" {
		out.RejectReason = &s.RejectReason
	}
	if s.ConfirmedBy != nil {
		u := userRef(*s.ConfirmedBy)
		out.ConfirmedBy = &u
	}
	for _, img := range s.Images {
		var pre api.ImagePreprocess
		if err := convert(img.Preprocess, &pre); err != nil {
			return out, err
		}
		out.Images = append(out.Images, api.SubmissionImage{
			Kind: api.ImageKind(img.Kind), Width: img.Width, Height: img.Height,
			ContentType: img.ContentType, UploadedAt: img.UploadedAt, Preprocess: pre,
		})
	}
	return out, nil
}

func nutritionFacts(nf coldstart.NutritionFacts) *api.NutritionFacts {
	v := nf.Values
	return &api.NutritionFacts{
		EnergyKcal: v.EnergyKcal, ProteinG: v.ProteinG, FatG: v.FatG, SaturatedFatG: v.SaturatedFatG,
		TransFatG: v.TransFatG, CarbohydrateG: v.CarbohydrateG, SugarG: v.SugarG, SodiumMg: v.SodiumMg,
		ConfirmedBy: userRef(nf.ConfirmedBy), ConfirmedAt: nf.ConfirmedAt,
	}
}

func productOut(p coldstart.Product) api.Product {
	out := api.Product{
		Id: p.ID, Gtin: p.GTIN, Barcode: p.Barcode, Name: p.Name, NetContent: p.NetContent,
		ContentUnit: api.ContentUnit(p.ContentUnit), ServingSize: p.ServingSize,
		ServingsPerPackage: p.ServingsPerPackage, CreatedAt: p.CreatedAt,
		Images: make([]api.ProductImage, 0, len(p.Images)),
	}
	if p.Brand != "" {
		out.Brand = &p.Brand
	}
	if nf, ok := p.Nutrition[coldstart.PerServing]; ok {
		out.Nutrition.PerServing = nutritionFacts(nf)
	}
	if nf, ok := p.Nutrition[coldstart.Per100]; ok {
		out.Nutrition.Per100 = nutritionFacts(nf)
	}
	for _, img := range p.Images {
		out.Images = append(out.Images, api.ProductImage{
			Kind: api.ImageKind(img.Kind), SubmissionId: img.SubmissionID, Width: img.Width, Height: img.Height,
		})
	}
	return out
}

func problemOut(p *coldstart.ProblemError) api.ConfirmProblem {
	out := api.ConfirmProblem{Code: p.Code, Message: p.Message}
	if len(p.Missing) > 0 {
		out.Missing = &p.Missing
	}
	if len(p.Issues) > 0 {
		issues := make([]api.NutritionIssue, 0, len(p.Issues))
		for _, i := range p.Issues {
			issue := api.NutritionIssue{
				Code: i.Code, Basis: api.NutritionIssueBasis(i.Basis), Message: i.Message,
				Expected: i.Expected, Actual: i.Actual,
			}
			if i.Nutrient != "" {
				n := i.Nutrient
				issue.Nutrient = &n
			}
			issues = append(issues, issue)
		}
		out.Issues = &issues
	}
	return out
}

// imageResponse 回傳照片原檔（JPEG 或 PNG）；登入後才能取得，只在瀏覽器私有快取。
type imageResponse struct {
	data        []byte
	contentType string
}

func (r imageResponse) VisitGetSubmissionImageResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", r.contentType)
	w.Header().Set("Cache-Control", "private, no-cache")
	w.WriteHeader(http.StatusOK)
	_, err := io.Copy(w, bytes.NewReader(r.data))
	return err
}
