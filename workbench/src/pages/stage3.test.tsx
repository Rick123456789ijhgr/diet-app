// 階段 3 的頁面：多張測試（參數掃描、資料夾批次）、實驗結果（E1、自適應策略）（後端為 src/test/server.ts 的假實作，批次與 E1 以 SSE 回應）。
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

describe('多張測試・參數掃描', () => {
  it('品質檢查：顯示各警告首次觸發的等級與折線圖', async () => {
    renderAt('/m1/multi/sweep')
    expect(await screen.findByText('≥ 8', {}, WAIT)).toBeInTheDocument()
    expect(screen.getAllByText('未觸發')).toHaveLength(3)
    expect(screen.getByRole('img', { name: /模糊分數隨高斯模糊 σ變化/ })).toBeInTheDocument()
    // 第一次請求就帶著影像（防抖跟上前不送出）
    const first = bodies('/workbench/v1/dev/sweeps')[0] as { params: { image_id?: string } }
    expect(first.params.image_id).toBe('base-label')
  })

  it('條碼：比較只用原圖與逐步升級，切換退化種類時套用預設範圍', async () => {
    const user = userEvent.setup()
    renderAt('/m1/multi/sweep')
    await screen.findByText('≥ 8', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /條碼解碼/ }))
    expect(await screen.findAllByText('首次失敗於 45', {}, WAIT)).toHaveLength(2)
    expect(screen.getByText('+38%')).toBeInTheDocument()
    // 誤讀另計，不算成功；品質門檻對照以樣本數顯示
    expect(
      screen.getByText('誤讀・逐步升級', { selector: 'div' }).nextElementSibling,
    ).toHaveTextContent('13%')
    expect(screen.getByText('誤報').nextElementSibling).toHaveTextContent('7 / 1')
    expect(screen.getByText(/APP 即時掃描不經此流程/)).toBeInTheDocument()
    const last = bodies('/workbench/v1/dev/sweeps').at(-1) as {
      target: string
      params: Record<string, unknown>
    }
    expect(last.target).toBe('barcode')
    expect(last.params).toMatchObject({ axis: 'rotate_deg', lo: 0, hi: 45, samples: 5 })
    expect(screen.getByRole('heading', { name: '合成樣本' })).toBeInTheDocument()
  })

  it('下限不小於上限時顯示中文錯誤且不送出請求', async () => {
    const user = userEvent.setup()
    renderAt('/m1/multi/sweep')
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
    renderAt('/m1/multi/sweep')
    await screen.findByText('≥ 8', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /條碼解碼/ }))
    await screen.findAllByText('首次失敗於 45', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /成功階/ }))
    const legend = screen.getByRole('img', { name: /逐步升級讀對於哪一階/ }).nextElementSibling
    expect(legend?.textContent).toMatch(/原圖.*校正/)
    await user.click(screen.getByRole('button', { name: /匯入／匯出設定/ }))
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

describe('多張測試・參數掃描：條碼的品質門檻對照', () => {
  it('品質門檻檢視疊出成功率與不通過率，門檻覆寫隨條碼掃描送出；明細顯示真值與誤讀', async () => {
    const user = userEvent.setup()
    renderAt('/m1/multi/sweep')
    await screen.findByText('≥ 8', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /條碼解碼/ }))
    await screen.findAllByText('首次失敗於 45', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /品質門檻/ }))
    expect(screen.getByRole('img', { name: /逐步升級成功率與品質不通過率/ })).toBeInTheDocument()
    expect(screen.getByText('過亮').nextElementSibling).toHaveTextContent('≥ 0')
    // 條碼模式的參數段也有品質門檻，改了會隨條碼掃描送出
    await user.click(screen.getByRole('button', { name: /階梯參數/ }))
    expect(screen.getByText('品質門檻（對照用）')).toBeInTheDocument()
    const input = screen.getByLabelText('過亮比例上限', { selector: 'input' })
    await user.clear(input)
    await user.type(input, '0.9')
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/sweeps').at(-1)).toMatchObject({
        target: 'barcode',
        params: { config: { bright_ratio_max: 0.9 } },
      }),
    )
    await user.click(screen.getByRole('radio', { name: /明細/ }))
    const row = within(screen.getByRole('table', { name: '每個等級與樣本的解碼結果' }))
      .getByText('4710088410108')
      .closest('tr')!
    expect(row).toHaveTextContent('誤讀')
    expect(row).toHaveTextContent('4710088410115')
  })
})

