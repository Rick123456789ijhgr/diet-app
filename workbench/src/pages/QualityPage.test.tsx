import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'

import { routes } from '@/App'
import { TooltipProvider } from '@/components/ui/primitives'
import { createQueryClient } from '@/queryClient'
import { requests, server } from '@/test/server'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  requests.length = 0
})

describe('品質檢查頁', () => {
  it('合成影像後顯示檢查結果與指標', async () => {
    renderAt('/m1/quality')
    expect(await screen.findByText('通過品質檢查', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('模糊分數')).toBeInTheDocument()
    expect(screen.getByText('900')).toBeInTheDocument()
    expect(requests.map((r) => r.path)).toEqual(
      expect.arrayContaining([
        '/workbench/v1/dev/images/synthesize',
        '/workbench/v1/dev/images/base-label/degrade',
        '/workbench/v1/dev/quality',
      ]),
    )
    // 沒有修改參數時不帶 config
    const quality = requests.find((r) => r.path === '/workbench/v1/dev/quality')
    expect(quality?.body).toEqual({ image_id: 'base-label' })
  })

  it('調整退化後送出新的退化影像並顯示警告', async () => {
    const user = userEvent.setup()
    renderAt('/m1/quality')
    await screen.findByText('通過品質檢查', {}, { timeout: 3000 })
    const sigma = screen.getByLabelText('模糊 σ', { selector: 'input' })
    await user.clear(sigma)
    await user.type(sigma, '4')
    expect(await screen.findByText('未通過', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('過於模糊')).toBeInTheDocument()
    const degrade = requests.filter((r) => r.path.endsWith('/degrade')).at(-1)
    expect(degrade?.body).toEqual({ degradation: { blur_sigma: 4 } })
  })

  it('只送出與預設值不同的參數', async () => {
    const user = userEvent.setup()
    renderAt('/m1/quality')
    await screen.findByText('通過品質檢查', {}, { timeout: 3000 })
    await user.click(screen.getByRole('tab', { name: /參數/ }))
    const blurMin = screen.getByLabelText('模糊下限', { selector: 'input' })
    await user.clear(blurMin)
    await user.type(blurMin, '1500')
    expect(await screen.findByText('未通過', {}, { timeout: 3000 })).toBeInTheDocument()
    const last = requests.filter((r) => r.path === '/workbench/v1/dev/quality').at(-1)
    expect(last?.body).toEqual({ image_id: 'base-label', config: { blur_min: 1500 } })
    expect(screen.getByText('已修改 1 項')).toBeInTheDocument()
  })

  it('參數不合法時標出欄位', async () => {
    const user = userEvent.setup()
    renderAt('/m1/quality')
    await screen.findByText('通過品質檢查', {}, { timeout: 3000 })
    await user.click(screen.getByRole('tab', { name: /參數/ }))
    const blurMin = screen.getByLabelText('模糊下限', { selector: 'input' })
    // jsdom 的 number 輸入框會丟掉打到一半的「-」，直接給完整值
    fireEvent.change(blurMin, { target: { value: '-5' } })
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(within(alert).getByText(/參數不合法/)).toBeInTheDocument()
    await waitFor(() => expect(blurMin).toHaveAttribute('aria-invalid', 'true'))
  })

  it('Python 未啟動時顯示中文說明', async () => {
    server.use(
      http.post('*/workbench/v1/dev/images/synthesize', () =>
        HttpResponse.json(
          { code: 'AI_UNAVAILABLE', message: 'connection refused' },
          { status: 503 },
        ),
      ),
    )
    renderAt('/m1/quality')
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(within(alert).getByText(/Python 服務沒有回應/)).toBeInTheDocument()
  })

  it('指標的通過與否取自後端警告，不由前端拿數值比門檻', async () => {
    // 數值都在門檻內，但後端判定過暗：過暗比例要標 ✕，其餘標 ✓
    server.use(
      http.post('*/workbench/v1/dev/quality', () =>
        HttpResponse.json({
          passed: false,
          blur_score: 900,
          mean_brightness: 183,
          dark_ratio: 0.05,
          bright_ratio: 0,
          resolution_ok: true,
          warnings: ['TOO_DARK'],
          steps: [],
        }),
      ),
    )
    renderAt('/m1/quality')
    expect(await screen.findByText('未通過', {}, { timeout: 3000 })).toBeInTheDocument()
    const mark = (label: string) => screen.getByText(label).parentElement!.textContent
    expect(mark('過暗比例')).toContain('✕')
    expect(mark('模糊分數')).toContain('✓')
    expect(mark('過亮比例')).toContain('✓')
    expect(mark('短邊')).toContain('✓')
  })

  it('直方圖檢視標出門檻', async () => {
    const user = userEvent.setup()
    renderAt('/m1/quality')
    await screen.findByText('通過品質檢查', {}, { timeout: 3000 })
    await user.click(screen.getByRole('radio', { name: /直方圖/ }))
    expect(await screen.findByText('過暗灰階 30')).toBeInTheDocument()
    expect(screen.getByText('過亮灰階 225')).toBeInTheDocument()
  })
})

describe('外框', () => {
  it('左側列出所有模組，尚無工具的模組顯示說明', async () => {
    renderAt('/m2')
    expect(await screen.findByText('條碼、發票、營養標示尚無工具。')).toBeInTheDocument()
    const rail = screen.getByRole('navigation', { name: '模組清單' })
    expect(within(rail).getAllByRole('link')).toHaveLength(7)
    expect(within(rail).getByRole('link', { name: '冷啟動上傳' })).toHaveAttribute(
      'href',
      '/coldstart',
    )
  })

  it('總覽列出各模組的工具', () => {
    renderAt('/')
    expect(screen.getByText('影像前處理')).toBeInTheDocument()
    // 模組一的七個工具都已遷移，另有冷啟動的上傳清單
    expect(screen.getAllByText('可用')).toHaveLength(8)
  })
})
