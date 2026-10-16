// Package authtest 提供 auth.Store 的記憶體實作，供其他套件的測試使用。
package authtest

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/your-org/diet-app/api/internal/auth"
)

type session struct {
	userID    string
	expiresAt time.Time
}

// MemStore 是 auth.Store 的記憶體實作。
type MemStore struct {
	mu       sync.Mutex
	users    map[string]auth.User // username → 帳號
	hashes   map[string]string    // username → 密碼雜湊
	sessions map[string]session   // string(tokenHash) → 工作階段
}

func NewMemStore() *MemStore {
	return &MemStore{users: map[string]auth.User{}, hashes: map[string]string{}, sessions: map[string]session{}}
}

var _ auth.Store = (*MemStore)(nil)

func (m *MemStore) UserByUsername(_ context.Context, username string) (auth.User, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[username]
	if !ok {
		return auth.User{}, "", auth.ErrNotFound
	}
	return u, m.hashes[username], nil
}

func (m *MemStore) CreateUser(_ context.Context, username, displayName, hash string) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.users[username]; ok {
		return auth.User{}, auth.ErrUserExists
	}
	u := auth.User{ID: fmt.Sprintf("00000000-0000-0000-0000-%012d", len(m.users)+1), Username: username, DisplayName: displayName}
	m.users[username] = u
	m.hashes[username] = hash
	return u, nil
}

func (m *MemStore) SetPassword(_ context.Context, username, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[username]
	if !ok {
		return auth.ErrNotFound
	}
	m.hashes[username] = hash
	for k, s := range m.sessions {
		if s.userID == u.ID {
			delete(m.sessions, k)
		}
	}
	return nil
}

// Disable 停用帳號（測試用）。
func (m *MemStore) Disable(username string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u := m.users[username]
	u.Disabled = true
	m.users[username] = u
}

func (m *MemStore) CreateSession(_ context.Context, tokenHash []byte, userID string, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[string(tokenHash)] = session{userID, expiresAt}
	return nil
}

func (m *MemStore) SessionUser(_ context.Context, tokenHash []byte, now time.Time) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[string(tokenHash)]
	if !ok || !now.Before(s.expiresAt) {
		return auth.User{}, auth.ErrNotFound
	}
	for _, u := range m.users {
		if u.ID == s.userID && !u.Disabled {
			return u, nil
		}
	}
	return auth.User{}, auth.ErrNotFound
}

func (m *MemStore) DeleteSession(_ context.Context, tokenHash []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, string(tokenHash))
	return nil
}

// Sessions 回傳目前的工作階段數（測試用）。
func (m *MemStore) Sessions() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}
