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
  it('模組選單列出所有模組，尚無工具的模組顯示說明', async () => {
    const user = userEvent.setup()
    renderAt('/coldstart')
    expect(await screen.findByText('冷啟動上傳尚無工具。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '切換模組' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(7)
    expect(menu).toHaveTextContent('影像前處理')
  })

  it('總覽列出各模組的工具', () => {
    renderAt('/')
    expect(screen.getByText('影像前處理')).toBeInTheDocument()
    // 模組一的七個工具都已遷移
    expect(screen.getAllByText('可用')).toHaveLength(7)
  })
})
