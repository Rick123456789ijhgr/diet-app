// 冒煙測試開始前，等整條鏈路（Vite → Go → Python）都就緒；
// webServer 只等得到 Vite，冷啟動時 Go 還在編譯、Python 還在載入。
import type { FullConfig } from '@playwright/test'

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:5173'
  const url = `${baseURL}/workbench/v1/dev/config-schemas`
  const deadline = Date.now() + 180_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (err) {
      last = String(err)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`工作台服務沒有就緒（${url}）：${last}`)
}
