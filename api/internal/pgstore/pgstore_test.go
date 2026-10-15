package pgstore_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"image"
	"image/png"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/coldstart"
	"github.com/your-org/diet-app/api/internal/coldstart/coldstarttest"
	"github.com/your-org/diet-app/api/internal/pgstore"
)

// openTestDB 在 TEST_DATABASE_URL 指向的伺服器上建立一個暫時的資料庫並套用所有 migration，
// 測試結束後刪除。沒有設定時略過（CI 以 pgvector/pgvector 服務容器提供）。
func openTestDB(t *testing.T) *pgstore.DB {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("未設定 TEST_DATABASE_URL，略過資料庫整合測試")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatalf("連線 TEST_DATABASE_URL：%v", err)
	}
	defer admin.Close(ctx)
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	name := "pgstore_test_" + hex.EncodeToString(suffix)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), base)
		if err == nil {
			_, _ = c.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
			_ = c.Close(context.Background())
		}
	})

	u, _ := url.Parse(base)
	u.Path = "/" + name
	conn, err := pgx.Connect(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	applyMigrations(t, conn)
	_ = conn.Close(ctx)

	db, err := pgstore.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	return db
}

// applyMigrations 依序套用 db/migrations 的 up 檔。本機的 PostgreSQL 沒有 pgvector 時略過
// 000001 的 CREATE EXTENSION vector（目前沒有資料表使用向量欄位）；CI 用含 pgvector 的映像。
func applyMigrations(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	ctx := context.Background()
	files, _ := filepath.Glob(filepath.Join("..", "..", "..", "db", "migrations", "*.up.sql"))
	sort.Strings(files)
	if len(files) == 0 {
		t.Fatal("找不到 migration 檔")
	}
	var hasVector bool
	_ = conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')`).Scan(&hasVector)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		sql := string(b)
		if !hasVector {
			sql = strings.ReplaceAll(sql, "CREATE EXTENSION IF NOT EXISTS vector;", "")
		}
		if _, err := conn.Exec(ctx, sql); err != nil {
			t.Fatalf("套用 %s：%v", filepath.Base(f), err)
		}
	}
	if !hasVector {
		t.Log("本機 PostgreSQL 沒有 pgvector，已略過 CREATE EXTENSION vector")
	}
}

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewGray(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func f(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

func nutrients(v ...float64) *coldstart.Nutrients {
	return &coldstart.Nutrients{
		EnergyKcal: f(v[0]), ProteinG: f(v[1]), FatG: f(v[2]), SaturatedFatG: f(v[3]),
		TransFatG: f(v[4]), CarbohydrateG: f(v[5]), SugarG: f(v[6]), SodiumMg: f(v[7]),
	}
}

func fullDraft(code string) coldstart.Draft {
	return coldstart.Draft{
		Barcode: s(code), Name: s("測試洋芋片"), Brand: s("測試"), NetContent: f(60), ContentUnit: s("g"),
		ServingSize: f(30), ServingsPerPackage: f(2),
		Nutrition: &coldstart.NutritionDraft{
			PerServing: nutrients(156, 2.1, 9, 3, 0, 15.9, 0.6, 150),
			Per100:     nutrients(520, 7, 30, 10, 0, 53, 2, 500),
		},
	}
}

func TestAuthStore(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	svc := auth.NewService(db)
	if _, err := svc.CreateUser(ctx, "amy", "艾米", "long-enough-pw"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateUser(ctx, "amy", "艾米", "long-enough-pw"); !errors.Is(err, auth.ErrUserExists) {
		t.Errorf("重複帳號：%v", err)
	}
	user, token, err := svc.Login(ctx, "amy", "long-enough-pw")
	if err != nil || user.DisplayName != "艾米" {
		t.Fatalf("登入：%v", err)
	}
	if got, err := svc.Authenticate(ctx, token); err != nil || got.ID != user.ID {
		t.Errorf("Authenticate：%v", err)
	}
	if err := svc.SetPassword(ctx, "amy", "another-long-pw"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Errorf("重設密碼後舊工作階段應失效：%v", err)
	}
	if err := svc.SetPassword(ctx, "nobody", "another-long-pw"); !errors.Is(err, auth.ErrNotFound) {
		t.Errorf("不存在的帳號：%v", err)
	}
	_, token, _ = svc.Login(ctx, "amy", "another-long-pw")
	_ = svc.Logout(ctx, token)
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Errorf("登出後：%v", err)
	}
}

func TestColdstartStore(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user, err := auth.NewService(db).CreateUser(ctx, "amy", "艾米", "long-enough-pw")
	if err != nil {
		t.Fatal(err)
	}
	objects := coldstarttest.NewMemObjects()
	pre := coldstarttest.FakePreprocessor{
		coldstart.KindBarcode: {Warnings: []string{}, Barcodes: []coldstart.BarcodeHit{{Format: "UPCA", Text: "036000291452"}}},
		coldstart.KindLabel:   {Warnings: []string{"GLARE_RETAKE"}, LabelQuad: []coldstart.Point{{X: 1.5, Y: 2}}},
	}
	svc := coldstart.NewService(db, objects, pre, nil)

	ready := func() coldstart.Submission {
		t.Helper()
		sub, err := svc.Create(ctx, user.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, k := range coldstart.Kinds {
			if sub, err = svc.UploadImage(ctx, sub.ID, k, pngBytes(t, 40, 30)); err != nil {
				t.Fatal(err)
			}
		}
		return sub
	}

	sub := ready()
	if sub.CreatedBy.DisplayName != "艾米" || len(sub.Images) != 3 {
		t.Fatalf("上傳 = %+v", sub)
	}
	if sub.Draft.Barcode == nil || *sub.Draft.Barcode != "036000291452" {
		t.Errorf("條碼應預先填入：%v", sub.Draft.Barcode)
	}
	label, _ := sub.Image(coldstart.KindLabel)
	if label.Preprocess.Warnings[0] != "GLARE_RETAKE" || label.Preprocess.LabelQuad[0].X != 1.5 {
		t.Errorf("前處理摘要 = %+v", label.Preprocess)
	}
	// 重傳：照片列被取代，舊物件刪除
	sub, err = svc.UploadImage(ctx, sub.ID, coldstart.KindFront, pngBytes(t, 80, 60))
	if err != nil {
		t.Fatal(err)
	}
	if front, _ := sub.Image(coldstart.KindFront); front.Width != 80 || len(objects.Keys()) != 3 {
		t.Errorf("重傳後 = %+v，物件 %v", front, objects.Keys())
	}

	// 樂觀鎖
	saved, err := svc.SaveDraft(ctx, sub.ID, fullDraft("036000291452"), sub.Version())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveDraft(ctx, sub.ID, fullDraft("036000291452"), sub.Version()); !errors.Is(err, coldstart.ErrStale) {
		t.Errorf("舊版本：%v", err)
	}
	if got, _ := svc.Get(ctx, sub.ID); got.Version() != saved.Version() || *got.Draft.Nutrition.Per100.SodiumMg != 500 {
		t.Errorf("版本 %s ≠ %s", got.Version(), saved.Version())
	}

	// 數值不一致：交易復原，不留下產品
	bad := fullDraft("036000291452")
	bad.Nutrition.PerServing.EnergyKcal = f(300)
	_, _ = svc.SaveDraft(ctx, sub.ID, bad, "")
	var problem *coldstart.ProblemError
	if _, _, err := svc.Confirm(ctx, user.ID, sub.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate}, ""); !errors.As(err, &problem) {
		t.Fatalf("不一致：%v", err)
	}
	if _, err := svc.Product(ctx, "036000291452"); !errors.Is(err, coldstart.ErrNotFound) {
		t.Errorf("失敗的確認不應留下產品：%v", err)
	}

	_, _ = svc.SaveDraft(ctx, sub.ID, fullDraft("036000291452"), "")
	confirmed, product, err := svc.Confirm(ctx, user.ID, sub.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate}, "")
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != coldstart.StatusConfirmed || confirmed.ConfirmedBy == nil || confirmed.ConfirmedBy.DisplayName != "艾米" {
		t.Errorf("確認後 = %+v", confirmed)
	}
	if product.GTIN != "00036000291452" || product.Brand != "測試" || *product.ServingSize != 30 ||
		*product.Nutrition[coldstart.PerServing].Values.ProteinG != 2.1 || len(product.Images) != 3 {
		t.Errorf("產品 = %+v", product)
	}

	// 同一條碼的 EAN-13 寫法
	second := ready()
	_, _ = svc.SaveDraft(ctx, second.ID, fullDraft("0036000291452"), "")
	var exists *coldstart.BarcodeExistsError
	if _, _, err := svc.Confirm(ctx, user.ID, second.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate}, ""); !errors.As(err, &exists) || exists.Product.ID != product.ID {
		t.Fatalf("重複條碼：%v", err)
	}
	// 修正數值：新增一版，舊版保留
	revised := fullDraft("0036000291452")
	revised.Nutrition.Per100.SodiumMg, revised.Nutrition.PerServing.SodiumMg = f(520), f(156)
	_, _ = svc.SaveDraft(ctx, second.ID, revised, "")
	_, p, err := svc.Confirm(ctx, user.ID, second.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeReviseNutrition, ProductID: product.ID}, "")
	if err != nil || *p.Nutrition[coldstart.Per100].Values.SodiumMg != 520 || len(p.Images) != 6 {
		t.Errorf("修正數值：%v %+v", err, p)
	}

	// 清單與退回
	third, _ := svc.Create(ctx, user.ID)
	if _, err := svc.Reject(ctx, third.ID, "重複上傳", ""); err != nil {
		t.Fatal(err)
	}
	all, _ := svc.List(ctx, "", 10)
	confirmedOnly, _ := svc.List(ctx, coldstart.StatusConfirmed, 10)
	if len(all) != 3 || len(confirmedOnly) != 2 || all[0].ID != third.ID || len(confirmedOnly[0].Images) != 3 {
		t.Errorf("清單：全部 %d、已確認 %d", len(all), len(confirmedOnly))
	}
	if _, err := svc.Get(ctx, "not-a-uuid"); !errors.Is(err, coldstart.ErrNotFound) {
		t.Errorf("格式不對的 ID：%v", err)
	}
}
