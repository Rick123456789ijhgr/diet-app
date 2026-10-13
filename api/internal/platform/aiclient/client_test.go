package aiclient

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/platform/requestid"
)

// fakePreprocess 記錄收到的 metadata，並依 err 回傳錯誤。
type fakePreprocess struct {
	dietaiv1.UnimplementedPreprocessServiceServer
	gotRequestID string
	err          error
}

func (f *fakePreprocess) CheckQuality(ctx context.Context, _ *dietaiv1.CheckQualityRequest) (*dietaiv1.CheckQualityResponse, error) {
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		if v := md.Get("x-request-id"); len(v) > 0 {
			f.gotRequestID = v[0]
		}
	}
	if f.err != nil {
		return nil, f.err
	}
	return &dietaiv1.CheckQualityResponse{Passed: true}, nil
}

func startServer(t *testing.T, fake *fakePreprocess) *Client {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer()
	dietaiv1.RegisterPreprocessServiceServer(srv, fake)
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)

	c, err := New("passthrough:///bufnet", grpc.WithContextDialer(
		func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) },
	))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func withErrorInfo(t *testing.T, code codes.Code, reason, field string) error {
	t.Helper()
	info := &errdetails.ErrorInfo{Reason: reason, Domain: "dietai"}
	if field != "" {
		info.Metadata = map[string]string{"field": field}
	}
	st, err := status.New(code, "訊息").WithDetails(info)
	if err != nil {
		t.Fatal(err)
	}
	return st.Err()
}

func TestRequestIDIsForwarded(t *testing.T) {
	fake := &fakePreprocess{}
	c := startServer(t, fake)
	ctx := requestid.With(context.Background(), "abc123")
	if _, err := c.CheckQuality(ctx, &dietaiv1.CheckQualityRequest{}); err != nil {
		t.Fatal(err)
	}
	if fake.gotRequestID != "abc123" {
		t.Errorf("x-request-id = %q, want abc123", fake.gotRequestID)
	}
}

func TestErrorsCarryReasonAndField(t *testing.T) {
	tests := []struct {
		name       string
		serverErr  error
		wantCode   codes.Code
		wantReason string
		wantField  string
	}{
		{"ErrorInfo 含欄位", withErrorInfo(t, codes.InvalidArgument, "INVALID_CONFIG", "blur_min"),
			codes.InvalidArgument, "INVALID_CONFIG", "blur_min"},
		{"ErrorInfo 不含欄位", withErrorInfo(t, codes.NotFound, "IMAGE_NOT_FOUND", ""),
			codes.NotFound, "IMAGE_NOT_FOUND", ""},
		{"沒有 ErrorInfo 時依狀態碼", status.Error(codes.Unimplemented, "x"),
			codes.Unimplemented, ReasonNotImplemented, ""},
		{"未知錯誤", status.Error(codes.Internal, "boom"),
			codes.Internal, ReasonInternal, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := startServer(t, &fakePreprocess{err: tt.serverErr})
			_, err := c.CheckQuality(context.Background(), &dietaiv1.CheckQualityRequest{})
			var aiErr *Error
			if !errors.As(err, &aiErr) {
				t.Fatalf("err = %v, want *Error", err)
			}
			if aiErr.Code != tt.wantCode || aiErr.Reason != tt.wantReason || aiErr.Field != tt.wantField {
				t.Errorf("got (%v, %q, %q), want (%v, %q, %q)",
					aiErr.Code, aiErr.Reason, aiErr.Field, tt.wantCode, tt.wantReason, tt.wantField)
			}
		})
	}
}

func TestUnreachableServerIsUnavailable(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := lis.Addr().String()
	_ = lis.Close() // 取得一個沒有人監聽的位址

	c, err := New(addr)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err = c.CheckQuality(ctx, &dietaiv1.CheckQualityRequest{})
	var aiErr *Error
	if !errors.As(err, &aiErr) || aiErr.Reason != ReasonUnavailable {
		t.Fatalf("err = %v, want reason %s", err, ReasonUnavailable)
	}
}
