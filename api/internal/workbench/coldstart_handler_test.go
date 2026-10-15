package workbench

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/auth/authtest"
	"github.com/your-org/diet-app/api/internal/coldstart"
	"github.com/your-org/diet-app/api/internal/coldstart/coldstarttest"
)

// coldstartClient 啟動含登入與冷啟動的伺服器，回傳帶 Cookie 的客戶端。
func coldstartClient(t *testing.T) (*http.Client, string) {
	t.Helper()
	authSvc := auth.NewService(authtest.NewMemStore())
	u, err := authSvc.CreateUser(context.Background(), "amy", "艾米", "long-enough-pw")
	if err != nil {
		t.Fatal(err)
	}
	store := coldstarttest.NewMemStore()
	store.Users[u.ID] = coldstart.UserRef{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName}
	pre := coldstarttest.FakePreprocessor{
		coldstart.KindBarcode: {Warnings: []string{}, Barcodes: []coldstart.BarcodeHit{{Format: "EAN13", Text: "4710088410108"}}},
	}
	cs := coldstart.NewService(store, coldstarttest.NewMemObjects(), pre, nil)
	srv := httptest.NewServer(NewHTTPHandler(NewService(&fakeAI{}), Options{Auth: authSvc, Coldstart: cs}))
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}, srv.URL + "/workbench/v1"
}

type call struct {
	method, path, body, contentType, ifMatch string
}

