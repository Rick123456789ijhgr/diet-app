// Package pgstore 是 auth.Store 與 coldstart.Store 的 PostgreSQL 實作（pgx）。
//
// 資料表見 db/migrations/000002_coldstart.up.sql；Go 是資料庫唯一的寫入者（根目錄 CLAUDE.md 規則 2）。
package pgstore

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB 包裝連線池；同時實作 auth.Store 與 coldstart.Store。
type DB struct {
	pool *pgxpool.Pool
}

// Open 連線並確認資料庫可用。
func Open(ctx context.Context, url string) (*DB, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("pgstore: 連線設定: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pgstore: 無法連線資料庫: %w", err)
	}
	return &DB{pool: pool}, nil
}

func (db *DB) Close() { db.pool.Close() }

// querier 是連線池與交易共用的查詢介面。
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// validID 檢查 UUID 格式：格式不對的 ID 一律視為找不到，不送進資料庫產生型別錯誤。
func validID(id string) bool { return uuidPattern.MatchString(id) }

func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && (constraint == "" || pgErr.ConstraintName == constraint)
}
