package workbench

import (
	"context"
	"net/http"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
)

// 圖片批次命名（通用工具）：把「檔名就是條碼」的照片改成 <類別>_<批次>_<序號>_<條碼>。
// 規劃、改名與還原都在 Python（dietai.devtools.image_naming）；Go 只轉送參數，未填的欄位送零值，
// 由 Python 換成預設值。改名時 Python 依資料夾重新規劃，不採用前端的預覽結果。

// namingOptions 把 HTTP 請求轉成 gRPC 的命名參數；編號順序不在列舉內時回 INVALID_PARAMS。
func namingOptions(req api.ImageNamingRequest) (*dietaiv1.ImageNamingOptions, error) {
	if req.Order != nil && !req.Order.Valid() {
		return nil, &Error{http.StatusBadRequest, "INVALID_PARAMS", "編號順序只能是 mtime 或 name", "order"}
	}
	o := &dietaiv1.ImageNamingOptions{
		Folder:         req.Folder,
		Category:       deref(req.Category),
		Batch:          deref(req.Batch),
		Start:          int32(deref(req.Start)),
		Width:          int32(deref(req.Width)),
		IncludeUnknown: deref(req.IncludeUnknown),
		NoCode:         deref(req.NoCode),
	}
	if req.Order != nil {
		o.Order = string(*req.Order)
	}
	return o, nil
}

// PreviewImageNames 預覽規則化檔名（不動任何檔案）。
func (s *Service) PreviewImageNames(ctx context.Context, req api.ImageNamingRequest) (api.FreeJson, error) {
	opts, err := namingOptions(req)
	if err != nil {
		return nil, err
	}
	resp, err := s.ai.PreviewImageNames(ctx, &dietaiv1.PreviewImageNamesRequest{Options: opts})
	if err != nil {
		return nil, err
	}
	return object(resp.GetJson())
}

// ApplyImageNames 依目前的資料夾重新規劃後改名。
func (s *Service) ApplyImageNames(ctx context.Context, req api.ImageNamingRequest) (api.FreeJson, error) {
	opts, err := namingOptions(req)
	if err != nil {
		return nil, err
	}
	resp, err := s.ai.ApplyImageNames(ctx, &dietaiv1.ApplyImageNamesRequest{Options: opts})
	if err != nil {
		return nil, err
	}
	return object(resp.GetJson())
}

// UndoImageNames 依資料夾的改名紀錄還原全部改名。
func (s *Service) UndoImageNames(ctx context.Context, folder string) (api.FreeJson, error) {
	resp, err := s.ai.UndoImageNames(ctx, &dietaiv1.UndoImageNamesRequest{Folder: folder})
	if err != nil {
		return nil, err
	}
	return object(resp.GetJson())
}

func (h *handler) PreviewImageNames(ctx context.Context, req api.PreviewImageNamesRequestObject) (api.PreviewImageNamesResponseObject, error) {
	out, err := h.svc.PreviewImageNames(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.PreviewImageNames200JSONResponse(out), nil
}

func (h *handler) ApplyImageNames(ctx context.Context, req api.ApplyImageNamesRequestObject) (api.ApplyImageNamesResponseObject, error) {
	out, err := h.svc.ApplyImageNames(ctx, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.ApplyImageNames200JSONResponse(out), nil
}

func (h *handler) UndoImageNames(ctx context.Context, req api.UndoImageNamesRequestObject) (api.UndoImageNamesResponseObject, error) {
	out, err := h.svc.UndoImageNames(ctx, req.Body.Folder)
	if err != nil {
		return nil, err
	}
	return api.UndoImageNames200JSONResponse(out), nil
}
