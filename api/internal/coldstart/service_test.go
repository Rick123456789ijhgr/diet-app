package coldstart_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"slices"
	"testing"

	"github.com/your-org/diet-app/api/internal/coldstart"
	"github.com/your-org/diet-app/api/internal/coldstart/coldstarttest"
)

const user = "00000000-0000-0000-0000-0000000000aa"

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

// nutrients 依標示順序：熱量、蛋白質、脂肪、飽和脂肪、反式脂肪、碳水化合物、糖、鈉。
func nutrients(v ...float64) *coldstart.Nutrients {
	return &coldstart.Nutrients{
		EnergyKcal: f(v[0]), ProteinG: f(v[1]), FatG: f(v[2]), SaturatedFatG: f(v[3]),
		TransFatG: f(v[4]), CarbohydrateG: f(v[5]), SugarG: f(v[6]), SodiumMg: f(v[7]),
	}
}

// fullDraft 份量 30 g，每份與每 100 g 一致。
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

type env struct {
	svc     *coldstart.Service
	store   *coldstarttest.MemStore
	objects *coldstarttest.MemObjects
}

func newEnv() env {
	store := coldstarttest.NewMemStore()
	objects := coldstarttest.NewMemObjects()
	pre := coldstarttest.FakePreprocessor{
		coldstart.KindBarcode: {Warnings: []string{}, Barcodes: []coldstart.BarcodeHit{{Format: "EAN13", Text: "4710088410108"}}},
		coldstart.KindLabel:   {Warnings: []string{"GLARE_RETAKE"}, LabelQuad: []coldstart.Point{{X: 1, Y: 2}}},
	}
	return env{coldstart.NewService(store, objects, pre, nil), store, objects}
}

