package pgstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/your-org/diet-app/api/internal/coldstart"
)

var _ coldstart.Store = (*DB)(nil)

const submissionColumns = `
	s.id::text, s.status, s.draft, s.preprocess, s.product_id::text, s.reject_reason,
	s.created_at, s.updated_at, s.confirmed_at,
	cu.id::text, cu.username, cu.display_name,
	fu.id::text, fu.username, fu.display_name
FROM product_submissions s
JOIN users cu ON cu.id = s.created_by
LEFT JOIN users fu ON fu.id = s.confirmed_by`

func (db *DB) CreateSubmission(ctx context.Context, userID string) (coldstart.Submission, error) {
	var id string
	if err := db.pool.QueryRow(ctx,
		`INSERT INTO product_submissions (created_by) VALUES ($1) RETURNING id::text`, userID,
	).Scan(&id); err != nil {
		return coldstart.Submission{}, err
	}
	return loadSubmission(ctx, db.pool, id, false)
}

func (db *DB) ListSubmissions(ctx context.Context, status coldstart.Status, limit int) ([]coldstart.SubmissionSummary, error) {
	rows, err := db.pool.Query(ctx, `
		SELECT s.id::text, s.status, coalesce(s.draft->>'barcode', ''), coalesce(s.draft->>'name', ''),
		       s.updated_at, u.id::text, u.username, u.display_name,
		       array(SELECT i.kind FROM product_images i WHERE i.submission_id = s.id ORDER BY
		             array_position(ARRAY['front', 'barcode', 'label'], i.kind))
		FROM product_submissions s JOIN users u ON u.id = s.created_by
		WHERE $1 = '' OR s.status = $1
		ORDER BY s.updated_at DESC
		LIMIT $2`, string(status), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (coldstart.SubmissionSummary, error) {
		var s coldstart.SubmissionSummary
		var kinds []string
		err := row.Scan(&s.ID, &s.Status, &s.Barcode, &s.Name, &s.UpdatedAt,
			&s.CreatedBy.ID, &s.CreatedBy.Username, &s.CreatedBy.DisplayName, &kinds)
		s.Images = make([]coldstart.Kind, len(kinds))
		for i, k := range kinds {
			s.Images[i] = coldstart.Kind(k)
		}
		return s, err
	})
}

func (db *DB) GetSubmission(ctx context.Context, id string) (coldstart.Submission, error) {
	return loadSubmission(ctx, db.pool, id, false)
}

func (db *DB) ProductByGTIN(ctx context.Context, gtin string) (coldstart.Product, error) {
	return loadProduct(ctx, db.pool, "p.gtin = $1", gtin)
}

func (db *DB) InTx(ctx context.Context, fn func(coldstart.Tx) error) error {
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		return fn(pgTx{tx})
	})
}

// loadSubmission 讀取一筆上傳與它的照片；lock 為 true 時鎖定該列（交易中使用）。
func loadSubmission(ctx context.Context, q querier, id string, lock bool) (coldstart.Submission, error) {
	if !validID(id) {
		return coldstart.Submission{}, coldstart.ErrNotFound
	}
	sql := `SELECT ` + submissionColumns + ` WHERE s.id = $1`
	if lock {
		sql += ` FOR UPDATE OF s`
	}
	var s coldstart.Submission
	var draft, preprocess []byte
	var productID, rejectReason, fuID, fuName, fuDisplay *string
	err := q.QueryRow(ctx, sql, id).Scan(
		&s.ID, &s.Status, &draft, &preprocess, &productID, &rejectReason,
		&s.CreatedAt, &s.UpdatedAt, &s.ConfirmedAt,
		&s.CreatedBy.ID, &s.CreatedBy.Username, &s.CreatedBy.DisplayName,
		&fuID, &fuName, &fuDisplay,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return coldstart.Submission{}, coldstart.ErrNotFound
	}
	if err != nil {
		return coldstart.Submission{}, err
	}
	if err := json.Unmarshal(draft, &s.Draft); err != nil {
		return coldstart.Submission{}, fmt.Errorf("pgstore: 解析草稿: %w", err)
	}
	summaries := map[coldstart.Kind]coldstart.ImagePreprocess{}
	if err := json.Unmarshal(preprocess, &summaries); err != nil {
		return coldstart.Submission{}, fmt.Errorf("pgstore: 解析前處理摘要: %w", err)
	}
	if productID != nil {
		s.ProductID = *productID
	}
	if rejectReason != nil {
		s.RejectReason = *rejectReason
	}
	if fuID != nil {
		s.ConfirmedBy = &coldstart.UserRef{ID: *fuID, Username: *fuName, DisplayName: *fuDisplay}
	}

	rows, err := q.Query(ctx, `
		SELECT kind, object_key, sha256, content_type, width, height, created_at
		FROM product_images WHERE submission_id = $1`, id)
	if err != nil {
		return coldstart.Submission{}, err
	}
	images, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (coldstart.Image, error) {
		var img coldstart.Image
		err := row.Scan(&img.Kind, &img.ObjectKey, &img.SHA256, &img.ContentType, &img.Width, &img.Height, &img.UploadedAt)
		img.Preprocess = summaries[img.Kind]
		if img.Preprocess.Warnings == nil {
			img.Preprocess.Warnings = []string{}
		}
		return img, err
	})
	if err != nil {
		return coldstart.Submission{}, err
	}
	for _, k := range coldstart.Kinds {
		for _, img := range images {
			if img.Kind == k {
				s.Images = append(s.Images, img)
			}
		}
	}
	return s, nil
}

