package coldstart

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // 註冊解碼器：只讀寬高
	_ "image/png"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/your-org/diet-app/api/internal/barcode"
)

// Store 是上傳與產品的儲存；正式實作在 internal/pgstore。
type Store interface {
	CreateSubmission(ctx context.Context, userID string) (Submission, error)
	// ListSubmissions 新的在前；status 為空時列出全部。
	ListSubmissions(ctx context.Context, status Status, limit int) ([]SubmissionSummary, error)
	GetSubmission(ctx context.Context, id string) (Submission, error)
	ProductByGTIN(ctx context.Context, gtin string) (Product, error)
	// InTx 在交易中執行 fn；fn 回傳錯誤時復原。
	InTx(ctx context.Context, fn func(Tx) error) error
}

// Tx 是交易中的操作。查不到時一律回傳 ErrNotFound。
type Tx interface {
	// LockSubmission 讀取並鎖定一筆上傳（SELECT … FOR UPDATE）。
	LockSubmission(ctx context.Context, id string) (Submission, error)
	// SaveSubmission 寫回 Status、Draft、照片的前處理摘要、ProductID、RejectReason、確認者，
	// 更新 updated_at 並回傳寫入後的內容。
	SaveSubmission(ctx context.Context, s Submission) (Submission, error)
	// PutImage 新增或取代該種類的照片；回傳被取代的舊照片（沒有則為 nil）。
	PutImage(ctx context.Context, submissionID string, img Image) (*Image, error)
	ProductByGTIN(ctx context.Context, gtin string) (Product, error)
	ProductByID(ctx context.Context, id string) (Product, error)
	// CreateProduct 建立產品；同一 GTIN 已存在時回傳 ErrGTINTaken。
	CreateProduct(ctx context.Context, p NewProduct) (string, error)
	// AddNutrition 新增一版營養標示，並把同一產品、同一基準的舊版標記為已取代。
	AddNutrition(ctx context.Context, productID string, basis Basis, n Nutrients, userID string) error
	// SetServingSize 更新產品的每份份量（修正營養數值時，份量隨新版數值更新）。
	SetServingSize(ctx context.Context, productID string, size float64) error
	// AttachImages 把這筆上傳的照片掛到產品。
	AttachImages(ctx context.Context, submissionID, productID string) error
}

// ErrGTINTaken 由 Tx.CreateProduct 回傳：同一 GTIN 的產品已存在（並行確認時）。
var ErrGTINTaken = errors.New("同一條碼的產品已存在")

