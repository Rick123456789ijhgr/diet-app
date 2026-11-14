package workbench

import (
	"context"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
)

// ListFolders 列出本機資料夾的子資料夾與影像張數（工作台的「瀏覽…」彈窗）；path 空字串為起點。
// 瀏覽器拿不到使用者選的資料夾的完整路徑，所以由 Python 列出；測試集鎖定也在 Python 檢查。
func (s *Service) ListFolders(ctx context.Context, path string) (api.FreeJson, error) {
	resp, err := s.ai.ListFolders(ctx, &dietaiv1.ListFoldersRequest{Path: path})
	if err != nil {
		return nil, err
	}
	return object(resp.GetJson())
}

func (h *handler) ListFolders(ctx context.Context, req api.ListFoldersRequestObject) (api.ListFoldersResponseObject, error) {
	out, err := h.svc.ListFolders(ctx, deref(req.Params.Path))
	if err != nil {
		return nil, err
	}
	return api.ListFolders200JSONResponse(out), nil
}