func do(t *testing.T, c *http.Client, base string, req call) *http.Response {
	t.Helper()
	var body io.Reader
	if req.body != "" {
		body = strings.NewReader(req.body)
	}
	r, _ := http.NewRequest(req.method, base+req.path, body)
	if req.contentType != "" {
		r.Header.Set("Content-Type", req.contentType)
	} else if req.body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if req.ifMatch != "" {
		r.Header.Set("If-Match", req.ifMatch)
	}
	resp, err := c.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func expect(t *testing.T, resp *http.Response, status int) {
	t.Helper()
	if resp.StatusCode != status {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("%s %s：status = %d，預期 %d；%s", resp.Request.Method, resp.Request.URL.Path, resp.StatusCode, status, b)
	}
}

func uploadPNG(t *testing.T, c *http.Client, base, id, kind string) *http.Response {
	t.Helper()
	var img bytes.Buffer
	_ = png.Encode(&img, image.NewGray(image.Rect(0, 0, 40, 30)))
	body, ct := multipartBody(t, nil, img.Bytes())
	return do(t, c, base, call{method: http.MethodPut, path: "/coldstart/submissions/" + id + "/images/" + kind, body: body.String(), contentType: ct})
}

func TestLoginSessionAndLogout(t *testing.T) {
	c, base := coldstartClient(t)

	resp := do(t, c, base, call{method: http.MethodPost, path: "/auth/login", body: `{"username":"amy","password":"wrong"}`})
	expect(t, resp, http.StatusUnauthorized)
	if decode[api.Error](t, resp).Code != "INVALID_CREDENTIALS" {
		t.Error("錯誤密碼應回 INVALID_CREDENTIALS")
	}
	expect(t, do(t, c, base, call{method: http.MethodGet, path: "/auth/me"}), http.StatusUnauthorized)
	expect(t, do(t, c, base, call{method: http.MethodGet, path: "/coldstart/submissions"}), http.StatusUnauthorized)

	resp = do(t, c, base, call{method: http.MethodPost, path: "/auth/login", body: `{"username":"amy","password":"long-enough-pw"}`})
	expect(t, resp, http.StatusOK)
	cookie := resp.Header.Get("Set-Cookie")
	for _, want := range []string{"wb_session=", "Path=/workbench/", "HttpOnly", "SameSite=Lax", "Max-Age=604800"} {
		if !strings.Contains(cookie, want) {
			t.Errorf("Set-Cookie 缺少 %s：%s", want, cookie)
		}
	}
	resp = do(t, c, base, call{method: http.MethodGet, path: "/auth/me"})
	expect(t, resp, http.StatusOK)
	if decode[api.User](t, resp).DisplayName != "艾米" {
		t.Error("me 應回傳登入者")
	}

	resp = do(t, c, base, call{method: http.MethodPost, path: "/auth/logout"})
	expect(t, resp, http.StatusNoContent)
	if !strings.Contains(resp.Header.Get("Set-Cookie"), "Max-Age=0") {
		t.Errorf("登出應清除 Cookie：%s", resp.Header.Get("Set-Cookie"))
	}
	expect(t, do(t, c, base, call{method: http.MethodGet, path: "/auth/me"}), http.StatusUnauthorized)
}

func TestColdstartFlow(t *testing.T) {
	c, base := coldstartClient(t)
	expect(t, do(t, c, base, call{method: http.MethodPost, path: "/auth/login", body: `{"username":"amy","password":"long-enough-pw"}`}), http.StatusOK)

	resp := do(t, c, base, call{method: http.MethodPost, path: "/coldstart/submissions"})
	expect(t, resp, http.StatusCreated)
	sub := decode[api.Submission](t, resp)
	if sub.Status != "draft" || sub.CreatedBy.Username != "amy" {
		t.Fatalf("建立 = %+v", sub)
	}
	id := sub.Id

	// 上傳條碼照片：預先填入條碼
	resp = uploadPNG(t, c, base, id, "barcode")
	expect(t, resp, http.StatusOK)
	sub = decode[api.Submission](t, resp)
	if sub.Draft.Barcode == nil || *sub.Draft.Barcode != "4710088410108" || len(sub.Images) != 1 || sub.Images[0].Width != 40 {
		t.Errorf("上傳後 = %+v", sub)
	}
	resp = do(t, c, base, call{method: http.MethodGet, path: "/coldstart/submissions/" + id + "/images/barcode"})
	expect(t, resp, http.StatusOK)
	if resp.Header.Get("Content-Type") != "image/png" {
		t.Errorf("Content-Type = %s", resp.Header.Get("Content-Type"))
	}
	expect(t, do(t, c, base, call{method: http.MethodGet, path: "/coldstart/submissions/" + id + "/images/label"}), http.StatusNotFound)
	expect(t, uploadPNG(t, c, base, id, "side"), http.StatusBadRequest)

	// 草稿：舊版本回 412
	draft := `{"barcode":"4710088410108","name":"測試洋芋片","content_unit":"g","serving_size":30,
		"nutrition":{"per_serving":{"energy_kcal":156,"protein_g":2.1,"fat_g":9,"saturated_fat_g":3,"trans_fat_g":0,"carbohydrate_g":15.9,"sugar_g":0.6,"sodium_mg":150},
		"per_100":{"energy_kcal":520,"protein_g":7,"fat_g":30,"saturated_fat_g":10,"trans_fat_g":0,"carbohydrate_g":53,"sugar_g":2,"sodium_mg":500}}}`
	resp = do(t, c, base, call{method: http.MethodPut, path: "/coldstart/submissions/" + id + "/draft", body: draft, ifMatch: sub.UpdatedAt})
	expect(t, resp, http.StatusOK)
	saved := decode[api.Submission](t, resp)
	if *saved.Draft.Nutrition.PerServing.ProteinG != 2.1 {
		t.Errorf("數值應原樣保存：%v", *saved.Draft.Nutrition.PerServing.ProteinG)
	}
	resp = do(t, c, base, call{method: http.MethodPut, path: "/coldstart/submissions/" + id + "/draft", body: draft, ifMatch: sub.UpdatedAt})
	expect(t, resp, http.StatusPreconditionFailed)
	resp = do(t, c, base, call{method: http.MethodPut, path: "/coldstart/submissions/" + id + "/draft", body: `{"content_unit":"kg"}`})
	expect(t, resp, http.StatusBadRequest)

	// 缺照片：422 DRAFT_INCOMPLETE
	resp = do(t, c, base, call{method: http.MethodPost, path: "/coldstart/submissions/" + id + "/confirm", body: `{"mode":"create"}`})
	expect(t, resp, http.StatusUnprocessableEntity)
	problem := decode[api.ConfirmProblem](t, resp)
	if problem.Code != "DRAFT_INCOMPLETE" || problem.Missing == nil || !strings.Contains(strings.Join(*problem.Missing, ","), "images.label") {
		t.Errorf("缺照片 = %+v", problem)
	}

	expect(t, uploadPNG(t, c, base, id, "front"), http.StatusOK)
	expect(t, uploadPNG(t, c, base, id, "label"), http.StatusOK)
	resp = do(t, c, base, call{method: http.MethodPost, path: "/coldstart/submissions/" + id + "/confirm", body: `{"mode":"create"}`})
	expect(t, resp, http.StatusOK)
	confirmed := decode[api.ConfirmResponse](t, resp)
	if confirmed.Submission.Status != "confirmed" || confirmed.Product.Gtin != "04710088410108" ||
		*confirmed.Product.Nutrition.Per100.SodiumMg != 500 || len(confirmed.Product.Images) != 3 {
		t.Errorf("確認 = %+v", confirmed)
	}
	expect(t, do(t, c, base, call{method: http.MethodPut, path: "/coldstart/submissions/" + id + "/draft", body: `{}`}), http.StatusConflict)

	// 同一條碼再上傳一次：409 附既有產品
	resp = do(t, c, base, call{method: http.MethodPost, path: "/coldstart/submissions"})
	second := decode[api.Submission](t, resp)
	_ = do(t, c, base, call{method: http.MethodPut, path: "/coldstart/submissions/" + second.Id + "/draft", body: `{"barcode":"04710088410108"}`})
	resp = do(t, c, base, call{method: http.MethodPost, path: "/coldstart/submissions/" + second.Id + "/confirm", body: `{"mode":"create"}`})
	expect(t, resp, http.StatusConflict)
	conflict := decode[api.ConflictError](t, resp)
	if conflict.Code != "BARCODE_EXISTS" || conflict.Product == nil || conflict.Product.Id != confirmed.Product.Id {
		t.Errorf("重複條碼 = %+v", conflict)
	}

	// 查產品、清單、退回
	resp = do(t, c, base, call{method: http.MethodGet, path: "/coldstart/products/4710088410108"})
	expect(t, resp, http.StatusOK)
	expect(t, do(t, c, base, call{method: http.MethodGet, path: "/coldstart/products/123"}), http.StatusBadRequest)
	expect(t, do(t, c, base, call{method: http.MethodGet, path: "/coldstart/products/0036000291452"}), http.StatusNotFound)
	resp = do(t, c, base, call{method: http.MethodPost, path: "/coldstart/submissions/" + second.Id + "/reject", body: `{"reason":"重複"}`})
	expect(t, resp, http.StatusOK)
	resp = do(t, c, base, call{method: http.MethodGet, path: "/coldstart/submissions?status=confirmed"})
	expect(t, resp, http.StatusOK)
	list := decode[struct{ Items []api.SubmissionSummary }](t, resp)
	if len(list.Items) != 1 || list.Items[0].Name == nil || *list.Items[0].Name != "測試洋芋片" || len(list.Items[0].Images) != 3 {
		t.Errorf("清單 = %+v", list)
	}
}

// 上傳上限：HTTP 層與冷啟動流程的上限必須一致（都由 gRPC 訊息上限決定）。
func TestUploadLimitsAgree(t *testing.T) {
	if MaxUploadBytes != coldstart.MaxImageBytes {
		t.Errorf("MaxUploadBytes = %d，coldstart.MaxImageBytes = %d", MaxUploadBytes, coldstart.MaxImageBytes)
	}
}

// failingStore 模擬資料庫斷線：查詢工作階段失敗。
type failingStore struct{ *authtest.MemStore }

func (failingStore) SessionUser(context.Context, []byte, time.Time) (auth.User, error) {
	return auth.User{}, errors.New("連線中斷")
}

// 查詢工作階段失敗時回 5xx，不是 401（前端不會因此把使用者登出）。
func TestSessionLookupErrorIsNot401(t *testing.T) {
	srv := httptest.NewServer(NewHTTPHandler(NewService(&fakeAI{}), Options{
		Auth: auth.NewService(failingStore{authtest.NewMemStore()}),
	}))
	t.Cleanup(srv.Close)
	r, _ := http.NewRequest(http.MethodGet, srv.URL+"/workbench/v1/auth/me", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookie, Value: "some-token"})
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("status = %d，預期 500", resp.StatusCode)
	}
}
