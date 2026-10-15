package workbench

import (
	"context"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
)

// 冷啟動上傳（任務書 2.6 節）。

func (h *handler) ListSubmissions(context.Context, api.ListSubmissionsRequestObject) (api.ListSubmissionsResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) CreateSubmission(context.Context, api.CreateSubmissionRequestObject) (api.CreateSubmissionResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) GetSubmission(context.Context, api.GetSubmissionRequestObject) (api.GetSubmissionResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) UploadSubmissionImage(context.Context, api.UploadSubmissionImageRequestObject) (api.UploadSubmissionImageResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) GetSubmissionImage(context.Context, api.GetSubmissionImageRequestObject) (api.GetSubmissionImageResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) SaveDraft(context.Context, api.SaveDraftRequestObject) (api.SaveDraftResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) ConfirmSubmission(context.Context, api.ConfirmSubmissionRequestObject) (api.ConfirmSubmissionResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) RejectSubmission(context.Context, api.RejectSubmissionRequestObject) (api.RejectSubmissionResponseObject, error) {
	return nil, errNotImplemented
}

func (h *handler) GetProduct(context.Context, api.GetProductRequestObject) (api.GetProductResponseObject, error) {
	return nil, errNotImplemented
}
