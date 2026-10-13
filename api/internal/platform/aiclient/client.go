// Package aiclient 是呼叫 Python 服務（ai/）的 gRPC 客戶端。
//
// 每次呼叫自動帶上請求 ID（metadata x-request-id）與預設逾時；
// 錯誤一律轉成 *Error，含 Python 以 google.rpc.ErrorInfo 回傳的錯誤代碼與欄位名稱。
package aiclient

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	dietaiv1 "github.com/your-org/diet-app/api/gen/proto/dietai/v1"
	"github.com/your-org/diet-app/api/internal/platform/requestid"
)

// MaxMessageBytes 與 Python 端一致：照片原檔可能超過 gRPC 預設的 4 MB（ADR 0003）。
const MaxMessageBytes = 32 << 20

// DefaultTimeout 是呼叫端沒有設定期限時的逾時。
const DefaultTimeout = 30 * time.Second

// Client 同時提供正式前處理與開發工作台兩個服務；Python 未開啟開發模式時，
// WorkbenchService 的呼叫會回傳 Unimplemented。
type Client struct {
	dietaiv1.PreprocessServiceClient
	dietaiv1.WorkbenchServiceClient
	conn *grpc.ClientConn
}

// New 建立客戶端。連線是延遲建立的：Python 尚未啟動時 New 仍會成功，呼叫時才回傳 AI_UNAVAILABLE。
func New(target string, opts ...grpc.DialOption) (*Client, error) {
	base := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(MaxMessageBytes),
			grpc.MaxCallSendMsgSize(MaxMessageBytes),
		),
		grpc.WithChainUnaryInterceptor(unaryInterceptor),
		grpc.WithChainStreamInterceptor(streamInterceptor),
	}
	conn, err := grpc.NewClient(target, append(base, opts...)...)
	if err != nil {
		return nil, fmt.Errorf("aiclient: 建立 gRPC 連線 %s: %w", target, err)
	}
	return &Client{
		PreprocessServiceClient: dietaiv1.NewPreprocessServiceClient(conn),
		WorkbenchServiceClient:  dietaiv1.NewWorkbenchServiceClient(conn),
		conn:                    conn,
	}, nil
}

// Close 關閉連線。
func (c *Client) Close() error {
	return c.conn.Close()
}

func outgoing(ctx context.Context) context.Context {
	if id := requestid.From(ctx); id != "" {
		ctx = metadata.AppendToOutgoingContext(ctx, "x-request-id", id)
	}
	return ctx
}

func unaryInterceptor(
	ctx context.Context, method string, req, reply any,
	cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption,
) error {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, DefaultTimeout)
		defer cancel()
	}
	if err := invoker(outgoing(ctx), method, req, reply, cc, opts...); err != nil {
		return FromError(err)
	}
	return nil
}

// 串流（批次、E1）的期限由呼叫端決定，這裡只帶請求 ID。
func streamInterceptor(
	ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn,
	method string, streamer grpc.Streamer, opts ...grpc.CallOption,
) (grpc.ClientStream, error) {
	s, err := streamer(outgoing(ctx), desc, cc, method, opts...)
	if err != nil {
		return nil, FromError(err)
	}
	return s, nil
}