// loadProduct 讀取一個產品、有效的營養標示與照片；where 為篩選條件（參數 $1）。
func loadProduct(ctx context.Context, q querier, where string, arg any) (coldstart.Product, error) {
	var p coldstart.Product
	var brand *string
	err := q.QueryRow(ctx, `
		SELECT p.id::text, p.gtin, p.barcode, p.name, p.brand, p.net_content::float8, p.content_unit,
		       p.serving_size::float8, p.servings_per_package::float8, p.created_at
		FROM products p WHERE `+where, arg,
	).Scan(&p.ID, &p.GTIN, &p.Barcode, &p.Name, &brand, &p.NetContent, &p.ContentUnit,
		&p.ServingSize, &p.ServingsPerPackage, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return coldstart.Product{}, coldstart.ErrNotFound
	}
	if err != nil {
		return coldstart.Product{}, err
	}
	if brand != nil {
		p.Brand = *brand
	}

	rows, err := q.Query(ctx, `
		SELECT n.basis, n.energy_kcal::float8, n.protein_g::float8, n.fat_g::float8, n.saturated_fat_g::float8,
		       n.trans_fat_g::float8, n.carbohydrate_g::float8, n.sugar_g::float8, n.sodium_mg::float8,
		       n.confirmed_at, u.id::text, u.username, u.display_name
		FROM nutrition_facts n JOIN users u ON u.id = n.confirmed_by
		WHERE n.product_id = $1 AND n.superseded_at IS NULL`, p.ID)
	if err != nil {
		return coldstart.Product{}, err
	}
	p.Nutrition = map[coldstart.Basis]coldstart.NutritionFacts{}
	_, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (struct{}, error) {
		var basis coldstart.Basis
		var nf coldstart.NutritionFacts
		v := &nf.Values
		v.EnergyKcal, v.ProteinG, v.FatG, v.SaturatedFatG = new(float64), new(float64), new(float64), new(float64)
		v.TransFatG, v.CarbohydrateG, v.SugarG, v.SodiumMg = new(float64), new(float64), new(float64), new(float64)
		err := row.Scan(&basis, v.EnergyKcal, v.ProteinG, v.FatG, v.SaturatedFatG, v.TransFatG, v.CarbohydrateG,
			v.SugarG, v.SodiumMg, &nf.ConfirmedAt, &nf.ConfirmedBy.ID, &nf.ConfirmedBy.Username, &nf.ConfirmedBy.DisplayName)
		p.Nutrition[basis] = nf
		return struct{}{}, err
	})
	if err != nil {
		return coldstart.Product{}, err
	}

	rows, err = q.Query(ctx, `
		SELECT kind, submission_id::text, width, height FROM product_images
		WHERE product_id = $1 ORDER BY created_at, kind`, p.ID)
	if err != nil {
		return coldstart.Product{}, err
	}
	p.Images, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (coldstart.ProductImage, error) {
		var img coldstart.ProductImage
		err := row.Scan(&img.Kind, &img.SubmissionID, &img.Width, &img.Height)
		return img, err
	})
	return p, err
}

// pgTx 實作 coldstart.Tx。
type pgTx struct{ tx pgx.Tx }

func (t pgTx) LockSubmission(ctx context.Context, id string) (coldstart.Submission, error) {
	return loadSubmission(ctx, t.tx, id, true)
}

func (t pgTx) SaveSubmission(ctx context.Context, s coldstart.Submission) (coldstart.Submission, error) {
	draft, err := json.Marshal(s.Draft)
	if err != nil {
		return coldstart.Submission{}, err
	}
	summaries := map[coldstart.Kind]coldstart.ImagePreprocess{}
	for _, img := range s.Images {
		summaries[img.Kind] = img.Preprocess
	}
	preprocess, err := json.Marshal(summaries)
	if err != nil {
		return coldstart.Submission{}, err
	}
	var productID, rejectReason, confirmedBy *string
	if s.ProductID != "" {
		productID = &s.ProductID
	}
	if s.RejectReason != "" {
		rejectReason = &s.RejectReason
	}
	if s.ConfirmedBy != nil {
		confirmedBy = &s.ConfirmedBy.ID
	}
	// clock_timestamp()：同一交易中的多次寫入也會得到不同的版本
	tag, err := t.tx.Exec(ctx, `
		UPDATE product_submissions
		SET status = $2, draft = $3, preprocess = $4, product_id = $5, reject_reason = $6,
		    confirmed_by = $7, confirmed_at = $8, updated_at = clock_timestamp()
		WHERE id = $1`,
		s.ID, string(s.Status), draft, preprocess, productID, rejectReason, confirmedBy, s.ConfirmedAt)
	if err != nil {
		return coldstart.Submission{}, err
	}
	if tag.RowsAffected() == 0 {
		return coldstart.Submission{}, coldstart.ErrNotFound
	}
	return loadSubmission(ctx, t.tx, s.ID, false)
}

