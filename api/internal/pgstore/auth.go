package pgstore

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/your-org/diet-app/api/internal/auth"
)

var _ auth.Store = (*DB)(nil)

func (db *DB) UserByUsername(ctx context.Context, username string) (auth.User, string, error) {
	var u auth.User
	var hash string
	err := db.pool.QueryRow(ctx,
		`SELECT id::text, username, display_name, disabled, password_hash FROM users WHERE username = $1`, username,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.Disabled, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, "", auth.ErrNotFound
	}
	return u, hash, err
}

func (db *DB) CreateUser(ctx context.Context, username, displayName, passwordHash string) (auth.User, error) {
	u := auth.User{Username: username, DisplayName: displayName}
	err := db.pool.QueryRow(ctx,
		`INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id::text`,
		username, displayName, passwordHash,
	).Scan(&u.ID)
	if isUniqueViolation(err, "users_username_key") {
		return auth.User{}, auth.ErrUserExists
	}
	return u, err
}

func (db *DB) SetPassword(ctx context.Context, username, passwordHash string) error {
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx,
			`UPDATE users SET password_hash = $2 WHERE username = $1 RETURNING id::text`, username, passwordHash,
		).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return auth.ErrNotFound
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, id)
		return err
	})
}

func (db *DB) CreateSession(ctx context.Context, tokenHash []byte, userID string, expiresAt time.Time) error {
	// 順便清掉過期的工作階段（數量少，不另排程）
	if _, err := db.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at <= now()`); err != nil {
		return err
	}
	_, err := db.pool.Exec(ctx,
		`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, tokenHash, userID, expiresAt)
	return err
}

func (db *DB) SessionUser(ctx context.Context, tokenHash []byte, now time.Time) (auth.User, error) {
	var u auth.User
	err := db.pool.QueryRow(ctx, `
		SELECT u.id::text, u.username, u.display_name, u.disabled
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > $2 AND NOT u.disabled`, tokenHash, now,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.Disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, auth.ErrNotFound
	}
	return u, err
}

func (db *DB) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}
