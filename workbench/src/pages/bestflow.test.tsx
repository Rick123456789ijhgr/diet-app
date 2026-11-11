// 模組一・找最佳流程（後端為 src/test/server.ts 的假實作，執行以 SSE 回應）。
// 四個步驟一次顯示一個畫面：選擇圖片 → 確認真值 → 比較方法 → 結論。
import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderAt } from '@/test/render'
import { requests, resetBestFlow, server } from '@/test/server'

import { useItems } from './results/bestflow/items'

const WAIT = { timeout: 3000 }

beforeEach(() => {
  requests.length = 0
  resetBestFlow()
})

const bodies = (path: string) => requests.filter((r) => r.path === path).map((r) => r.body)
const RUN = '/workbench/v1/dev/best-flow/runs'
const TRUTH = '/workbench/v1/dev/best-flow/runs/20261105-bestflow/truth'

/** 從選擇圖片的畫面打開最近一次執行的結論。 */
async function openLatest(user: ReturnType<typeof userEvent.setup>) {
  renderAt('/m1/results/best')
  await user.click(await screen.findByRole('button', { name: '查看結論' }, WAIT))
  return screen.findByRole('list', { name: '推薦流程' }, WAIT)
}

const CODE = '4710088410108'
const jpg = (name: string) => new File([name], name, { type: 'image/jpeg' })

/** 上傳圖片並走到「確認真值」。 */
async function toTruthStep(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  resetBestFlow(false)
  renderAt('/m1/results/best')
  await user.upload(await screen.findByLabelText('選擇圖片', {}, WAIT), names.map(jpg))
  await user.click(screen.getByRole('button', { name: /下一步：逐張確認真值/ }))
  return screen.findByLabelText('條碼號碼', {}, WAIT)
}

/** 點選「程式讀到」的候選號碼填入輸入框（焦點回到輸入框，之後按 Enter 確認）。 */
async function pickRead(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: CODE }, WAIT))
  expect(screen.getByLabelText('條碼號碼')).toHaveValue(CODE)
  expect(screen.getByLabelText('條碼號碼')).toHaveFocus()
}

