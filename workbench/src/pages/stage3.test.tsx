// 階段 3 的頁面：參數掃描、資料夾批次、E1（後端為 src/test/server.ts 的假實作，批次與 E1 以 SSE 回應）。
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderAt } from '@/test/render'
import { requests } from '@/test/server'

const WAIT = { timeout: 3000 }

beforeEach(() => {
  requests.length = 0
})

const bodies = (path: string) => requests.filter((r) => r.path === path).map((r) => r.body)

describe('參數掃描頁', () => {
  it('品質檢查：顯示各警告首次觸發的等級與折線圖', async () => {
    renderAt('/m1/sweep')
    expect(await screen.findByText('≥ 8', {}, WAIT)).toBeInTheDocument()
    expect(screen.getAllByText('未觸發')).toHaveLength(3)
    expect(screen.getByRole('img', { name: /模糊分數隨高斯模糊 σ變化/ })).toBeInTheDocument()
    // 第一次請求就帶著影像（防抖跟上前不送出）
    const first = bodies('/workbench/v1/dev/sweeps')[0] as { params: { image_id?: string } }
    expect(first.params.image_id).toBe('base-label')
  })

  it('條碼：比較只用原圖與逐步升級，切換退化種類時套用預設範圍', async () => {
    const user = userEvent.setup()
    renderAt('/m1/sweep')
    await screen.findByText('≥ 8', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /條碼解碼/ }))
    expect(await screen.findByText('首次失敗於 45', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('+50%')).toBeInTheDocument()
    const last = bodies('/workbench/v1/dev/sweeps').at(-1) as {
      target: string
      params: Record<string, unknown>
    }
    expect(last.target).toBe('barcode')
    expect(last.params).toMatchObject({ axis: 'rotate_deg', lo: 0, hi: 45, samples: 5 })
    expect(screen.getByRole('tab', { name: /掃描/ })).toBeInTheDocument()
  })

  it('下限不小於上限時顯示中文錯誤且不送出請求', async () => {
    const user = userEvent.setup()
    renderAt('/m1/sweep')
    await screen.findByText('≥ 8', {}, WAIT)
    const before = bodies('/workbench/v1/dev/sweeps').length
    const lo = screen.getByLabelText('範圍下限')
    await user.clear(lo)
    await user.type(lo, '10')
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('下限必須小於上限')
    expect(lo).toHaveAttribute('aria-invalid', 'true')
    await new Promise((r) => setTimeout(r, 300))
    expect(bodies('/workbench/v1/dev/sweeps')).toHaveLength(before)
    // 改回合法範圍後錯誤消失並重新送出
    await user.clear(lo)
    await user.type(lo, '1')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/sweeps').at(-1)).toMatchObject({
        params: { lo: 1, hi: 8 },
      }),
    )
  })

  it('條碼：匯出入同時涵蓋階梯與解碼器設定，成功階依階梯順序堆疊', async () => {
    const user = userEvent.setup()
    renderAt('/m1/sweep')
    await screen.findByText('≥ 8', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /條碼解碼/ }))
    await screen.findByText('首次失敗於 45', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /成功階/ }))
    const legend = screen.getByRole('img', { name: /逐步升級成功於哪一階/ }).nextElementSibling
    expect(legend?.textContent).toMatch(/原圖.*校正/)
    await user.click(screen.getByRole('tab', { name: /匯出入/ }))
    expect(screen.getByText('階梯設定')).toBeInTheDocument()
    expect(screen.getByText('解碼器設定')).toBeInTheDocument()
    await user.type(
      screen.getByLabelText('匯入的設定 JSON（解碼器設定）'),
      '{{"try_rotate": false}',
    )
    const buttons = screen.getAllByRole('button', { name: '匯入' })
    await user.click(buttons[1]!)
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/sweeps').at(-1)).toMatchObject({
        params: { zxing: { try_rotate: false } },
      }),
    )
  })
})

describe('資料夾批次頁', () => {
  it('逐張顯示結果與彙整，點選列檢視單張', async () => {
    const user = userEvent.setup()
    renderAt('/m1/batch')
    await user.type(await screen.findByRole('textbox', { name: '資料夾' }), 'D:/photos')
    await user.click(screen.getByRole('button', { name: '執行' }))
    expect(await screen.findByText('50.0%', {}, WAIT)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: '每張影像的品質檢查結果' })
    expect(within(table).getByText('無法解碼影像')).toBeInTheDocument()
    expect(screen.getByText('讀取失敗')).toBeInTheDocument()
    // 讀取失敗的列不可選取，不顯示可點的游標
    expect(within(table).getByText('無法解碼影像').closest('tr')).not.toHaveClass('cursor-pointer')
    expect(within(table).getByText('a.png').closest('tr')).toHaveClass('cursor-pointer')
    await user.click(within(table).getByText('a.png'))
    expect(await screen.findByAltText('a.png（original）', {}, WAIT)).toBeInTheDocument()
    expect(bodies('/workbench/v1/dev/batches')).toContainEqual({
      folder: 'D:/photos/a.png',
      limit: 1,
    })
  })

  it('最多張數可暫時清空，失焦時才夾到範圍內', async () => {
    const user = userEvent.setup()
    renderAt('/m1/batch')
    const limit = await screen.findByLabelText('最多張數')
    await user.clear(limit)
    // 清空時不會立刻變成 1
    expect(limit).toHaveValue(null)
    await user.type(limit, '9000')
    expect(limit).toHaveValue(9000)
    await user.tab()
    expect(limit).toHaveValue(5000)
    await user.type(screen.getByRole('textbox', { name: '資料夾' }), 'D:/photos')
    await user.click(screen.getByRole('button', { name: '執行' }))
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/batches')).toContainEqual(
        expect.objectContaining({ folder: 'D:/photos', limit: 5000 }),
      ),
    )
  })

  it('測試集被拒絕時顯示說明', async () => {
    const user = userEvent.setup()
    renderAt('/m1/batch')
    await user.type(await screen.findByRole('textbox', { name: '資料夾' }), 'D:/data/splits/test')
    await user.click(screen.getByRole('button', { name: '執行' }))
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('測試集已鎖定')
  })
})

