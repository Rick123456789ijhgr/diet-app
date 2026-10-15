package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/your-org/diet-app/api/internal/auth"
	"github.com/your-org/diet-app/api/internal/auth/authtest"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := auth.HashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Errorf("hash = %q", hash)
	}
	if ok, err := auth.VerifyPassword("correct horse battery", hash); !ok || err != nil {
		t.Errorf("正確密碼：%v %v", ok, err)
	}
	if ok, _ := auth.VerifyPassword("wrong", hash); ok {
		t.Error("錯誤密碼不應通過")
	}
	if _, err := auth.VerifyPassword("x", "$bcrypt$..."); err == nil {
		t.Error("不支援的格式應回傳錯誤")
	}
	other, _ := auth.HashPassword("correct horse battery")
	if other == hash {
		t.Error("每次的鹽應不同")
	}
}

func TestLoginAuthenticateLogout(t *testing.T) {
	ctx := context.Background()
	store := authtest.NewMemStore()
	svc := auth.NewService(store)
	if _, err := svc.CreateUser(ctx, "amy", "Amy", "long-enough-pw"); err != nil {
		t.Fatal(err)
	}

	if _, _, err := svc.Login(ctx, "amy", "wrong-password"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("錯誤密碼：%v", err)
	}
	if _, _, err := svc.Login(ctx, "nobody", "long-enough-pw"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("不存在的帳號：%v", err)
	}

	user, token, err := svc.Login(ctx, " amy ", "long-enough-pw")
	if err != nil || user.Username != "amy" || token == "" {
		t.Fatalf("登入：%v %v %q", user, err, token)
	}
	if got, err := svc.Authenticate(ctx, token); err != nil || got.ID != user.ID {
		t.Errorf("Authenticate：%v %v", got, err)
	}
	if _, err := svc.Authenticate(ctx, token+"x"); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Errorf("錯誤 token：%v", err)
	}

	// 重設密碼後舊的工作階段失效
	if err := svc.SetPassword(ctx, "amy", "another-long-pw"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Errorf("重設密碼後：%v", err)
	}

	_, token, _ = svc.Login(ctx, "amy", "another-long-pw")
	if err := svc.Logout(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Errorf("登出後：%v", err)
	}

	store.Disable("amy")
	if _, _, err := svc.Login(ctx, "amy", "another-long-pw"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("停用的帳號：%v", err)
	}
}

func TestCreateUserValidation(t *testing.T) {
	ctx := context.Background()
	svc := auth.NewService(authtest.NewMemStore())
	if _, err := svc.CreateUser(ctx, "Amy!", "Amy", "long-enough-pw"); !errors.Is(err, auth.ErrInvalidUsername) {
		t.Errorf("帳號格式：%v", err)
	}
	if _, err := svc.CreateUser(ctx, "amy", "Amy", "short"); err == nil {
		t.Error("密碼太短應失敗")
	}
	if _, err := svc.CreateUser(ctx, "amy", "  ", "long-enough-pw"); err == nil {
		t.Error("顯示名稱空白應失敗")
	}
	_, _ = svc.CreateUser(ctx, "amy", "Amy", "long-enough-pw")
	if _, err := svc.CreateUser(ctx, "amy", "Amy", "long-enough-pw"); !errors.Is(err, auth.ErrUserExists) {
		t.Errorf("重複帳號：%v", err)
	}
}