describe('多張測試・參數掃描：營養標示', () => {
  it('預設改用透視強度，送出容許誤差與標示參數；顯示偏移、四角誤差與明細', async () => {
    const user = userEvent.setup()
    renderAt('/m1/multi/sweep')
    await screen.findByText('≥ 8', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /營養標示/ }))
    expect(await screen.findByText('首次失敗於 0.3', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('偏移', { selector: 'div' }).nextElementSibling).toHaveTextContent(
      '13%',
    )
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/sweeps').at(-1)).toMatchObject({
        target: 'label',
        params: { axis: 'perspective', lo: 0, hi: 0.3, samples: 5, seed: 0, tol: 0.03 },
      }),
    )
    expect(
      (bodies('/workbench/v1/dev/sweeps').at(-1) as { params: object }).params,
    ).not.toHaveProperty('module_px')
    // 容許誤差與標示參數隨請求送出
    const tol = screen.getByLabelText('容許誤差')
    await user.clear(tol)
    await user.type(tol, '0.05')
    await user.tab()
    await user.click(screen.getByRole('button', { name: /標示參數/ }))
    const glare = screen.getByLabelText('光斑比例上限', { selector: 'input' })
    await user.clear(glare)
    await user.type(glare, '0.2')
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/sweeps').at(-1)).toMatchObject({
        params: { tol: 0.05, label: { glare_max_ratio: 0.2 } },
      }),
    )
    await user.click(screen.getByRole('radio', { name: /四角誤差/ }))
    expect(screen.getByRole('img', { name: /四角誤差中位數隨透視強度變化/ })).toBeInTheDocument()
    expect(screen.getByText('容許誤差 = 3%')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /品質門檻/ }))
    expect(screen.getByRole('img', { name: /定位成功率與品質不通過率/ })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /明細/ }))
    const row = within(screen.getByRole('table', { name: '每個等級與樣本的定位結果' }))
      .getByText('偏移')
      .closest('tr')!
    expect(row).toHaveTextContent('12.5%')
    expect(row).toHaveTextContent('直線法')
  })
})

describe('多張測試・資料夾批次', () => {
  it('逐張顯示結果與彙整，點選列檢視單張', async () => {
    const user = userEvent.setup()
    renderAt('/m1/multi/folder')
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
    renderAt('/m1/multi/folder')
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
    renderAt('/m1/multi/folder')
    await user.type(await screen.findByRole('textbox', { name: '資料夾' }), 'D:/data/splits/test')
    await user.click(screen.getByRole('button', { name: '執行' }))
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('測試集已鎖定')
  })
})

