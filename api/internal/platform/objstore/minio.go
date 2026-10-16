// Package objstore 是照片原檔的物件儲存（MinIO，S3 相容）。
package objstore

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// ErrNotFound 表示物件不存在；實作 NotFound() bool，讓呼叫端不必 import 本套件也能判斷。
var ErrNotFound error = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string  { return "objstore: 物件不存在" }
func (notFoundError) NotFound() bool { return true }

// Config 是 MinIO 連線設定。
type Config struct {
	Endpoint  string // 例如 localhost:9000
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

// MinIO 實作 coldstart.Objects。
type MinIO struct {
	client *minio.Client
	bucket string
}

// New 連線 MinIO，bucket 不存在時建立。
func New(ctx context.Context, cfg Config) (*MinIO, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("objstore: 連線設定: %w", err)
	}
	exists, err := client.BucketExists(ctx, cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("objstore: 無法連線 MinIO（%s）: %w", cfg.Endpoint, err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("objstore: 建立 bucket %s: %w", cfg.Bucket, err)
		}
	}
	return &MinIO{client: client, bucket: cfg.Bucket}, nil
}

func (m *MinIO) Put(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := m.client.PutObject(ctx, m.bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType})
	return err
}

func (m *MinIO) Get(ctx context.Context, key string) ([]byte, error) {
	obj, err := m.client.GetObject(ctx, m.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, notFoundOr(err)
	}
	defer obj.Close()
	// GetObject 是延遲的：Stat 才會真的發出請求，物件不存在時在這裡得知
	if _, err := obj.Stat(); err != nil {
		return nil, notFoundOr(err)
	}
	data, err := io.ReadAll(obj)
	if err != nil {
		return nil, notFoundOr(err)
	}
	return data, nil
}

func (m *MinIO) Delete(ctx context.Context, key string) error {
	return m.client.RemoveObject(ctx, m.bucket, key, minio.RemoveObjectOptions{})
}

func notFoundOr(err error) error {
	if minio.ToErrorResponse(err).Code == "NoSuchKey" {
		return ErrNotFound
	}
	return err
}
