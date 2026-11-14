// 通用工具：按鈕總覽頁、圖片批次命名（後端為 src/test/server.ts 的假資料夾）、架構圖的新網址。
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderAt } from '@/test/render'
import { requests, resetNaming } from '@/test/server'

const WAIT = { timeout: 3000 }
const PREVIEW = '/workbench/v1/dev/image-naming/preview'
const APPLY = '/workbench/v1/dev/image-naming/apply'
const UNDO = '/workbench/v1/dev/image-naming/undo'
const bodies = (path: string) => requests.filter((r) => r.path === path).map((r) => r.body)

beforeEach(() => {
  requests.length = 0
  resetNaming()
})

/** 輸入資料夾並按「預覽」，等到預覽表格出現。 */
async function previewFolder(user: ReturnType<typeof userEvent.setup>, folder = 'D:/photos') {
  renderAt('/tools/naming')
  await user.type(await screen.findByLabelText('資料夾', {}, WAIT), folder)
  await user.click(screen.getByRole('button', { name: '預覽' }))
}

describe('通用工具', () => {
  it('總覽以按鈕列出工具，點了進入專屬頁面', async () => {
    const user = userEvent.setup()
    renderAt('/tools')
    const nav = await screen.findByRole('navigation', { name: '通用工具' }, WAIT)
    expect(within(nav).getByRole('link', { name: /圖片批次命名/ })).toHaveAttribute(
      'href',
      '/tools/naming',
    )
    await user.click(within(nav).getByRole('link', { name: /架構圖/ }))
    expect(await screen.findByRole('heading', { name: '架構圖' }, WAIT)).toBeInTheDocument()
  })

  it('架構圖的舊網址導向 /tools/arch，保留目前的圖', async () => {
    renderAt('/arch/diagram?d=m1')
    expect(await screen.findByRole('heading', { name: '架構圖' }, WAIT)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '編輯' })).toHaveAttribute('href', '/arch/edit?d=m1')
  })
})

describe('圖片批次命名', () => {
  it('預覽列出每個檔案的新檔名，送出的參數含預設值', async () => {
    const user = userEvent.setup()
    await previewFolder(user)
    const table = await screen.findByRole('table', { name: '改名預覽' }, WAIT)
    expect(within(table).getByText('f_a01_001_4710088410108.jpg')).toBeInTheDocument()
    expect(within(table).getByText('f_a01_002_nocode.jpg')).toBeInTheDocument()
    expect(within(table).getByText('檔名看不出條碼')).toBeInTheDocument()
    expect(bodies(PREVIEW)).toEqual([
      {
        folder: 'D:/photos',
        category: 'f',
        batch: 'a01',
        start: 0,
        width: 3,
        order: 'mtime',
        include_unknown: false,
        no_code: 'nocode',
      },
    ])
    // 長度不一致（沒有條碼的檔名較短）時提示
    expect(screen.getByText(/檔名長度不一致/)).toBeInTheDocument()
    // 沒有改名紀錄時不能還原
    expect(screen.getByRole('button', { name: '還原先前的改名' })).toBeDisabled()
  })

  it('類別、起始序號與進階參數都可自訂', async () => {
    const user = userEvent.setup()
    renderAt('/tools/naming')
    await user.type(await screen.findByLabelText('資料夾', {}, WAIT), 'D:/photos')
    await user.click(screen.getByRole('radio', { name: /自訂/ }))
    await user.type(screen.getByLabelText('自訂類別'), 'b')
    await user.clear(screen.getByLabelText('批次'))
    await user.type(screen.getByLabelText('批次'), 'c02')
    await user.clear(screen.getByLabelText('起始序號'))
    await user.type(screen.getByLabelText('起始序號'), '50')
    await user.click(screen.getByRole('button', { name: /進階/ }))
    await user.clear(screen.getByLabelText('序號位數'))
    await user.type(screen.getByLabelText('序號位數'), '4')
    await user.click(screen.getByRole('radio', { name: '原檔名' }))
    await user.clear(screen.getByLabelText('沒有條碼的標記'))
    await user.type(screen.getByLabelText('沒有條碼的標記'), 'none')
    await user.click(screen.getByLabelText(/看不出條碼的檔名也編號/))
    await user.click(screen.getByRole('button', { name: '預覽' }))
    expect(await screen.findByText('b_c02_0050_4710088410108.jpg', {}, WAIT)).toBeInTheDocument()
    expect(bodies(PREVIEW).at(-1)).toEqual({
      folder: 'D:/photos',
      category: 'b',
      batch: 'c02',
      start: 50,
      width: 4,
      order: 'name',
      include_unknown: true,
      no_code: 'none',
    })
  })

  it('確認後改名、可還原；改名用的是預覽時的參數', async () => {
    const user = userEvent.setup()
    await previewFolder(user)
    await user.click(await screen.findByRole('button', { name: '改名 2 個檔案' }, WAIT))
    const dialog = await screen.findByRole('dialog', { name: '確定改名？' })
    await user.click(within(dialog).getByRole('button', { name: '改名' }))
    expect(await screen.findByText('已改名 2 個檔案。', {}, WAIT)).toBeInTheDocument()
    expect(bodies(APPLY)).toEqual([bodies(PREVIEW)[0]])
    expect(screen.getByRole('button', { name: '改名 0 個檔案' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '還原先前的改名' }))
    const undo = await screen.findByRole('dialog', { name: '確定還原？' })
    await user.click(within(undo).getByRole('button', { name: '還原' }))
    expect(await screen.findByText('已還原 2 個檔案。', {}, WAIT)).toBeInTheDocument()
    expect(bodies(UNDO)).toEqual([{ folder: 'D:/photos' }])
    // 還原後重新預覽，又可以改名
    expect(await screen.findByRole('button', { name: '改名 2 個檔案' }, WAIT)).toBeEnabled()
  })

  it('取消確認不改名；參數修改後要先重新預覽', async () => {
    const user = userEvent.setup()
    await previewFolder(user)
    await user.click(await screen.findByRole('button', { name: '改名 2 個檔案' }, WAIT))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }),
    )
    expect(bodies(APPLY)).toEqual([])

    await user.type(screen.getByLabelText('批次'), 'x')
    expect(screen.getByText('參數已修改，按「預覽」重新規劃')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '改名 2 個檔案' })).toBeDisabled()
  })

  it('參數錯誤時顯示錯誤並標出欄位', async () => {
    const user = userEvent.setup()
    renderAt('/tools/naming')
    await user.type(await screen.findByLabelText('資料夾', {}, WAIT), 'D:/photos')
    await user.clear(screen.getByLabelText('批次'))
    await user.type(screen.getByLabelText('批次'), 'A 01')
    await user.click(screen.getByRole('button', { name: '預覽' }))
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('批次只能用')
    await waitFor(() =>
      expect(screen.getByLabelText('批次')).toHaveAttribute('aria-invalid', 'true'),
    )
  })

  it('找不到資料夾時顯示錯誤', async () => {
    const user = userEvent.setup()
    await previewFolder(user, 'D:/nope')
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('找不到')
  })
})
