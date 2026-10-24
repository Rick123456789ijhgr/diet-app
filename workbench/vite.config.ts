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
  // '@/…' 指向 src/；tsconfig 的 paths 需保持一致，型別檢查才找得到
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: path.resolve(import.meta.dirname, '../api/internal/webui/static/app'),
    // 輸出資料夾在 workbench/ 之外，Vite 預設不會清空，要明確開啟，避免舊檔案殘留被 embed 進去
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
    // 前端與 API 對瀏覽器而言同源（都是 5173），不需要 CORS，冷啟動的登入 Cookie 也照常帶上。
    // changeOrigin: false 保留原本的 Host 標頭，不改成目標位址。SSE 串流同樣經這個代理轉送。
    proxy: { '/workbench': { target: apiTarget, changeOrigin: false } },
  },
  // Vitest：jsdom 模擬瀏覽器；MSW 等共用設定在 setup.ts；不處理 CSS 以加快測試
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
