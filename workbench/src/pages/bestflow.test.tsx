// 模組一・找最佳流程（後端為 src/test/server.ts 的假實作，執行以 SSE 回應）。
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderAt } from '@/test/render'
import { requests, resetBestFlow } from '@/test/server'

const WAIT = { timeout: 3000 }

beforeEach(() => {
  requests.length = 0
  resetBestFlow()
})

const bodies = (path: string) => requests.filter((r) => r.path === path).map((r) => r.body)

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

  it('沒有執行時顯示三個步驟；上傳圖片後逐張上傳再執行，完成後顯示結果', async () => {
    resetBestFlow(false)
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    expect(await screen.findByText('確認真值', {}, WAIT)).toBeInTheDocument()
    const files = [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]
    await user.upload(screen.getByLabelText('選擇圖片'), files)
    expect(screen.getByText('已選 2 張，重新選擇')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '開始比較' }))
    // 完成後切換到新的執行
    expect(await screen.findByRole('list', { name: '推薦流程' }, WAIT)).toBeInTheDocument()
    expect(bodies('/workbench/v1/dev/images')).toEqual([1, 2])
    expect(bodies('/workbench/v1/dev/best-flow/runs')).toContainEqual({
      image_ids: ['upload-1', 'upload-2'],
    })
  })

  it('資料夾來源送出路徑；測試集被拒絕時顯示錯誤', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await screen.findByRole('img', { name: /三種做法的成功率/ }, WAIT)
    await user.click(screen.getByRole('radio', { name: /資料夾/ }))
    await user.type(screen.getByRole('textbox', { name: '圖片資料夾' }), 'D:/data/splits/test')
    await user.click(screen.getByRole('button', { name: '開始比較' }))
    expect(await screen.findByText('測試集已鎖定，不得讀取', {}, WAIT)).toBeInTheDocument()
    expect(bodies('/workbench/v1/dev/best-flow/runs')).toContainEqual({
      folder: 'D:/data/splits/test',
      recursive: true,
    })
  })

  it('結論：推薦流程、每一步的貢獻、比較與匯出', async () => {
    renderAt('/m1/results/best')
    const flow = await screen.findByRole('list', { name: '推薦流程' }, WAIT)
    expect(within(flow).getAllByRole('listitem')).toHaveLength(3)
    expect(within(flow).getByText(/疊加/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '推薦流程每一步的貢獻' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '三種做法的比較' })).toHaveTextContent(
      '全部方法依序都試',
    )
    expect(screen.getByText(/"rungs"/)).toBeInTheDocument()
    // 有未定的圖片：提醒成功率會偏高
    expect(screen.getByRole('alert')).toHaveTextContent('有 2 張圖片尚未確認真值')
  })

  it('真值確認：選候選、輸入號碼、標為沒有條碼、取消人工確認', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await screen.findByRole('list', { name: '推薦流程' }, WAIT)
    await user.click(screen.getByRole('radio', { name: /真值確認（2）/ }))
    const list = screen.getByRole('list', { name: '真值確認' })
    // 預設只列未確定的 b、c
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('img', { name: 'b.jpg' })).toHaveAttribute(
      'src',
      expect.stringContaining('thumb-b.jpg'),
    )
    await user.click(within(list).getByRole('button', { name: /4712612300015/ }))
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/best-flow/runs/20261105-bestflow/truth')).toContainEqual({
        truths: { 'b.jpg': '4712612300015' },
      }),
    )
    // b 已確定，未確定只剩 c
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1), WAIT)
    await user.type(screen.getByLabelText('c.jpg 的條碼'), '4710088410108')
    await user.click(screen.getByRole('button', { name: '採用' }))
    expect(await screen.findByText(/所有圖片都已確定真值/, {}, WAIT)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /全部（3）/ }))
    const rowC = screen.getByText('c.jpg').closest('li')!
    expect(within(rowC).getByText(/採用 4710088410108（人工）/)).toBeInTheDocument()
    await user.click(within(rowC).getByRole('button', { name: '沒有條碼' }))
    expect(await within(rowC).findByText(/沒有條碼（人工）/, {}, WAIT)).toBeInTheDocument()
    await user.click(within(rowC).getByRole('button', { name: /取消人工確認/ }))
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/best-flow/runs/20261105-bestflow/truth')).toContainEqual({
        truths: { 'c.jpg': null },
      }),
    )
  })

  it('改選擇準則時以查詢參數重新取得結果', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await screen.findByRole('list', { name: '推薦流程' }, WAIT)
    const input = screen.getByLabelText('平均耗時上限（0 為不限）')
    await user.clear(input)
    await user.type(input, '20')
    await user.tab()
    await waitFor(() =>
      expect(bodies('/workbench/v1/dev/best-flow/runs/20261105-bestflow')).toContain(
        '?max_mean_ms=20',
      ),
    )
  })

  it('單一方法：依成功率排序並顯示相對原圖的救回', async () => {
    const user = userEvent.setup()
    renderAt('/m1/results/best')
    await screen.findByRole('list', { name: '推薦流程' }, WAIT)
    await user.click(screen.getByRole('radio', { name: /單一方法/ }))
    const rows = within(screen.getByRole('table', { name: '單一方法比較' })).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Otsu')
    expect(rows[2]).toHaveTextContent('基準')
  })
})
