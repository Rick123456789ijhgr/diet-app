/// <reference types="vitest/config" />
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 開發時（make workbench-dev）/workbench 轉給 Go 主伺服器
// 建置結果輸出到 Go 的 internal/webui，以 embed 打包進執行檔（make workbench）
const apiTarget = process.env.WORKBENCH_API ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: path.resolve(import.meta.dirname, '../api/internal/webui/static/app'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 共用套件獨立成一包，頁面更新時瀏覽器仍可沿用快取
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          ui: ['radix-ui', '@tanstack/react-query', 'openapi-fetch'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/workbench': { target: apiTarget, changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