describe('找最佳流程', () => {
  it('實驗結果預設為找最佳流程；進階收著 E1 消融與自適應策略', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results')
    expect(await screen.findByRole('heading', { name: '找最佳流程' }, WAIT)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /E1 消融/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /進階/ }))
    expect(await screen.findByRole('radio', { name: /E1 消融/ }, WAIT)).toHaveAttribute(
      'data-state',
      'on',
    )
    await user.click(screen.getByRole('radio', { name: /自適應策略/ }))
    await user.click(screen.getByRole('radio', { name: /找最佳流程/ }))
    await user.click(screen.getByRole('radio', { name: /進階/ }))
    // 回到進階時停在上次看的種類
    expect(screen.getByRole('radio', { name: /自適應策略/ })).toHaveAttribute('data-state', 'on')
  })

  it('步驟列：一開始在選擇圖片，還沒選圖時不能往下', async () => {
    resetBestFlow(false)
    renderAt('/m1/results/best')
    const steps = await screen.findByRole('list', { name: '步驟' }, WAIT)
    expect(within(steps).getByRole('button', { name: /選擇圖片/ })).toHaveAttribute(
      'aria-current',
      'step',
    )
    expect(within(steps).getByRole('button', { name: /確認真值/ })).toBeDisabled()
    expect(within(steps).getByRole('button', { name: /結論/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /下一步：逐張確認真值/ })).toBeDisabled()
    // 沒有過去的執行時不顯示「查看結論」
    expect(screen.queryByRole('button', { name: '查看結論' })).not.toBeInTheDocument()
  })

  it('上傳 → 逐張確認（點選程式讀到的號碼、沒有條碼）→ 執行後送出真值 → 結論', async () => {
    resetBestFlow(false)
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await user.upload(await screen.findByLabelText('選擇圖片', {}, WAIT), [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ])
    expect(screen.getByRole('heading', { name: '已選 2 張' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /下一步：逐張確認真值/ }))

    // 第 1 張：程式從原圖讀到的號碼只列為候選，不預先帶入；點選後 Enter 確認並換下一張
    const input = await screen.findByLabelText('條碼號碼', {}, WAIT)
    await screen.findByRole('button', { name: CODE }, WAIT)
    expect(input).toHaveValue('')
    expect(screen.getByRole('button', { name: /確認，下一張/ })).toBeDisabled()
    await pickRead(user)
    expect(screen.getByText('EAN-13 檢查碼正確')).toBeInTheDocument()
    expect(screen.getByText(/程式讀到的，請對照圖片/)).toBeInTheDocument()
    await user.keyboard('{Enter}')

    // 第 2 張：標為沒有條碼
    expect(await screen.findByText(/^第 2 張/, {}, WAIT)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '沒有條碼' }))
    const strip = screen.getByRole('list', { name: '所有圖片' })
    expect(within(strip).getByRole('button', { name: /a\.jpg：4710088410108/ })).toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: /b\.jpg：沒有條碼/ })).toBeInTheDocument()
    expect(screen.getByText(/已確認/)).toHaveTextContent('已確認 2／2 張')

    await user.click(screen.getByRole('button', { name: '開始比較' }))
    expect(await screen.findByRole('list', { name: '推薦流程' }, WAIT)).toBeInTheDocument()
    // 每張只上傳一次（確認時讀條碼用），執行沿用同一個 image_id；真值以原檔名為 ID 送出
    expect(bodies('/workbench/v1/dev/images')).toEqual([1, 2])
    const run = bodies(RUN)[0] as { image_ids: string[] }
    expect([...run.image_ids].sort()).toEqual(['upload-1', 'upload-2'])
    expect(bodies(TRUTH)).toContainEqual({ truths: { 'a.jpg': '4710088410108', 'b.jpg': '' } })
    expect(
      within(screen.getByRole('list', { name: '步驟' })).getByRole('button', { name: /結論/ }),
    ).toHaveAttribute('aria-current', 'step')
  })

  it('同名的圖片以 #2 的 ID 送出真值；沒確認的不送', async () => {
    resetBestFlow(false)
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await user.upload(await screen.findByLabelText('選擇圖片', {}, WAIT), [
      new File(['a'], 'x.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'x.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'y.jpg', { type: 'image/jpeg' }),
    ])
    await user.click(screen.getByRole('button', { name: /下一步/ }))
    await pickRead(user)
    await user.keyboard('{Enter}')
    await screen.findByText(/^第 2 張/, {}, WAIT)
    await user.click(screen.getByRole('button', { name: '沒有條碼' }))
    await user.click(screen.getByRole('button', { name: '開始比較' }))
    await screen.findByRole('list', { name: '推薦流程' }, WAIT)
    expect(bodies(TRUTH)).toContainEqual({ truths: { 'x.jpg': '4710088410108', 'x.jpg#2': '' } })
  })

  it('把原始照片改名（彈窗）：產生 Python 工具的指令', async () => {
    const user = userEvent.setup()
    await openLatest(user)
    await user.click(screen.getByRole('button', { name: '把原始照片改名' }))
    const dialog = await screen.findByRole('dialog', { name: '把原始照片改名' }, WAIT)
    expect(within(dialog).getByText(/只改人工確認過的 0 張/)).toBeInTheDocument()
    expect(within(dialog).getAllByText(/<照片所在的資料夾>/)).toHaveLength(2)
    await user.type(within(dialog).getByLabelText('照片所在的資料夾'), 'D:/photos')
    const [preview, apply] = within(dialog).getAllByText(/rename_by_truth\.py/)
    expect(preview).toHaveTextContent(
      String.raw`research\experiments\e1_barcode\rename_by_truth.py "D:/runs/20261105-bestflow" --folder "D:/photos"`,
    )
    expect(apply!.textContent).toMatch(/--folder "D:\/photos" --apply$/)
  })

  it('檔名就是條碼時預先帶入，可一次採用', async () => {
    resetBestFlow(false)
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await user.upload(await screen.findByLabelText('選擇圖片', {}, WAIT), [
      new File(['a'], 'IMG_1.jpg', { type: 'image/jpeg' }),
      new File(['b'], '4712612300015_2.jpg', { type: 'image/jpeg' }),
    ])
    expect(screen.getByText(/其中 1 張的檔名就是條碼號碼/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /下一步/ }))
    await user.click(await screen.findByRole('button', { name: /採用檔名中的號碼（1 張）/ }, WAIT))
    expect(
      screen.getByRole('button', { name: /4712612300015_2\.jpg：4712612300015/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /採用檔名中的號碼/ })).not.toBeInTheDocument()
  })

  it('輸入錯誤的號碼時提示，不能確認', async () => {
    resetBestFlow(false)
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await user.upload(await screen.findByLabelText('選擇圖片', {}, WAIT), [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
    ])
    await user.click(screen.getByRole('button', { name: /下一步/ }))
    const input = await screen.findByLabelText('條碼號碼', {}, WAIT)
    await user.type(input, '4710088410109')
    expect(screen.getByText('檢查碼不對，請再核對一次')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /確認，下一張/ })).toBeDisabled()
    // 回上一步再回來，選的圖片還在
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByRole('heading', { name: '已選 1 張' })).toBeInTheDocument()
  })

  it('資料夾來源略過確認真值，直接執行；測試集被拒絕時顯示錯誤', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await user.click(await screen.findByRole('radio', { name: /伺服器上的資料夾/ }, WAIT))
    await user.type(screen.getByRole('textbox', { name: '圖片資料夾' }), 'D:/data/splits/test')
    await user.click(screen.getByRole('button', { name: '開始比較' }))
    expect(await screen.findByText('測試集已鎖定，不得讀取', {}, WAIT)).toBeInTheDocument()
    expect(bodies(RUN)).toContainEqual({ folder: 'D:/data/splits/test', recursive: true })
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByRole('textbox', { name: '圖片資料夾' })).toHaveValue('D:/data/splits/test')
  })

  it('過去的執行（彈窗）：打開某次執行的結論', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await user.click(await screen.findByRole('button', { name: '過去的執行' }, WAIT))
    const dialog = await screen.findByRole('dialog', { name: '過去的執行' }, WAIT)
    await user.click(within(dialog).getByRole('button', { name: /20261105-bestflow/ }))
    expect(await screen.findByRole('list', { name: '推薦流程' }, WAIT)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('結論：推薦流程、比較、展開細節與匯出（彈窗）', async () => {
    const user = userEvent.setup()
    const flow = await openLatest(user)
    expect(within(flow).getAllByRole('listitem')).toHaveLength(3)
    expect(within(flow).getByText(/疊加/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /三種做法的成功率/ })).toBeInTheDocument()
    await user.click(screen.getByText('每一步的貢獻'))
    expect(screen.getByRole('table', { name: '推薦流程每一步的貢獻' })).toBeVisible()
    await user.click(screen.getByText('三種做法的詳細數字'))
    expect(screen.getByRole('table', { name: '三種做法的比較' })).toHaveTextContent(
      '全部方法依序都試',
    )
    // 有未定的圖片：提醒成功率會偏高
    expect(screen.getByRole('alert')).toHaveTextContent('有 2 張圖片尚未確認真值')
    await user.click(screen.getByRole('button', { name: '匯出推薦流程' }))
    const dialog = await screen.findByRole('dialog', { name: '匯出推薦流程' }, WAIT)
    expect(within(dialog).getByText(/"rungs"/)).toBeInTheDocument()
  })

  it('結論的真值分頁：選候選、輸入號碼、標為沒有條碼、取消人工確認', async () => {
    const user = userEvent.setup()
    await openLatest(user)
    await user.click(screen.getByRole('radio', { name: /真值（2 待確認）/ }))
    const list = screen.getByRole('list', { name: '真值確認' })
    // 預設只列未確定的 b、c
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('img', { name: 'b.jpg' })).toHaveAttribute(
      'src',
      expect.stringContaining('thumb-b.jpg'),
    )
    await user.click(within(list).getByRole('button', { name: /4712612300015/ }))
    await waitFor(() =>
      expect(bodies(TRUTH)).toContainEqual({ truths: { 'b.jpg': '4712612300015' } }),
    )
    // b 已確定，未確定只剩 c
    await waitFor(
      () =>
        expect(
          within(screen.getByRole('list', { name: '真值確認' })).getAllByRole('listitem'),
        ).toHaveLength(1),
      WAIT,
    )
    await user.type(screen.getByLabelText('c.jpg 的條碼'), '4710088410108')
    await user.click(screen.getByRole('button', { name: '採用' }))
    expect(await screen.findByText(/所有圖片都已確定真值/, {}, WAIT)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /全部（3）/ }))
    const rowC = screen.getByText('c.jpg').closest('li')!
    expect(within(rowC).getByText(/採用 4710088410108（人工）/)).toBeInTheDocument()
    await user.click(within(rowC).getByRole('button', { name: '沒有條碼' }))
    expect(await within(rowC).findByText(/沒有條碼（人工）/, {}, WAIT)).toBeInTheDocument()
    await user.click(within(rowC).getByRole('button', { name: /取消人工確認/ }))
    await waitFor(() => expect(bodies(TRUTH)).toContainEqual({ truths: { 'c.jpg': null } }))
  })

  it('選擇準則（彈窗）：改了以查詢參數重新取得結果', async () => {
    const user = userEvent.setup()
    await openLatest(user)
    await user.click(screen.getByRole('button', { name: /選擇準則/ }))
    const dialog = await screen.findByRole('dialog', { name: '選擇準則' }, WAIT)
    const input = within(dialog).getByLabelText('平均耗時上限（0 為不限）')
    await user.clear(input)
    await user.type(input, '20')
    await user.tab()
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/best-flow/runs/20261105-bestflow')).toContain(
        '?max_mean_ms=20',
      ),
    )
    await user.click(within(dialog).getByRole('button', { name: '改回預設' }))
    expect(within(dialog).getByLabelText('平均耗時上限（0 為不限）')).toHaveValue(0)
  })

  it('單一方法：依成功率排序並顯示相對原圖的救回', async () => {
    const user = userEvent.setup()
    await openLatest(user)
    await user.click(screen.getByRole('radio', { name: /單一方法/ }))
    const rows = within(screen.getByRole('table', { name: '單一方法比較' })).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Otsu')
    expect(rows[2]).toHaveTextContent('基準')
  })
})