describe('E1 頁', () => {
  it('顯示整體成功率、誤讀提醒、分組熱度圖與失敗影像', async () => {
    const user = userEvent.setup()
    renderAt('/m1/e1')
    expect(await screen.findByRole('img', { name: /整體成功率長條圖/ }, WAIT)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('共有 1 次誤讀')
    const summary = screen.getByRole('table', { name: '各實驗組的整體彙整' })
    expect(within(summary).getByText('基準')).toBeInTheDocument()
    expect(within(summary).getByText('15.0%–85.0%')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '分組條件' }), 'condition')
    await user.click(screen.getByRole('radio', { name: /依條件分組/ }))
    expect(screen.getByRole('img', { name: /condition 的成功率熱度圖/ })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /失敗影像/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: '實驗組' }), 'a0_raw')
    await user.click(screen.getByText('img-1'))
    expect(await screen.findByAltText('失敗影像 img-1', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '這張影像每一階的嘗試紀錄' })).toBeInTheDocument()
  })

  it('快速執行回報進度，完成後切換到新的執行；中途失敗時顯示錯誤', async () => {
    const user = userEvent.setup()
    renderAt('/m1/e1')
    await screen.findByRole('img', { name: /整體成功率長條圖/ }, WAIT)
    await user.click(screen.getByRole('tab', { name: '快速執行' }))
    // 預設選取 a0_raw、a6_full
    expect(screen.getByRole('button', { name: 'a0_raw' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '執行' }))
    expect(await screen.findByText('完成，已切換到新的執行結果。', {}, WAIT)).toBeInTheDocument()
    expect(bodies('/workbench/v1/dev/e1/runs')).toContainEqual({
      arms: ['a0_raw', 'a6_full'],
      n_codes: 2,
    })

    await user.click(screen.getByRole('button', { name: 'm1_agree2' }))
    await user.click(screen.getByRole('button', { name: '執行' }))
    // 條碼數可暫時清空（不會立刻變成 1），失焦後恢復成目前值
    const nCodes = screen.getByLabelText('條碼數')
    await user.clear(nCodes)
    expect(nCodes).toHaveValue(null)
    await user.tab()
    expect(nCodes).toHaveValue(2)

    // 誤讀提醒也是 alert，在所有 alert 中找錯誤訊息
    await waitFor(
      () =>
        expect(
          screen.getAllByRole('alert').some((a) => a.textContent?.includes('伺服器內部錯誤')),
        ).toBe(true),
      WAIT,
    )
  })
})

describe('E1 頁的邊界情況', () => {
  it('剛輸入資料夾就按快速執行時，帶的是輸入框目前的資料夾', async () => {
    const user = userEvent.setup()
    renderAt('/m1/e1')
    await screen.findByRole('img', { name: /整體成功率長條圖/ }, WAIT)
    await user.type(screen.getByLabelText('結果資料夾'), 'D:/new-runs')
    // 不等 400 ms 防抖，立刻切到快速執行並按下
    await user.click(screen.getByRole('tab', { name: '快速執行' }))
    await user.click(screen.getByRole('button', { name: '執行' }))
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/e1/runs')).toContainEqual(
        expect.objectContaining({ root: 'D:/new-runs' }),
      ),
    )
  })
})

describe('門檻與結果配對', () => {
  it('參數不合法時，門檻線仍是算出曲線的那組參數', async () => {
    const { http, HttpResponse } = await import('msw')
    const { server } = await import('@/test/server')
    const user = userEvent.setup()
    server.use(
      http.post('*/workbench/v1/dev/sweeps', async ({ request }) => {
        const body = (await request.clone().json()) as {
          params: { config?: { blur_min?: number } }
        }
        if ((body.params.config?.blur_min ?? 100) > 1000) {
          return HttpResponse.json(
            { code: 'INVALID_CONFIG', message: '模擬不合法', field: 'blur_min' },
            { status: 400 },
          )
        }
        return undefined
      }),
    )
    renderAt('/m1/sweep')
    await screen.findByText('模糊下限（下限）= 100', {}, WAIT)
    await user.click(screen.getByRole('tab', { name: /參數/ }))
    const input = screen.getByLabelText('模糊下限', { selector: 'input' })
    await user.clear(input)
    await user.type(input, '1500')
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('參數不合法')
    // 曲線仍是 blur_min=100 算的，門檻線不能跟著變成 1500
    expect(screen.getByText('模糊下限（下限）= 100')).toBeInTheDocument()
    expect(screen.queryByText('模糊下限（下限）= 1500')).not.toBeInTheDocument()
  })
})
