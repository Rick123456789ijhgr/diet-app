// 冒煙測試：接真的 Go 與 Python（scripts/dev.mjs 一次啟動三個程序）。只在本機執行：npm run test:e2e
// 已在執行時直接沿用；可用 WORKBENCH_URL 指向其他位址。
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.WORKBENCH_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.WORKBENCH_URL
    ? undefined
    : {
        command: 'node scripts/dev.mjs',
        url: baseURL,
        env: { WORKBENCH_NO_OPEN: '1' },
        reuseExistingServer: true,
        timeout: 180_000,
      },
})