describe('實驗結果・E1', () => {
  it('顯示整體成功率、誤讀提醒、分組熱度圖與失敗影像', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/e1')
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
    renderAt('/m1/results/e1')
    await screen.findByRole('img', { name: /整體成功率長條圖/ }, WAIT)
    await user.click(screen.getByRole('button', { name: /快速執行/ }))
    // 預設選取 a0_raw、a6_full
    const a0 = screen.getByRole('checkbox', { name: 'a0_raw' })
    expect(a0).toBeChecked()
    // 每個實驗組附上設定檔的說明
    expect(a0).toHaveAccessibleDescription('消融：原圖')
    expect(screen.getByRole('checkbox', { name: 'm1_agree2' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: '執行' }))
    expect(await screen.findByText('完成，已切換到新的執行結果。', {}, WAIT)).toBeInTheDocument()
    expect(bodies('/workbench/v1/dev/e1/runs')).toContainEqual({
      arms: ['a0_raw', 'a6_full'],
      n_codes: 2,
    })

    await user.click(screen.getByRole('checkbox', { name: 'm1_agree2' }))
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

describe('實驗結果・E1的邊界情況', () => {
  it('剛輸入資料夾就按快速執行時，帶的是輸入框目前的資料夾', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/e1')
    await screen.findByRole('img', { name: /整體成功率長條圖/ }, WAIT)
    await user.type(screen.getByLabelText('結果資料夾'), 'D:/new-runs')
    // 不等 400 ms 防抖，立刻切到快速執行並按下
    await user.click(screen.getByRole('button', { name: /快速執行/ }))
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
    renderAt('/m1/multi/sweep')
    await screen.findByText('模糊下限（下限）= 100', {}, WAIT)
    await user.click(screen.getByRole('button', { name: /品質門檻/ }))
    const input = screen.getByLabelText('模糊下限', { selector: 'input' })
    await user.clear(input)
    await user.type(input, '1500')
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('參數不合法')
    // 曲線仍是 blur_min=100 算的，門檻線不能跟著變成 1500
    expect(screen.getByText('模糊下限（下限）= 100')).toBeInTheDocument()
    expect(screen.queryByText('模糊下限（下限）= 1500')).not.toBeInTheDocument()
  })
})

describe('實驗結果・自適應策略', () => {
  it('顯示與基準的比較、規則、嘗試順序、量測值分組與各影像', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/adaptive')
    expect(await screen.findByRole('img', { name: /成功率長條圖/ }, WAIT)).toBeInTheDocument()
    // 讀數欄：平均耗時與基準
    expect(screen.getByText('基準 12.5 ms')).toBeInTheDocument()
    expect(screen.getByText(/基準（貪婪）：原圖 → 多尺度 ×2/)).toBeInTheDocument()
    const timing = screen.getByRole('table', { name: '基準與策略的耗時' })
    expect(within(timing).getByText('15.3')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /規則/ }))
    const rules = screen.getByRole('table', { name: '規則與成立比例' })
    expect(within(rules).getByText('對比 < 90')).toBeInTheDocument()
    expect(within(rules).getByText('CLAHE → 疊加：CLAHE＋自適應二值化')).toBeInTheDocument()

    // 切換到調整後的策略：門檻改變
    await user.selectOptions(screen.getByRole('combobox', { name: '策略' }), 'r0_default_tuned')
    await user.click(screen.getByRole('radio', { name: /規則/ }))
    expect(screen.getByText('對比 < 52')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /嘗試順序/ }))
    expect(screen.getByText('原圖 → CLAHE → 疊加：CLAHE＋自適應二值化')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /量測值分組/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: '量測值' }), 'contrast')
    expect(screen.getByRole('img', { name: /對比 各組的成功率熱度圖/ })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /各影像/ }))
    const variants = screen.getByRole('table', { name: '各影像在策略下的結果' })
    expect(within(variants).getByText('v-low')).toBeInTheDocument()
    expect(within(variants).getByText('誤讀')).toBeInTheDocument()
  })

  it('策略無法計算時顯示原因；沒有量測值時顯示要執行的指令', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/adaptive')
    await screen.findByRole('img', { name: /成功率長條圖/ }, WAIT)
    await user.selectOptions(screen.getByRole('combobox', { name: '策略' }), 'r9_bad')
    expect(screen.getByRole('alert')).toHaveTextContent('沒有方法 nope 的結果')

    await user.selectOptions(screen.getByRole('combobox', { name: '執行' }), '20261102-raw')
    expect(
      await screen.findByText(/adaptive\.py D:\/runs\/20261103-methods/, {}, WAIT),
    ).toBeInTheDocument()
    expect(screen.getByText('這次執行還沒有品質量測值，請在專案根目錄執行：')).toBeInTheDocument()
  })
})

describe('合併後的頁面：模式切換與共用設定', () => {
  it('舊網址導向合併後的頁面與模式', async () => {
    renderAt('/m1/batch')
    expect(await screen.findByRole('textbox', { name: '資料夾' }, WAIT)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /資料夾批次/ })).toHaveAttribute('data-state', 'on')
  })

  it('品質門檻在參數掃描與資料夾批次間共用；切回掃描時保留評估對象', async () => {
    const user = userEvent.setup()
    renderAt('/m1/multi/sweep')
    await screen.findByText('≥ 8', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /條碼解碼/ }))
    await screen.findAllByText('首次失敗於 45', {}, WAIT)
    await user.click(screen.getByRole('button', { name: /階梯參數/ }))
    const input = screen.getByLabelText('過亮比例上限', { selector: 'input' })
    await user.clear(input)
    await user.type(input, '0.9')

    await user.click(screen.getByRole('radio', { name: /資料夾批次/ }))
    // 資料夾批次的品質門檻段顯示同一組覆寫，執行時隨請求送出
    expect(
      await screen.findByRole('button', { name: /品質門檻.*已改 1 項/ }, WAIT),
    ).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '資料夾' }), 'D:/photos')
    await user.click(screen.getByRole('button', { name: '執行' }))
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/batches')).toContainEqual(
        expect.objectContaining({ folder: 'D:/photos', config: { bright_ratio_max: 0.9 } }),
      ),
    )

    // 切回參數掃描：評估對象仍是條碼解碼，結果不必重算
    await user.click(screen.getByRole('radio', { name: /參數掃描/ }))
    expect(screen.getByRole('radio', { name: /條碼解碼/ })).toHaveAttribute('data-state', 'on')
    expect(screen.getAllByText('首次失敗於 45')).toHaveLength(2)
  })

  it('結果資料夾在 E1 消融與自適應策略間共用', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/e1')
    await screen.findByRole('img', { name: /整體成功率長條圖/ }, WAIT)
    await user.type(screen.getByLabelText('結果資料夾'), 'D:/runs')
    await user.click(screen.getByRole('radio', { name: /自適應策略/ }))
    expect(await screen.findByRole('textbox', { name: '結果資料夾' }, WAIT)).toHaveValue('D:/runs')
  })
})
