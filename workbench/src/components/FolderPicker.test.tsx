// 「瀏覽…」資料夾瀏覽彈窗（後端為 src/test/server.ts 的假資料夾樹）。
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderAt } from '@/test/render'
import { requests } from '@/test/server'

const WAIT = { timeout: 3000 }

beforeEach(() => {
  requests.length = 0
})

/** 在圖片批次命名頁開啟「瀏覽…」彈窗。 */
async function openPicker(user: ReturnType<typeof userEvent.setup>, folder = '') {
  renderAt('/tools/naming')
  const input = await screen.findByLabelText('資料夾', {}, WAIT)
  if (folder) await user.type(input, folder)
  await user.click(screen.getByRole('button', { name: '瀏覽…' }))
  return screen.findByRole('dialog', { name: '選擇資料夾' })
}

describe('資料夾瀏覽', () => {
  it('從磁碟機開始逐層點選，選好後填入完整路徑', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user)
    const list = () => within(dialog).findByRole('list', { name: '子資料夾' }, WAIT)
    // 起點：還不能選、不能往上
    expect(within(dialog).getByRole('button', { name: '選擇這個資料夾' })).toBeDisabled()
    await user.click(within(await list()).getByRole('button', { name: /D:\\/ }))
    await user.click(within(await list()).getByRole('button', { name: /photos/ }))
    // 影像張數與測試集鎖定
    const items = await list()
    expect(within(items).getByRole('button', { name: /food/ })).toHaveTextContent('12 張')
    expect(within(items).getByRole('button', { name: /test/ })).toBeDisabled()
    await user.click(within(items).getByRole('button', { name: /food/ }))
    expect(await within(dialog).findByText('這個資料夾有 12 張影像', {}, WAIT)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '選擇這個資料夾' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('資料夾')).toHaveValue('D:\\photos\\food')
  })

  it('從輸入框的路徑開始；上一層往回走，取消不改輸入框', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user, 'D:\\photos\\food')
    expect(await within(dialog).findByText('這個資料夾有 12 張影像', {}, WAIT)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('目前位置')).toHaveTextContent('D:\\photos\\food')
    await user.click(within(dialog).getByRole('button', { name: '上一層' }))
    expect(await within(dialog).findByRole('button', { name: /food/ }, WAIT)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('目前位置')).toHaveTextContent('D:\\photos')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByLabelText('資料夾')).toHaveValue('D:\\photos\\food')
  })

  it('輸入框的路徑不存在時顯示錯誤，上一層回到起點', async () => {
    const user = userEvent.setup()
    const dialog = await openPicker(user, 'D:\\nope')
    expect(await within(dialog).findByRole('alert', {}, WAIT)).toHaveTextContent('找不到')
    await user.click(within(dialog).getByRole('button', { name: '上一層' }))
    expect(await within(dialog).findByRole('button', { name: /C:\\/ }, WAIT)).toBeInTheDocument()
  })

  it('其他輸入資料夾的地方也有「瀏覽…」', async () => {
    const user = userEvent.setup()
    renderAt('/m1/multi/folder')
    await screen.findByLabelText('資料夾', {}, WAIT)
    await user.click(screen.getByRole('button', { name: '瀏覽…' }))
    const dialog = await screen.findByRole('dialog', { name: '選擇資料夾' })
    await user.click(await within(dialog).findByRole('button', { name: /D:\\/ }, WAIT))
    await user.click(await within(dialog).findByRole('button', { name: /photos/ }, WAIT))
    await within(dialog).findByRole('button', { name: /food/ }, WAIT)
    await user.click(within(dialog).getByRole('button', { name: '選擇這個資料夾' }))
    expect(screen.getByLabelText('資料夾')).toHaveValue('D:\\photos')
  })
})