describe('找最佳流程：真值不遺失、不配錯', () => {
  it('圖片的鍵在重新掛載後不重複（鍵也是讀條碼建議的查詢鍵，重複會拿到上一批圖片的號碼）', () => {
    const first = renderHook(() => useItems())
    act(() => first.result.current.add([jpg('a.jpg'), jpg('b.jpg')]))
    const before = first.result.current.items.map((i) => i.key)
    first.unmount()
    const second = renderHook(() => useItems())
    act(() => second.result.current.add([jpg('c.jpg'), jpg('d.jpg')]))
    const after = second.result.current.items.map((i) => i.key)
    expect(new Set([...before, ...after]).size).toBe(4)
  })

  it('真值寫入失敗：結論頁頂部提醒並可重新送出，成功後提醒消失', async () => {
    const user = userEvent.setup()
    await toTruthStep(user, ['a.jpg'])
    await pickRead(user)
    await user.keyboard('{Enter}')
    server.use(
      http.put(
        '*/workbench/v1/dev/best-flow/runs/:id/truth',
        () => HttpResponse.json({ code: 'INTERNAL', message: '模擬寫入失敗' }, { status: 500 }),
        { once: true },
      ),
    )
    await user.click(screen.getByRole('button', { name: '開始比較' }))
    // 停在「結論」分頁也看得到
    await screen.findByRole('list', { name: '推薦流程' }, WAIT)
    const alert = screen.getByRole('alert', { name: '真值沒有寫入' })
    expect(alert).toHaveTextContent('你確認的 1 張真值沒有寫入')
    expect(alert).toHaveTextContent('模擬寫入失敗')
    expect(bodies(TRUTH)).toEqual([])

    await user.click(within(alert).getByRole('button', { name: '重新送出' }))
    await waitFor(
      () => expect(screen.queryByRole('alert', { name: '真值沒有寫入' })).not.toBeInTheDocument(),
      WAIT,
    )
    expect(bodies(TRUTH)).toEqual([{ truths: { 'a.jpg': CODE } }])
  })

  it('全部移除：有已確認的真值時先確認；取消則保留', async () => {
    const user = userEvent.setup()
    await toTruthStep(user, ['a.jpg', 'b.jpg'])
    await user.click(screen.getByRole('button', { name: '沒有條碼' }))
    await user.click(screen.getByRole('button', { name: '上一步' }))

    await user.click(screen.getByRole('button', { name: '全部移除' }))
    const dialog = await screen.findByRole('dialog', { name: '全部移除？' }, WAIT)
    expect(dialog).toHaveTextContent('已確認的 1 張真值會一起清掉')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('heading', { name: '已選 2 張' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '全部移除' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '全部移除？' }, WAIT)).getByRole('button', {
        name: '確定全部移除',
      }),
    )
    expect(screen.queryByRole('heading', { name: /已選/ })).not.toBeInTheDocument()
  })

  it('全部移除：還沒有確認任何真值時直接移除', async () => {
    resetBestFlow(false)
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await user.upload(await screen.findByLabelText('選擇圖片', {}, WAIT), [jpg('a.jpg')])
    await user.click(screen.getByRole('button', { name: '全部移除' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /已選/ })).not.toBeInTheDocument()
  })

  it('有還沒寫入的真值時，離開實驗結果頁前先問；切到進階不問', async () => {
    const user = userEvent.setup()
    await toTruthStep(user, ['a.jpg'])
    await user.click(screen.getByRole('button', { name: '沒有條碼' }))

    // 切到進階再回來：仍掛載，不問，答案還在
    await user.click(screen.getByRole('radio', { name: /進階/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /找最佳流程/ }))
    expect(screen.getByText(/已確認/)).toHaveTextContent('已確認 1／1 張')

    // 到單張檢視：先問；留在這裡則不離開
    await user.click(screen.getByRole('link', { name: /單張檢視/ }))
    const dialog = await screen.findByRole('dialog', { name: '要離開找最佳流程嗎？' }, WAIT)
    expect(dialog).toHaveTextContent('你確認的真值還沒寫進任何一次執行')
    await user.click(within(dialog).getByRole('button', { name: '留在這裡' }))
    expect(screen.getByText(/已確認/)).toHaveTextContent('已確認 1／1 張')

    // 仍要離開
    await user.click(screen.getByRole('link', { name: /單張檢視/ }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '要離開找最佳流程嗎？' }, WAIT)).getByRole(
        'button',
        { name: '仍要離開' },
      ),
    )
    await waitFor(
      () => expect(screen.queryByRole('heading', { name: '找最佳流程' })).not.toBeInTheDocument(),
      WAIT,
    )
  })

  it('真值已寫進執行後，離開不再詢問', async () => {
    const user = userEvent.setup()
    await toTruthStep(user, ['a.jpg'])
    await user.click(screen.getByRole('button', { name: '沒有條碼' }))
    await user.click(screen.getByRole('button', { name: '開始比較' }))
    await screen.findByRole('list', { name: '推薦流程' }, WAIT)
    await user.click(screen.getByRole('link', { name: /單張檢視/ }))
    await waitFor(
      () => expect(screen.queryByRole('heading', { name: '找最佳流程' })).not.toBeInTheDocument(),
      WAIT,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
