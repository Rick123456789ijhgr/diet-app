package workbench

import (
	"context"
	"net/http"
	"time"

	api "github.com/your-org/diet-app/api/gen/openapi/workbenchapi"
	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/coldstart"
)

// SessionCookie 是工作階段 Cookie 的名稱（與 openapi 的 sessionCookie 一致）。
const SessionCookie = "wb_session"

type tokenKey struct{}

// withSession 由 Cookie 取得登入者放進 context；沒有或無效時不處理（需要登入的路由自行回 401）。
func (h *handler) withSession(r *http.Request) *http.Request {
	if h.auth == nil {
		return r
	}
	c, err := r.Cookie(SessionCookie)
	if err != nil || c.Value == "" {
		return r
	}
	ctx := context.WithValue(r.Context(), tokenKey{}, c.Value)
	if u, err := h.auth.Authenticate(ctx, c.Value); err == nil {
		ctx = auth.WithUser(ctx, u)
	}
	return r.WithContext(ctx)
}

func (h *handler) sessionCookie(token string, maxAge time.Duration) *http.Cookie {
	return &http.Cookie{
		Name: SessionCookie, Value: token, Path: "/workbench/", MaxAge: int(maxAge.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: h.secureCookie,
	}
}

func apiUser(u auth.User) api.User {
	return api.User{Id: u.ID, Username: u.Username, DisplayName: u.DisplayName}
}

func (h *handler) Login(ctx context.Context, req api.LoginRequestObject) (api.LoginResponseObject, error) {
	if h.auth == nil {
		return nil, coldstart.ErrUnavailable
	}
	u, token, err := h.auth.Login(ctx, req.Body.Username, req.Body.Password)
	if err != nil {
		return nil, err
	}
	cookie := h.sessionCookie(token, auth.SessionTTL).String()
	return api.Login200JSONResponse{Body: apiUser(u), Headers: api.Login200ResponseHeaders{SetCookie: &cookie}}, nil
}

func (h *handler) Logout(ctx context.Context, _ api.LogoutRequestObject) (api.LogoutResponseObject, error) {
	if _, ok := auth.UserFrom(ctx); !ok {
		return nil, auth.ErrUnauthenticated
	}
	token, _ := ctx.Value(tokenKey{}).(string)
	if err := h.auth.Logout(ctx, token); err != nil {
		return nil, err
	}
	return logoutResponse{cookie: h.sessionCookie("", -time.Second)}, nil
}

func (h *handler) GetMe(ctx context.Context, _ api.GetMeRequestObject) (api.GetMeResponseObject, error) {
	if h.auth == nil {
		return nil, coldstart.ErrUnavailable
	}
	u, ok := auth.UserFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	return api.GetMe200JSONResponse(apiUser(u)), nil
}

// logoutResponse 回 204 並清除 Cookie（規格的 204 沒有標頭欄位可設定）。
type logoutResponse struct{ cookie *http.Cookie }

func (r logoutResponse) VisitLogoutResponse(w http.ResponseWriter) error {
	http.SetCookie(w, r.cookie)
	w.WriteHeader(http.StatusNoContent)
	return nil
}
