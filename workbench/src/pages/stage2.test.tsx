// 單張檢視的條碼與發票 QR、營養標示、食物照片任務，以及任務間共用的影像（後端為 src/test/server.ts 的假實作）。
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

describe('條碼頁', () => {
  it('顯示成功的階、條碼內容與只用原圖的對照', async () => {
    renderAt('/m1/inspect/barcode')
    expect(await screen.findByText('解碼成功', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('灰階')).toBeInTheDocument() // 成功於 gray
    expect(screen.getByText('第 2 次')).toBeInTheDocument()
    expect(screen.getAllByText('4710088410108').length).toBeGreaterThan(0)
    expect(await screen.findByText(/只用原圖：失敗/, {}, WAIT)).toBeInTheDocument()
    // 對照組只嘗試 raw
    expect(bodies('/workbench/v1/dev/barcode')).toContainEqual(
      expect.objectContaining({ ladder: { rungs: ['raw'] } }),
    )
  })

  it('調整嘗試順序時送出 rungs 覆寫', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/barcode')
    await screen.findByText('解碼成功', {}, WAIT)
    await user.click(screen.getByRole('button', { name: /商品條碼參數/ }))
    await user.click(screen.getByRole('button', { name: '灰階往前' }))
    // 主查詢（不含只用原圖的對照組）帶上新的順序
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/barcode')).toContainEqual(
        expect.objectContaining({ ladder: { rungs: ['gray', 'raw', 'binarize'] } }),
      ),
    )
    // 匯出入：Python 建構式含序列欄位
    await user.click(screen.getByRole('button', { name: /匯入／匯出設定/ }))
    expect(screen.getByText("LadderConfig(rungs=('gray', 'raw', 'binarize'))")).toBeInTheDocument()
    // 還原後回到預設順序（不帶 rungs 覆寫）；兩段可同時展開
    await user.click(screen.getByRole('button', { name: /還原順序、倍率與格式/ }))
    expect(screen.getByText('LadderConfig()')).toBeInTheDocument()
  })

  it('多尺度倍率至少保留一個', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/barcode')
    await screen.findByText('解碼成功', {}, WAIT)
    await user.click(screen.getByRole('button', { name: /商品條碼參數/ }))
    // 預設倍率為 ×2、×0.5；取消 ×2 後只剩 ×0.5，不能再取消
    await user.click(screen.getByRole('button', { name: /^×2/ }))
    const last = screen.getByRole('button', { name: /^×0\.5/ })
    expect(last).toHaveAttribute('aria-pressed', 'true')
    expect(last).toBeDisabled()
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/barcode')).toContainEqual(
        expect.objectContaining({ ladder: { scales: [0.5] } }),
      ),
    )
  })

  it('電子發票模式顯示左右碼與原始位元組', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/barcode')
    await screen.findByText('解碼成功', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /發票 QR/ }))
    expect(await screen.findByText('結果不完整', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('只找到一個發票 QR')).toBeInTheDocument()
    expect(screen.getByText('4 bytes')).toBeInTheDocument()
    expect(screen.getByText('未找到')).toBeInTheDocument()
    // 合成來源改為發票場景
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/images/synthesize')).toContainEqual(
        expect.objectContaining({ scene: 'invoice' }),
      ),
    )
    await user.click(screen.getByRole('radio', { name: /位元組/ }))
    expect(screen.getByText('41 42 31 32')).toBeInTheDocument()
  })

  it('各階影像依選擇的嘗試請求', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/barcode')
    await screen.findByText('解碼成功', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /各階影像/ }))
    expect(await screen.findByAltText('送進解碼器的影像版本', {}, WAIT)).toBeInTheDocument()
    // 預設顯示成功的那一次（index 1）
    expect(bodies('/workbench/v1/dev/views')).toEqual([
      expect.objectContaining({ view: 'ladder_variant', config: { ladder: {}, index: 1 } }),
    ])
  })
})

