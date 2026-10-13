/// <reference types="vitest/config" />
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 開發時 /workbench 轉給 Go 主伺服器（make workbench-react 會一併啟動）
const apiTarget = process.env.WORKBENCH_API ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
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