// Objects 是照片原檔的物件儲存（MinIO）。Get 找不到物件時，回傳的錯誤實作 NotFound() bool。
type Objects interface {
	Put(ctx context.Context, key string, data []byte, contentType string) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

// Preprocessor 對照片做前處理（Python）；失敗時把原因寫進 ImagePreprocess.Error，不回傳錯誤。
type Preprocessor interface {
	Preprocess(ctx context.Context, kind Kind, data []byte) ImagePreprocess
}

// MaxImageBytes 是照片原檔的上限（與 gRPC 訊息上限一致，留 1 MB 給其他欄位）。
const MaxImageBytes = 31 << 20

// Service 是冷啟動上傳的流程。
type Service struct {
	store   Store
	objects Objects
	pre     Preprocessor
	logger  *slog.Logger
}

// NewService 建立 Service；store 或 objects 為 nil 時所有操作回傳 ErrUnavailable。
func NewService(store Store, objects Objects, pre Preprocessor, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{store: store, objects: objects, pre: pre, logger: logger}
}

func (s *Service) ready() error {
	if s == nil || s.store == nil || s.objects == nil {
		return ErrUnavailable
	}
	return nil
}

func (s *Service) Create(ctx context.Context, userID string) (Submission, error) {
	if err := s.ready(); err != nil {
		return Submission{}, err
	}
	return s.store.CreateSubmission(ctx, userID)
}

func (s *Service) List(ctx context.Context, status Status, limit int) ([]SubmissionSummary, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if status != "" && status != StatusDraft && status != StatusConfirmed && status != StatusRejected {
		return nil, &InvalidError{"INVALID_REQUEST", "status", "未知的狀態"}
	}
	switch {
	case limit <= 0:
		limit = 50
	case limit > 200:
		limit = 200
	}
	return s.store.ListSubmissions(ctx, status, limit)
}

func (s *Service) Get(ctx context.Context, id string) (Submission, error) {
	if err := s.ready(); err != nil {
		return Submission{}, err
	}
	return s.store.GetSubmission(ctx, id)
}

// ImageData 回傳照片原檔與 content type。
func (s *Service) ImageData(ctx context.Context, id string, kind Kind) ([]byte, string, error) {
	if err := s.ready(); err != nil {
		return nil, "", err
	}
	sub, err := s.store.GetSubmission(ctx, id)
	if err != nil {
		return nil, "", err
	}
	img, ok := sub.Image(kind)
	if !ok {
		return nil, "", ErrNotFound
	}
	data, err := s.objects.Get(ctx, img.ObjectKey)
	var nf interface{ NotFound() bool }
	if errors.As(err, &nf) && nf.NotFound() {
		return nil, "", ErrNotFound // 資料庫有紀錄、物件儲存卻沒有檔案
	}
	if err != nil {
		return nil, "", err
	}
	return data, img.ContentType, nil
}

// UploadImage 保存照片原檔並做前處理。條碼照片解出唯一的條碼、且草稿尚未填條碼時預先填入。
func (s *Service) UploadImage(ctx context.Context, id string, kind Kind, data []byte) (Submission, error) {
	if err := s.ready(); err != nil {
		return Submission{}, err
	}
	if !kind.Valid() {
		return Submission{}, &InvalidError{"INVALID_REQUEST", "kind", "照片種類只能是 front、barcode、label"}
	}
	img, err := inspectImage(data)
	if err != nil {
		return Submission{}, err
	}
	img.Kind = kind
	// 先確認可上傳，避免已關閉的上傳白跑一次前處理與存檔
	sub, err := s.store.GetSubmission(ctx, id)
	if err != nil {
		return Submission{}, err
	}
	if sub.Status != StatusDraft {
		return Submission{}, ErrClosed
	}
	ext := map[string]string{"image/jpeg": "jpg", "image/png": "png"}[img.ContentType]
	img.ObjectKey = fmt.Sprintf("coldstart/%s/%s-%s.%s", id, kind, hex.EncodeToString(img.SHA256[:8]), ext)
	// 存檔與前處理互不相依，並行執行以縮短上傳等待
	putErr := make(chan error, 1)
	go func() { putErr <- s.objects.Put(ctx, img.ObjectKey, data, img.ContentType) }()
	if s.pre != nil {
		img.Preprocess = s.pre.Preprocess(ctx, kind, data)
	}
	if img.Preprocess.Warnings == nil {
		img.Preprocess.Warnings = []string{}
	}
	if err := <-putErr; err != nil {
		return Submission{}, fmt.Errorf("coldstart: 存入物件儲存: %w", err)
	}
	// 同一內容重傳時物件鍵相同：失敗時不可刪除，否則會刪到資料庫仍指向的檔案
	if old, ok := sub.Image(kind); !ok || old.ObjectKey != img.ObjectKey {
		defer func() {
			if err != nil {
				s.deleteObject(ctx, img.ObjectKey)
			}
		}()
	}

	var out Submission
	var replaced *Image
	err = s.store.InTx(ctx, func(tx Tx) error {
		sub, err := tx.LockSubmission(ctx, id)
		if err != nil {
			return err
		}
		if sub.Status != StatusDraft {
			return ErrClosed
		}
		if replaced, err = tx.PutImage(ctx, id, img); err != nil {
			return err
		}
		sub.Images = replaceImage(sub.Images, img)
		if kind == KindBarcode && blank(sub.Draft.Barcode) {
			if code, ok := uniqueBarcode(img.Preprocess.Barcodes); ok {
				sub.Draft = sub.Draft.clone()
				sub.Draft.Barcode = &code
			}
		}
		out, err = tx.SaveSubmission(ctx, sub)
		return err
	})
	if err != nil {
		return Submission{}, err
	}
	if replaced != nil && replaced.ObjectKey != img.ObjectKey {
		s.deleteObject(ctx, replaced.ObjectKey)
	}
	return out, nil
}

// deleteObject 刪除不再被資料庫指向的物件；失敗不影響結果，只記錄。
func (s *Service) deleteObject(ctx context.Context, key string) {
	if err := s.objects.Delete(context.WithoutCancel(ctx), key); err != nil {
		s.logger.WarnContext(ctx, "coldstart: 刪除照片失敗", "key", key, "err", err)
	}
}

// SaveDraft 儲存人工輸入；version 非空時須與目前版本相同。
func (s *Service) SaveDraft(ctx context.Context, id string, draft Draft, version string) (Submission, error) {
	if err := s.ready(); err != nil {
		return Submission{}, err
	}
	if err := validateDraft(draft); err != nil {
		return Submission{}, err
	}
	var out Submission
	err := s.store.InTx(ctx, func(tx Tx) error {
		sub, err := lockOpen(ctx, tx, id, version)
		if err != nil {
			return err
		}
		sub.Draft = draft
		out, err = tx.SaveSubmission(ctx, sub)
		return err
	})
	return out, err
}

// Reject 退回一筆上傳。
func (s *Service) Reject(ctx context.Context, id, reason, version string) (Submission, error) {
	if err := s.ready(); err != nil {
		return Submission{}, err
	}
	if strings.TrimSpace(reason) == "" {
		return Submission{}, &InvalidError{"INVALID_REQUEST", "reason", "請填寫退回原因"}
	}
	var out Submission
	err := s.store.InTx(ctx, func(tx Tx) error {
		sub, err := lockOpen(ctx, tx, id, version)
		if err != nil {
			return err
		}
		sub.Status = StatusRejected
		sub.RejectReason = strings.TrimSpace(reason)
		out, err = tx.SaveSubmission(ctx, sub)
		return err
	})
	return out, err
}

// Product 以條碼查產品（UPC-A 與 EAN-13 視為同一條碼）。
func (s *Service) Product(ctx context.Context, code string) (Product, error) {
	if err := s.ready(); err != nil {
		return Product{}, err
	}
	gtin, err := barcode.NormalizeGTIN(code)
	if err != nil {
		return Product{}, &InvalidError{"INVALID_BARCODE", "barcode", err.Error()}
	}
	return s.store.ProductByGTIN(ctx, gtin)
}

// Confirm 確認上傳並寫入產品資料庫（見 ConfirmRequest 的三種方式）。
func (s *Service) Confirm(ctx context.Context, userID, id string, req ConfirmRequest, version string) (Submission, Product, error) {
	if err := s.ready(); err != nil {
		return Submission{}, Product{}, err
	}
	switch req.Mode {
	case ModeCreate:
	case ModeAddImages, ModeReviseNutrition:
		if req.ProductID == "" {
			return Submission{}, Product{}, &InvalidError{"INVALID_REQUEST", "product_id", "請指定既有產品"}
		}
	default:
		return Submission{}, Product{}, &InvalidError{"INVALID_REQUEST", "mode", "未知的確認方式"}
	}
	var outSub Submission
	var outProduct Product
	err := s.store.InTx(ctx, func(tx Tx) error {
		sub, err := lockOpen(ctx, tx, id, version)
		if err != nil {
			return err
		}
		productID, err := apply(ctx, tx, sub, userID, req)
		if err != nil {
			return err
		}
		if err := tx.AttachImages(ctx, sub.ID, productID); err != nil {
			return err
		}
		now := time.Now()
		sub.Status = StatusConfirmed
		sub.ProductID = productID
		sub.ConfirmedBy = &UserRef{ID: userID}
		sub.ConfirmedAt = &now
		if outSub, err = tx.SaveSubmission(ctx, sub); err != nil {
			return err
		}
		outProduct, err = tx.ProductByID(ctx, productID)
		return err
	})
	return outSub, outProduct, err
}

// apply 依確認方式寫入產品與營養標示，回傳產品 ID。
func apply(ctx context.Context, tx Tx, sub Submission, userID string, req ConfirmRequest) (string, error) {
	d := sub.Draft
	var gtin string
	if !blank(d.Barcode) {
		var err error
		if gtin, err = barcode.NormalizeGTIN(*d.Barcode); err != nil {
			return "", &InvalidError{"INVALID_BARCODE", "barcode", err.Error()}
		}
	}

	var product *Product
	if req.Mode == ModeCreate {
		// 先判斷條碼是否已存在：人可以改選補照片或修正數值，不必先補齊其他欄位
		if gtin != "" {
			existing, err := tx.ProductByGTIN(ctx, gtin)
			if err == nil {
				return "", &BarcodeExistsError{Product: existing}
			}
			if !errors.Is(err, ErrNotFound) {
				return "", err
			}
		}
	} else {
		p, err := tx.ProductByID(ctx, req.ProductID)
		if errors.Is(err, ErrNotFound) {
			return "", &InvalidError{"INVALID_REQUEST", "product_id", "找不到指定的產品"}
		}
		if err != nil {
			return "", err
		}
		if gtin != "" && gtin != p.GTIN {
			return "", &InvalidError{"BARCODE_MISMATCH", "barcode", "草稿的條碼與指定產品不同"}
		}
		product = &p
	}

	if missing := Missing(sub, req.Mode, product); len(missing) > 0 {
		return "", &ProblemError{Code: "DRAFT_INCOMPLETE", Message: "還有必填的欄位或照片沒有完成", Missing: missing}
	}

	if req.Mode == ModeAddImages {
		return product.ID, nil
	}

	perServing, per100 := complete(d.Nutrition.PerServing), complete(d.Nutrition.Per100)
	serving := d.ServingSize
	if serving == nil && product != nil {
		serving = product.ServingSize
	}
	if issues := NutritionIssues(perServing, per100, serving); len(issues) > 0 && !req.AcceptWarnings {
		return "", &ProblemError{Code: "NUTRITION_INCONSISTENT", Message: "營養數值不一致，請核對標示", Issues: issues}
	}

	productID := req.ProductID
	if req.Mode == ModeReviseNutrition && d.ServingSize != nil &&
		(product.ServingSize == nil || Round2(*d.ServingSize) != *product.ServingSize) {
		// 新的每份數值依草稿的份量；份量一併寫回產品，兩者才一致
		if err := tx.SetServingSize(ctx, productID, Round2(*d.ServingSize)); err != nil {
			return "", err
		}
	}
	if req.Mode == ModeCreate {
		var err error
		productID, err = tx.CreateProduct(ctx, NewProduct{
			GTIN: gtin, Barcode: strings.TrimSpace(*d.Barcode), Name: strings.TrimSpace(*d.Name),
			Brand: trimmed(d.Brand), NetContent: round2p(d.NetContent), ContentUnit: *d.ContentUnit,
			ServingSize: round2p(d.ServingSize), ServingsPerPackage: round2p(d.ServingsPerPackage),
			CreatedBy: userID,
		})
		if errors.Is(err, ErrGTINTaken) {
			existing, perr := tx.ProductByGTIN(ctx, gtin)
			if perr != nil {
				return "", perr
			}
			return "", &BarcodeExistsError{Product: existing}
		}
		if err != nil {
			return "", err
		}
	}
	// 依固定順序寫入，測試與紀錄可重現
	for _, b := range []struct {
		basis Basis
		n     Nutrients
	}{{PerServing, perServing}, {Per100, per100}} {
		if err := tx.AddNutrition(ctx, productID, b.basis, b.n, userID); err != nil {
			return "", err
		}
	}
	return productID, nil
}

// lockOpen 鎖定一筆仍可修改的上傳並檢查版本。
func lockOpen(ctx context.Context, tx Tx, id, version string) (Submission, error) {
	sub, err := tx.LockSubmission(ctx, id)
	if err != nil {
		return Submission{}, err
	}
	if sub.Status != StatusDraft {
		return Submission{}, ErrClosed
	}
	if version != "" {
		want, err := time.Parse(time.RFC3339Nano, version)
		if err != nil || !want.Equal(sub.UpdatedAt) {
			return Submission{}, ErrStale
		}
	}
	return sub, nil
}

// inspectImage 檢查格式（只接受 JPEG／PNG）、讀取寬高並計算雜湊。
func inspectImage(data []byte) (Image, error) {
	if len(data) == 0 {
		return Image{}, &InvalidError{"INVALID_REQUEST", "file", "檔案是空的"}
	}
	if len(data) > MaxImageBytes {
		return Image{}, &InvalidError{"IMAGE_TOO_LARGE", "file", fmt.Sprintf("照片超過 %d MB", MaxImageBytes>>20)}
	}
	contentType := http.DetectContentType(data)
	if contentType != "image/jpeg" && contentType != "image/png" {
		return Image{}, &InvalidError{"UNSUPPORTED_IMAGE", "file", "只接受 JPEG 或 PNG"}
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return Image{}, &InvalidError{"UNSUPPORTED_IMAGE", "file", "無法讀取影像：" + err.Error()}
	}
	sum := sha256.Sum256(data)
	return Image{SHA256: sum[:], ContentType: contentType, Width: cfg.Width, Height: cfg.Height, UploadedAt: time.Now()}, nil
}

func replaceImage(images []Image, img Image) []Image {
	out := make([]Image, 0, len(images)+1)
	for _, k := range Kinds {
		if k == img.Kind {
			out = append(out, img)
			continue
		}
		for _, old := range images {
			if old.Kind == k {
				out = append(out, old)
			}
		}
	}
	return out
}

// uniqueBarcode 回傳唯一有效的商品條碼（UPC-A 與 EAN-13 視為同一個）；沒有或有多個時 ok 為 false。
func uniqueBarcode(hits []BarcodeHit) (string, bool) {
	var code, gtin string
	for _, h := range hits {
		g, err := barcode.NormalizeGTIN(h.Text)
		if err != nil {
			continue
		}
		if gtin != "" && g != gtin {
			return "", false
		}
		code, gtin = strings.TrimSpace(h.Text), g
	}
	return code, gtin != ""
}

func trimmed(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}

func round2p(v *float64) *float64 {
	if v == nil {
		return nil
	}
	return ptr(Round2(*v))
}