func (t pgTx) PutImage(ctx context.Context, submissionID string, img coldstart.Image) (*coldstart.Image, error) {
	var old coldstart.Image
	err := t.tx.QueryRow(ctx, `
		SELECT kind, object_key, sha256, content_type, width, height, created_at
		FROM product_images WHERE submission_id = $1 AND kind = $2 FOR UPDATE`, submissionID, string(img.Kind),
	).Scan(&old.Kind, &old.ObjectKey, &old.SHA256, &old.ContentType, &old.Width, &old.Height, &old.UploadedAt)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	_, err = t.tx.Exec(ctx, `
		INSERT INTO product_images (submission_id, kind, object_key, sha256, content_type, width, height, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (submission_id, kind) DO UPDATE SET
			object_key = EXCLUDED.object_key, sha256 = EXCLUDED.sha256, content_type = EXCLUDED.content_type,
			width = EXCLUDED.width, height = EXCLUDED.height, created_at = EXCLUDED.created_at`,
		submissionID, string(img.Kind), img.ObjectKey, img.SHA256, img.ContentType, img.Width, img.Height, img.UploadedAt)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	return &old, nil
}

func (t pgTx) ProductByGTIN(ctx context.Context, gtin string) (coldstart.Product, error) {
	return loadProduct(ctx, t.tx, "p.gtin = $1", gtin)
}

func (t pgTx) ProductByID(ctx context.Context, id string) (coldstart.Product, error) {
	if !validID(id) {
		return coldstart.Product{}, coldstart.ErrNotFound
	}
	return loadProduct(ctx, t.tx, "p.id = $1", id)
}

func (t pgTx) CreateProduct(ctx context.Context, p coldstart.NewProduct) (string, error) {
	var brand *string
	if p.Brand != "" {
		brand = &p.Brand
	}
	// 以 savepoint 包住：唯一鍵衝突時只復原這一步，交易仍可繼續查詢既有產品
	sp, err := t.tx.Begin(ctx)
	if err != nil {
		return "", err
	}
	var id string
	err = sp.QueryRow(ctx, `
		INSERT INTO products (gtin, barcode, name, brand, net_content, content_unit, serving_size,
		                      servings_per_package, source, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'coldstart', $9) RETURNING id::text`,
		p.GTIN, p.Barcode, p.Name, brand, p.NetContent, p.ContentUnit, p.ServingSize, p.ServingsPerPackage, p.CreatedBy,
	).Scan(&id)
	if err != nil {
		_ = sp.Rollback(ctx)
		if isUniqueViolation(err, "products_gtin_key") {
			return "", coldstart.ErrGTINTaken
		}
		return "", err
	}
	return id, sp.Commit(ctx)
}

func (t pgTx) AddNutrition(ctx context.Context, productID string, basis coldstart.Basis, n coldstart.Nutrients, userID string) error {
	now := time.Now()
	if _, err := t.tx.Exec(ctx, `
		UPDATE nutrition_facts SET superseded_at = $3
		WHERE product_id = $1 AND basis = $2 AND superseded_at IS NULL`, productID, string(basis), now); err != nil {
		return err
	}
	_, err := t.tx.Exec(ctx, `
		INSERT INTO nutrition_facts (product_id, basis, energy_kcal, protein_g, fat_g, saturated_fat_g, trans_fat_g,
		                             carbohydrate_g, sugar_g, sodium_mg, confirmed_by, confirmed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		productID, string(basis), n.EnergyKcal, n.ProteinG, n.FatG, n.SaturatedFatG, n.TransFatG,
		n.CarbohydrateG, n.SugarG, n.SodiumMg, userID, now)
	return err
}

func (t pgTx) SetServingSize(ctx context.Context, productID string, size float64) error {
	_, err := t.tx.Exec(ctx, `UPDATE products SET serving_size = $2 WHERE id = $1`, productID, size)
	return err
}

func (t pgTx) AttachImages(ctx context.Context, submissionID, productID string) error {
	_, err := t.tx.Exec(ctx, `UPDATE product_images SET product_id = $2 WHERE submission_id = $1`, submissionID, productID)
	return err
}
