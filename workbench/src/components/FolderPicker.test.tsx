// 「瀏覽…」資料夾瀏覽彈窗（後端為 src/test/server.ts 的假資料夾樹）。
// 操作仿照 Windows：按一下選取、按兩下開啟；上一頁／下一頁／上一層；網址列可點選或輸入。
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderAt } from '@/test/render'
import { requests } from '@/test/server'

const WAIT = { timeout: 3000 }

beforeEach(() => {
  requests.length = 0
  localStorage.clear()
})

/** 在圖片批次命名頁開啟「瀏覽…」彈窗。 */
async function openPicker(user: ReturnType<typeof userEvent.setup>, folder = '') {
  renderAt('/tools/naming')
  const input = await screen.findByLabelText('資料夾', {}, WAIT)
  if (folder) await user.type(input, folder)
  await user.click(screen.getByRole('button', { name: '瀏覽…' }))
  return screen.findByRole('dialog', { name: '選擇資料夾' })
}

const list = (dialog: HTMLElement) =>
  within(dialog).findByRole('listbox', { name: '子資料夾' }, WAIT)
const option = async (dialog: HTMLElement, name: RegExp) =>
  within(await list(dialog)).findByRole('option', { name }, WAIT)
const target = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: '資料夾：' })

describe('資料夾瀏覽', () => {
  it('按兩下開啟資料夾、按一下選取；選好後填入完整路徑', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user)
    // 起點（本機）：還沒選取時不能選
    expect(within(dialog).getByRole('button', { name: '選擇資料夾' })).toBeDisabled()
    await user.dblClick(await option(dialog, /D:\\/))
    await user.dblClick(await option(dialog, /photos/))
    // 影像張數與測試集鎖定
    const food = await option(dialog, /food/)
    expect(food).toHaveTextContent('12 張')
    expect(await option(dialog, /test/)).toHaveAttribute('aria-disabled', 'true')
    await user.click(food)
    expect(food).toHaveAttribute('aria-selected', 'true')
    expect(target(dialog)).toHaveValue('D:\\photos\\food')
    expect(within(dialog).getByText('已選取「food」，有 12 張影像')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '選擇資料夾' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('資料夾')).toHaveValue('D:\\photos\\food')
  })

  it('沒有選取時選的是目前所在的資料夾；鎖定的資料夾不能選取', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user, 'D:\\photos')
    await user.click(await option(dialog, /test/))
    expect(target(dialog)).toHaveValue('D:\\photos')
    await user.click(within(dialog).getByRole('button', { name: '選擇資料夾' }))
    expect(screen.getByLabelText('資料夾')).toHaveValue('D:\\photos')
  })

  it('從輸入框的路徑開始；網址列的麵包屑、上一層、上一頁與下一頁；取消不改輸入框', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user, 'D:\\photos\\food')
    expect(
      await within(dialog).findByText('0 個資料夾；這個資料夾有 12 張影像', {}, WAIT),
    ).toBeInTheDocument()
    const crumbs = within(dialog).getByRole('navigation', { name: '目前位置' })
    expect(within(crumbs).getByRole('button', { current: 'location' })).toHaveTextContent('food')
    await user.click(within(crumbs).getByRole('button', { name: 'D:' }))
    expect(await option(dialog, /photos/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '上一頁' }))
    expect(await within(dialog).findByText(/這個資料夾有 12 張影像/, {}, WAIT)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '上一層' }))
    expect(await option(dialog, /food/)).toBeInTheDocument()
    // 上一層之後捨棄「下一頁」的紀錄
    expect(within(dialog).getByRole('button', { name: '下一頁' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: '上一頁' }))
    await user.click(within(dialog).getByRole('button', { name: '下一頁' }))
    expect(await option(dialog, /food/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByLabelText('資料夾')).toHaveValue('D:\\photos\\food')
  })

  it('網址列可直接輸入路徑；Esc 取消輸入但不關彈窗', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user)
    await user.click(within(dialog).getByRole('button', { name: '輸入路徑' }))
    const input = within(dialog).getByRole('textbox', { name: '路徑' })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '選擇資料夾' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox', { name: '路徑' })).not.toBeInTheDocument()
    expect(input).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '輸入路徑' }))
    await user.type(within(dialog).getByRole('textbox', { name: '路徑' }), 'D:\\photos{Enter}')
    expect(await option(dialog, /food/)).toBeInTheDocument()
  })

  it('鍵盤：↓ 選取、Enter 開啟', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user, 'D:\\')
    const box = await list(dialog)
    box.focus()
    await user.keyboard('{ArrowDown}')
    expect(await option(dialog, /photos/)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(await option(dialog, /food/)).toBeInTheDocument()
  })

  it('左側列出磁碟機；選過的資料夾出現在最近使用', async () => {
    const user = userEvent.setup()
    let dialog = await openPicker(user)
    const side = within(dialog).getByRole('complementary', { name: '快速存取' })
    await user.click(await within(side).findByRole('button', { name: 'D:\\' }, WAIT))
    await user.dblClick(await option(dialog, /photos/))
    await user.click(await option(dialog, /food/))
    await user.click(within(dialog).getByRole('button', { name: '選擇資料夾' }))

    await user.click(screen.getByRole('button', { name: '瀏覽…' }))
    dialog = await screen.findByRole('dialog', { name: '選擇資料夾' })
    const recent = within(dialog).getByRole('list', { name: '最近使用' })
    await user.click(within(recent).getByRole('button', { name: 'food' }))
    expect(
      await within(dialog).findByText('0 個資料夾；這個資料夾有 12 張影像', {}, WAIT),
    ).toBeInTheDocument()
  })

  it('輸入框的路徑不存在時顯示錯誤，上一層回到起點', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user, 'D:\\nope')
    expect(await within(dialog).findByRole('alert', {}, WAIT)).toHaveTextContent('找不到')
    await user.click(within(dialog).getByRole('button', { name: '上一層' }))
    expect(await option(dialog, /C:\\/)).toBeInTheDocument()
  })

  it('其他輸入資料夾的地方也有「瀏覽…」', async () => {
    const user = userEvent.setup()
    renderAt('/m1/multi/folder')
    await screen.findByLabelText('資料夾', {}, WAIT)
    await user.click(screen.getByRole('button', { name: '瀏覽…' }))
    const dialog = await screen.findByRole('dialog', { name: '選擇資料夾' })
    await user.dblClick(await option(dialog, /D:\\/))
    await user.click(await option(dialog, /photos/))
    await user.click(within(dialog).getByRole('button', { name: '選擇資料夾' }))
    expect(screen.getByLabelText('資料夾')).toHaveValue('D:\\photos')
  })
})