// ready 建立一筆上傳、上傳三張照片並填好草稿。
func (e env) ready(t *testing.T, code string) coldstart.Submission {
	t.Helper()
	ctx := context.Background()
	sub, err := e.svc.Create(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range coldstart.Kinds {
		if sub, err = e.svc.UploadImage(ctx, sub.ID, k, pngBytes(t, 40, 30)); err != nil {
			t.Fatal(err)
		}
	}
	sub, err = e.svc.SaveDraft(ctx, sub.ID, fullDraft(code), sub.Version())
	if err != nil {
		t.Fatal(err)
	}
	return sub
}

func TestUploadImagePrefillsBarcodeAndReplaces(t *testing.T) {
	ctx := context.Background()
	e := newEnv()
	sub, _ := e.svc.Create(ctx, user)

	sub, err := e.svc.UploadImage(ctx, sub.ID, coldstart.KindBarcode, pngBytes(t, 40, 30))
	if err != nil {
		t.Fatal(err)
	}
	if sub.Draft.Barcode == nil || *sub.Draft.Barcode != "4710088410108" {
		t.Errorf("條碼應預先填入：%v", sub.Draft.Barcode)
	}
	img, ok := sub.Image(coldstart.KindBarcode)
	if !ok || img.Width != 40 || img.Height != 30 || img.ContentType != "image/png" {
		t.Errorf("照片 = %+v", img)
	}

	// 人已改過條碼時不覆蓋
	sub, _ = e.svc.SaveDraft(ctx, sub.ID, coldstart.Draft{Barcode: s("036000291452")}, "")
	sub, _ = e.svc.UploadImage(ctx, sub.ID, coldstart.KindBarcode, pngBytes(t, 50, 30))
	if *sub.Draft.Barcode != "036000291452" {
		t.Errorf("不應覆蓋人工輸入：%v", *sub.Draft.Barcode)
	}
	// 重傳取代舊檔，物件儲存只留新的
	if keys := e.objects.Keys(); len(keys) != 1 {
		t.Errorf("物件 = %v", keys)
	}
	data, ct, err := e.svc.ImageData(ctx, sub.ID, coldstart.KindBarcode)
	if err != nil || ct != "image/png" || len(data) == 0 {
		t.Errorf("ImageData：%v %q", err, ct)
	}
	if _, _, err := e.svc.ImageData(ctx, sub.ID, coldstart.KindLabel); !errors.Is(err, coldstart.ErrNotFound) {
		t.Errorf("沒上傳的照片：%v", err)
	}

	var invalid *coldstart.InvalidError
	if _, err := e.svc.UploadImage(ctx, sub.ID, coldstart.KindFront, []byte("GIF89a....")); !errors.As(err, &invalid) || invalid.Code != "UNSUPPORTED_IMAGE" {
		t.Errorf("不支援的格式：%v", err)
	}
	if _, err := e.svc.UploadImage(ctx, sub.ID, "side", pngBytes(t, 4, 4)); !errors.As(err, &invalid) || invalid.Field != "kind" {
		t.Errorf("未知的種類：%v", err)
	}
}

func TestSaveDraftOptimisticLock(t *testing.T) {
	ctx := context.Background()
	e := newEnv()
	sub, _ := e.svc.Create(ctx, user)
	first, err := e.svc.SaveDraft(ctx, sub.ID, coldstart.Draft{Name: s("A")}, sub.Version())
	if err != nil {
		t.Fatal(err)
	}
	// 用舊版本再寫一次：已被別人修改
	if _, err := e.svc.SaveDraft(ctx, sub.ID, coldstart.Draft{Name: s("B")}, sub.Version()); !errors.Is(err, coldstart.ErrStale) {
		t.Errorf("舊版本：%v", err)
	}
	if _, err := e.svc.SaveDraft(ctx, sub.ID, coldstart.Draft{Name: s("B")}, first.Version()); err != nil {
		t.Errorf("新版本：%v", err)
	}
	var invalid *coldstart.InvalidError
	if _, err := e.svc.SaveDraft(ctx, sub.ID, coldstart.Draft{ContentUnit: s("kg")}, ""); !errors.As(err, &invalid) || invalid.Field != "content_unit" {
		t.Errorf("單位：%v", err)
	}
	bad := coldstart.Draft{Nutrition: &coldstart.NutritionDraft{Per100: &coldstart.Nutrients{SodiumMg: f(-1)}}}
	if _, err := e.svc.SaveDraft(ctx, sub.ID, bad, ""); !errors.As(err, &invalid) || invalid.Field != "nutrition.per_100.sodium_mg" {
		t.Errorf("負數：%v", err)
	}
}

func TestConfirmCreate(t *testing.T) {
	ctx := context.Background()
	e := newEnv()

	// 缺欄位與照片
	sub, _ := e.svc.Create(ctx, user)
	sub, _ = e.svc.SaveDraft(ctx, sub.ID, coldstart.Draft{Barcode: s("4710088410108")}, "")
	_, _, err := e.svc.Confirm(ctx, user, sub.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate}, "")
	var problem *coldstart.ProblemError
	if !errors.As(err, &problem) || problem.Code != "DRAFT_INCOMPLETE" ||
		!slices.Contains(problem.Missing, "name") || !slices.Contains(problem.Missing, "nutrition.per_100.sodium_mg") ||
		!slices.Contains(problem.Missing, "images.label") {
		t.Fatalf("缺欄位：%v %+v", err, problem)
	}

	sub = e.ready(t, "4710088410108")
	got, product, err := e.svc.Confirm(ctx, user, sub.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate}, sub.Version())
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != coldstart.StatusConfirmed || got.ProductID != product.ID || got.ConfirmedBy == nil {
		t.Errorf("上傳 = %+v", got)
	}
	if product.GTIN != "04710088410108" || product.Name != "測試洋芋片" || len(product.Images) != 3 ||
		*product.Nutrition[coldstart.Per100].Values.SodiumMg != 500 {
		t.Errorf("產品 = %+v", product)
	}

	// 已確認的上傳不能再修改
	if _, err := e.svc.SaveDraft(ctx, sub.ID, coldstart.Draft{}, ""); !errors.Is(err, coldstart.ErrClosed) {
		t.Errorf("確認後修改：%v", err)
	}
	if _, err := e.svc.UploadImage(ctx, sub.ID, coldstart.KindFront, pngBytes(t, 4, 4)); !errors.Is(err, coldstart.ErrClosed) {
		t.Errorf("確認後上傳：%v", err)
	}

	// 以條碼查產品：UPC-A 與補 0 的 EAN-13 視為同一個
	if p, err := e.svc.Product(ctx, "04710088410108"); err != nil || p.ID != product.ID {
		t.Errorf("查產品：%v", err)
	}
}