describe('影像與結果配對（條碼、食物）', () => {
  it('條碼：換圖後只用原圖的對照尚未回來時顯示「…」，不沿用舊影像的結果', async () => {
    const { http, delay } = await import('msw')
    const { server } = await import('@/test/server')
    server.use(
      http.post('*/workbench/v1/dev/barcode', async ({ request }) => {
        const body = (await request.clone().json()) as {
          image_id: string
          ladder?: { rungs?: string[] }
        }
        // 新影像的對照組一直不回來
        if (body.image_id.endsWith('-deg') && body.ladder?.rungs?.length === 1) {
          await delay('infinite')
        }
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderAt('/m1/inspect/barcode')
    expect(await screen.findByText(/只用原圖：失敗/, {}, WAIT)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '加入模糊 σ' }))
    const sigma = screen.getByLabelText('模糊 σ', { selector: 'input' })
    await user.clear(sigma)
    await user.type(sigma, '4')
    expect(await screen.findByText(/只用原圖：…/, {}, WAIT)).toBeInTheDocument()
  })

  it('食物：換圖後盤緣試算尚未回來時，不把舊影像的橢圓疊到新影像', async () => {
    const { http, delay } = await import('msw')
    const { server } = await import('@/test/server')
    server.use(
      http.post('*/workbench/v1/dev/food', async ({ request }) => {
        const body = (await request.clone().json()) as {
          image_id: string
          config?: { enable_plate?: boolean }
        }
        if (body.image_id.includes('seed1') && body.config?.enable_plate) await delay('infinite')
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderAt('/m1/inspect/food')
    await screen.findByText('處理完成', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /盤緣/ }))
    expect(await screen.findByRole('table', { name: '找到的盤緣橢圓' }, WAIT)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('種子'))
    await user.type(screen.getByLabelText('種子'), '1')
    // 新影像的主結果回來後，舊影像的試算橢圓不再顯示
    await waitFor(
      () => expect(screen.queryByRole('table', { name: '找到的盤緣橢圓' })).not.toBeInTheDocument(),
      WAIT,
    )
    expect(
      bodies('/workbench/v1/dev/food').some((b) =>
        (b as { image_id: string }).image_id.includes('seed1'),
      ),
    ).toBe(true)
  })
})

describe('營養標示頁', () => {
  it('與合成真值比較四角誤差', async () => {
    renderAt('/m1/inspect/label')
    expect(await screen.findByText('處理完成', {}, WAIT)).toBeInTheDocument()
    expect(screen.getAllByText('輪廓法').length).toBeGreaterThan(0)
    // 每角偏 (3, 4)，誤差 5 px
    expect(screen.getByText('5.0 px')).toBeInTheDocument()
    expect(screen.getByText('符合驗收（< 10 px）')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: '四角各自的誤差' })
    expect(within(table).getAllByText('5.00')).toHaveLength(4)
  })

  it('新影像的分析失敗時，保留舊影像與舊結果，不混用', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/label')
    await screen.findByText('5.0 px', {}, WAIT)
    await user.clear(screen.getByLabelText('種子'))
    await user.type(screen.getByLabelText('種子'), '1')
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      '伺服器內部錯誤',
    )
    // 舊四角不會拿去和新影像的真值比較（否則誤差約 300 px）
    expect(screen.getByText('5.0 px')).toBeInTheDocument()
    expect(screen.queryByText(/超過驗收/)).not.toBeInTheDocument()
  })

  it('關閉光斑步驟時顯示未啟用', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/label')
    await screen.findByText('處理完成', {}, WAIT)
    await user.click(screen.getByRole('button', { name: /營養標示參數/ }))
    await user.click(screen.getByRole('switch', { name: '光斑處理' }))
    expect(await screen.findByText('未啟用', {}, WAIT)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /光斑遮罩/ }))
    expect(await screen.findByText(/光斑步驟未啟用/, {}, WAIT)).toBeInTheDocument()
  })
})

