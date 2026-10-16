// Package auth 負責工作台的組員登入：帳號密碼（argon2id）與工作階段。
//
// 帳號由管理指令（cmd/wbuser）建立，不開放註冊。工作階段 token 只存在使用者的 Cookie，
// 資料庫只存它的 SHA-256；登出即刪除，7 天後過期。
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

// SessionTTL 是工作階段的有效期間。
const SessionTTL = 7 * 24 * time.Hour

var (
	// ErrInvalidCredentials 表示帳號不存在、已停用或密碼錯誤（不區分，避免洩漏帳號是否存在）。
	ErrInvalidCredentials = errors.New("帳號或密碼錯誤")
	// ErrUnauthenticated 表示沒有有效的工作階段。
	ErrUnauthenticated = errors.New("尚未登入或登入已過期")
	// ErrNotFound 由 Store 回傳：找不到帳號或工作階段。
	ErrNotFound = errors.New("找不到")
	// ErrUserExists 由 Store 回傳：帳號已存在。
	ErrUserExists = errors.New("帳號已存在")
	// ErrTooManyAttempts 表示同一帳號短時間內失敗太多次，暫時不接受登入。
	ErrTooManyAttempts = errors.New("登入失敗次數過多，請稍後再試")
	// ErrInvalidUsername 表示帳號格式不符（3–32 個小寫英數字或 _ . -）。
	ErrInvalidUsername = errors.New("帳號須為 3–32 個小寫英文字母、數字或 _ . -")
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9_.-]{3,32}$`)

// MinPasswordLen 是密碼的最短長度。
const MinPasswordLen = 10

// 登入限制：同一帳號在 lockWindow 內失敗 maxFailures 次後暫停登入；
// argon2id 每次約用 64 MiB，同時最多計算 maxConcurrentHashes 個，避免大量請求耗盡記憶體。
const (
	maxFailures         = 10
	lockWindow          = 15 * time.Minute
	maxConcurrentHashes = 4
)

// User 是組員帳號。
type User struct {
	ID          string
	Username    string
	DisplayName string
	Disabled    bool
}

// Store 是帳號與工作階段的儲存；正式實作在 internal/pgstore。
type Store interface {
	// UserByUsername 回傳帳號與密碼雜湊；不存在時回傳 ErrNotFound。
	UserByUsername(ctx context.Context, username string) (User, string, error)
	// CreateUser 建立帳號；已存在時回傳 ErrUserExists。
	CreateUser(ctx context.Context, username, displayName, passwordHash string) (User, error)
	// SetPassword 更新密碼並刪除該帳號所有工作階段；不存在時回傳 ErrNotFound。
	SetPassword(ctx context.Context, username, passwordHash string) error
	CreateSession(ctx context.Context, tokenHash []byte, userID string, expiresAt time.Time) error
	// SessionUser 回傳未過期工作階段的帳號（已停用的帳號視為不存在）；否則回傳 ErrNotFound。
	SessionUser(ctx context.Context, tokenHash []byte, now time.Time) (User, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
}

// Service 處理登入、登出與驗證工作階段。
type Service struct {
	store Store
	now   func() time.Time
	// dummyHash 用於帳號不存在時仍做一次雜湊比對，讓回應時間不洩漏帳號是否存在
	dummyHash string
	hashSlots chan struct{}

	mu       sync.Mutex
	failures map[string][]time.Time // 帳號 → lockWindow 內的失敗時間
}

func NewService(store Store) *Service {
	dummy, err := HashPassword("dummy-password-for-timing")
	if err != nil {
		panic(err)
	}
	return &Service{
		store: store, now: time.Now, dummyHash: dummy,
		hashSlots: make(chan struct{}, maxConcurrentHashes), failures: map[string][]time.Time{},
	}
}

// Login 驗證帳號密碼並建立工作階段，回傳要放進 Cookie 的 token。
func (s *Service) Login(ctx context.Context, username, password string) (User, string, error) {
	username = strings.TrimSpace(username)
	if s.locked(username) {
		return User{}, "", ErrTooManyAttempts
	}
	user, hash, err := s.store.UserByUsername(ctx, username)
	if errors.Is(err, ErrNotFound) {
		hash, err = s.dummyHash, nil
	}
	if err != nil {
		return User{}, "", err
	}
	ok, err := s.verify(ctx, password, hash)
	if err != nil {
		return User{}, "", err
	}
	if !ok || user.ID == "" || user.Disabled {
		s.recordFailure(username)
		return User{}, "", ErrInvalidCredentials
	}
	s.clearFailures(username)
	token, tokenHash, err := newToken()
	if err != nil {
		return User{}, "", err
	}
	if err := s.store.CreateSession(ctx, tokenHash, user.ID, s.now().Add(SessionTTL)); err != nil {
		return User{}, "", err
	}
	return user, token, nil
}

// Authenticate 由 Cookie 中的 token 取得登入者；無效時回傳 ErrUnauthenticated。
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrUnauthenticated
	}
	user, err := s.store.SessionUser(ctx, hashToken(token), s.now())
	if errors.Is(err, ErrNotFound) {
		return User{}, ErrUnauthenticated
	}
	return user, err
}

// Logout 刪除工作階段。
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.store.DeleteSession(ctx, hashToken(token))
}

// CreateUser 建立組員帳號（管理指令使用）。
func (s *Service) CreateUser(ctx context.Context, username, displayName, password string) (User, error) {
	if !usernamePattern.MatchString(username) {
		return User{}, ErrInvalidUsername
	}
	if strings.TrimSpace(displayName) == "" {
		return User{}, errors.New("顯示名稱不可空白")
	}
	hash, err := hashChecked(password)
	if err != nil {
		return User{}, err
	}
	return s.store.CreateUser(ctx, username, strings.TrimSpace(displayName), hash)
}

// SetPassword 重設密碼，並讓該帳號所有工作階段失效（管理指令使用）。
func (s *Service) SetPassword(ctx context.Context, username, password string) error {
	hash, err := hashChecked(password)
	if err != nil {
		return err
	}
	return s.store.SetPassword(ctx, username, hash)
}

// verify 在限定的並行數內比對密碼。
func (s *Service) verify(ctx context.Context, password, hash string) (bool, error) {
	select {
	case s.hashSlots <- struct{}{}:
	case <-ctx.Done():
		return false, ctx.Err()
	}
	defer func() { <-s.hashSlots }()
	return VerifyPassword(password, hash)
}

func (s *Service) recent(username string) []time.Time {
	cutoff := s.now().Add(-lockWindow)
	kept := s.failures[username][:0]
	for _, t := range s.failures[username] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(s.failures, username)
		return nil
	}
	s.failures[username] = kept
	return kept
}

func (s *Service) locked(username string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.recent(username)) >= maxFailures
}

func (s *Service) recordFailure(username string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// 大量不同帳號（含不存在的）失敗時，先清掉過期的紀錄，避免記憶體無限成長
	if len(s.failures) > 10000 {
		for name := range s.failures {
			s.recent(name)
		}
	}
	s.failures[username] = append(s.recent(username), s.now())
}

func (s *Service) clearFailures(username string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.failures, username)
}

func hashChecked(password string) (string, error) {
	if len([]rune(password)) < MinPasswordLen {
		return "", fmt.Errorf("密碼至少 %d 個字元", MinPasswordLen)
	}
	return HashPassword(password)
}

func newToken() (string, []byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	return token, hashToken(token), nil
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

type userKey struct{}

// WithUser 把登入者放進 context（由 HTTP 中介層呼叫）。
func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, userKey{}, u)
}

// UserFrom 取出登入者；未登入時 ok 為 false。
func UserFrom(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(userKey{}).(User)
	return u, ok
}