func TestConfirmDuplicateBarcodeThenAddImagesOrRevise(t *testing.T) {
	ctx := context.Background()
	e := newEnv()
	first := e.ready(t, "036000291452") // UPC-A
	_, product, err := e.svc.Confirm(ctx, user, first.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate}, "")
	if err != nil {
		t.Fatal(err)
	}

	// 同一條碼的 EAN-13 寫法：擋下並附上既有產品
	second := e.ready(t, "0036000291452")
	_, _, err = e.svc.Confirm(ctx, user, second.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate}, "")
	var exists *coldstart.BarcodeExistsError
	if !errors.As(err, &exists) || exists.Product.ID != product.ID {
		t.Fatalf("重複條碼：%v", err)
	}

	// 補照片：照片掛到既有產品，營養數值不變
	_, p, err := e.svc.Confirm(ctx, user, second.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeAddImages, ProductID: product.ID}, "")
	if err != nil || len(p.Images) != 6 || e.store.NutritionVersions(product.ID, coldstart.Per100) != 1 {
		t.Errorf("補照片：%v %d 張", err, len(p.Images))
	}

	// 修正數值：新增一版，舊版保留但不再有效
	third := e.ready(t, "036000291452")
	d := fullDraft("036000291452")
	d.Nutrition.Per100.SodiumMg = f(520)
	d.Nutrition.PerServing.SodiumMg = f(156)
	third, _ = e.svc.SaveDraft(ctx, third.ID, d, "")
	_, p, err = e.svc.Confirm(ctx, user, third.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeReviseNutrition, ProductID: product.ID}, "")
	if err != nil || *p.Nutrition[coldstart.Per100].Values.SodiumMg != 520 || e.store.NutritionVersions(product.ID, coldstart.Per100) != 2 {
		t.Errorf("修正數值：%v", err)
	}

	// 條碼與指定產品不同
	other := e.ready(t, "4710088410108")
	var invalid *coldstart.InvalidError
	if _, _, err := e.svc.Confirm(ctx, user, other.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeAddImages, ProductID: product.ID}, ""); !errors.As(err, &invalid) || invalid.Code != "BARCODE_MISMATCH" {
		t.Errorf("條碼不同：%v", err)
	}
}

func TestConfirmInconsistentNeedsAcceptance(t *testing.T) {
	ctx := context.Background()
	e := newEnv()
	sub := e.ready(t, "4710088410108")
	d := fullDraft("4710088410108")
	d.Nutrition.PerServing.EnergyKcal = f(200) // 應約為 156
	d.Nutrition.Per100.SugarG = f(60)          // 大於碳水 53
	sub, _ = e.svc.SaveDraft(ctx, sub.ID, d, "")

	_, _, err := e.svc.Confirm(ctx, user, sub.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate}, "")
	var problem *coldstart.ProblemError
	if !errors.As(err, &problem) || problem.Code != "NUTRITION_INCONSISTENT" {
		t.Fatalf("不一致：%v", err)
	}
	codes := []string{}
	for _, i := range problem.Issues {
		codes = append(codes, i.Code+":"+i.Nutrient)
	}
	for _, want := range []string{"BASIS_MISMATCH:energy_kcal", "BASIS_MISMATCH:sugar_g", "SUGAR_EXCEEDS_CARBOHYDRATE:sugar_g"} {
		if !slices.Contains(codes, want) {
			t.Errorf("缺少 %s：%v", want, codes)
		}
	}
	// 失敗的確認不留下任何產品
	if _, err := e.svc.Product(ctx, "4710088410108"); !errors.Is(err, coldstart.ErrNotFound) {
		t.Errorf("失敗後不應有產品：%v", err)
	}
	// 人核對標示後照原樣存入
	if _, p, err := e.svc.Confirm(ctx, user, sub.ID, coldstart.ConfirmRequest{Mode: coldstart.ModeCreate, AcceptWarnings: true}, ""); err != nil ||
		*p.Nutrition[coldstart.PerServing].Values.EnergyKcal != 200 {
		t.Errorf("照原樣存入：%v", err)
	}
}

func TestRejectAndUnavailable(t *testing.T) {
	ctx := context.Background()
	e := newEnv()
	sub, _ := e.svc.Create(ctx, user)
	var invalid *coldstart.InvalidError
	if _, err := e.svc.Reject(ctx, sub.ID, " ", ""); !errors.As(err, &invalid) {
		t.Errorf("空白原因：%v", err)
	}
	got, err := e.svc.Reject(ctx, sub.ID, "照片模糊", "")
	if err != nil || got.Status != coldstart.StatusRejected || got.RejectReason != "照片模糊" {
		t.Errorf("退回：%v %+v", err, got)
	}
	list, _ := e.svc.List(ctx, coldstart.StatusRejected, 0)
	if len(list) != 1 {
		t.Errorf("清單 = %v", list)
	}

	off := coldstart.NewService(nil, nil, nil, nil)
	if _, err := off.Create(ctx, user); !errors.Is(err, coldstart.ErrUnavailable) {
		t.Errorf("未設定資料庫：%v", err)
	}
}
