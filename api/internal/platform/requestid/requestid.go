// Package requestid 在 context 中傳遞請求 ID，供日誌與跨服務追蹤（HTTP → gRPC metadata）。
package requestid

import (
	"context"
	"crypto/rand"
	"encoding/hex"
)

// Header 是 HTTP 請求與回應帶請求 ID 的標頭；gRPC metadata 使用同名小寫鍵 x-request-id。
const Header = "X-Request-ID"

type ctxKey struct{}

// With 回傳帶有請求 ID 的 context。
func With(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// From 取出請求 ID；沒有時回傳空字串。
func From(ctx context.Context) string {
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

// New 產生 16 個十六進位字元的隨機 ID。
func New() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
