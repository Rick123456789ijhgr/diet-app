package objstore

import (
	"context"
	"errors"
	"os"
	"testing"
)

// 需要 MinIO：設定 TEST_MINIO_ENDPOINT（與 TEST_MINIO_ACCESS_KEY、TEST_MINIO_SECRET_KEY）才執行。
func TestMinIORoundTrip(t *testing.T) {
	endpoint := os.Getenv("TEST_MINIO_ENDPOINT")
	if endpoint == "" {
		t.Skip("未設定 TEST_MINIO_ENDPOINT，略過 MinIO 整合測試")
	}
	ctx := context.Background()
	m, err := New(ctx, Config{
		Endpoint: endpoint, AccessKey: os.Getenv("TEST_MINIO_ACCESS_KEY"), SecretKey: os.Getenv("TEST_MINIO_SECRET_KEY"),
		Bucket: "objstore-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Put(ctx, "a/b.png", []byte("hello"), "image/png"); err != nil {
		t.Fatal(err)
	}
	if got, err := m.Get(ctx, "a/b.png"); err != nil || string(got) != "hello" {
		t.Errorf("Get = %q, %v", got, err)
	}
	if err := m.Delete(ctx, "a/b.png"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Get(ctx, "a/b.png"); !errors.Is(err, ErrNotFound) {
		t.Errorf("刪除後 Get：%v", err)
	}
}