describe('食物照片頁', () => {
  it('顯示菜數、與真值比較並列出各道菜', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/food')
    expect(await screen.findByText('處理完成', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('+1 相對真值')).toBeInTheDocument()
    expect(screen.getByText('69 KB')).toBeInTheDocument() // (51200 + 10240 + 9216) / 1024
    await user.click(screen.getByRole('radio', { name: /各道菜/ }))
    expect(screen.getByAltText('第 1 道菜')).toBeInTheDocument()
    expect(screen.getByAltText('第 2 道菜')).toBeInTheDocument()
  })

  it('盤緣步驟關閉時仍在檢視中試算', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/food')
    await screen.findByText('處理完成', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /盤緣/ }))
    expect(await screen.findByText(/此處僅試算/, {}, WAIT)).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: '找到的盤緣橢圓' }, WAIT)).toBeInTheDocument()
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/food')).toContainEqual(
        expect.objectContaining({ config: { enable_plate: true } }),
      ),
    )
  })
})

describe('單張檢視：任務間共用影像', () => {
  const degradeBodies = (base: string) =>
    requests.filter((r) => r.path === `/workbench/v1/dev/images/${base}/degrade`).map((r) => r.body)

  it('舊網址導向單張檢視的對應任務', async () => {
    renderAt('/m1/barcode')
    expect(await screen.findByText('解碼成功', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /商品條碼/ })).toHaveAttribute('data-state', 'on')
  })

  it('切換任務時保留模擬退化，合成來源換成該任務的場景', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/quality')
    await screen.findByText('通過品質檢查', {}, WAIT)
    await user.click(screen.getByRole('button', { name: '加入模糊 σ' }))
    await waitFor(() =>
      expect(degradeBodies('base-label')).toContainEqual({ degradation: { blur_sigma: 2 } }),
    )
    await user.click(screen.getByRole('radio', { name: /商品條碼/ }))
    expect(await screen.findByText('解碼成功', {}, WAIT)).toBeInTheDocument()
    // 條碼場景的影像也套用同一組退化；面板上仍列著模糊
    expect(degradeBodies('base-ean13')).toContainEqual({ degradation: { blur_sigma: 2 } })
    expect(screen.getByRole('button', { name: '移除模糊 σ' })).toBeInTheDocument()
    // 條碼任務不會拿標示場景的影像去解碼
    expect(
      bodies('/workbench/v1/dev/barcode').every(
        (b) => !(b as { image_id: string }).image_id.includes('label'),
      ),
    ).toBe(true)
  })

  it('切回任務時還原該場景改過的合成參數與處理參數', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/label')
    await screen.findByText('處理完成', {}, WAIT)
    await user.clear(screen.getByLabelText('種子'))
    await user.type(screen.getByLabelText('種子'), '2')
    await user.click(screen.getByRole('button', { name: /營養標示參數/ }))
    await user.click(screen.getByRole('switch', { name: '光斑處理' }))
    await user.click(screen.getByRole('radio', { name: /食物照片/ }))
    await screen.findByText('菜數', {}, WAIT)
    await user.click(screen.getByRole('radio', { name: /營養標示/ }))
    expect(await screen.findByText('定位方法', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByLabelText('種子')).toHaveValue(2)
    expect(screen.getByText('已改 1 項')).toBeInTheDocument()
  })

  it('常見情境一次套用一組退化，移除時連同依附欄位', async () => {
    const user = userEvent.setup()
    renderAt('/m1/inspect/quality')
    await screen.findByText('通過品質檢查', {}, WAIT)
    await user.selectOptions(screen.getByRole('combobox', { name: '常見情境' }), '手震')
    await waitFor(() =>
      expect(degradeBodies('base-label')).toContainEqual({
        degradation: { motion_len: 20, motion_angle: 30 },
      }),
    )
    expect(screen.getByLabelText('手震方向', { selector: 'input' })).toHaveValue(30)
    await user.click(screen.getByRole('button', { name: '移除手震長度' }))
    expect(screen.queryByLabelText('手震方向', { selector: 'input' })).not.toBeInTheDocument()
    expect(screen.getByText(/目前是原圖/)).toBeInTheDocument()
  })
})
