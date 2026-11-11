package main

import "testing"

func TestListenAddr(t *testing.T) {
	tests := []struct {
		name     string
		host     string
		devTools bool
		want     string
	}{
		{"開發工具開啟時預設只聽本機", "", true, "127.0.0.1:8080"},
		{"開發工具關閉時預設聽所有網卡", "", false, ":8080"},
		{"明確指定 HOST 時照用（開發工具開啟）", "0.0.0.0", true, "0.0.0.0:8080"},
		{"明確指定 HOST 時照用（開發工具關閉）", "127.0.0.1", false, "127.0.0.1:8080"},
		{"IPv6 位址加上方括號", "::1", true, "[::1]:8080"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := listenAddr(tt.host, "8080", tt.devTools); got != tt.want {
				t.Errorf("listenAddr(%q, 8080, %v) = %q，預期 %q", tt.host, tt.devTools, got, tt.want)
			}
		})
	}
}
