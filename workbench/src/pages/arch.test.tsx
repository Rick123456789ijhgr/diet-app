// 專案架構圖：檢視頁（只顯示成品）與編輯器（新分頁、全頁介面）。純前端，文件存在 localStorage。
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { sampleDoc } from '@/lib/arch/sample'
import { STORAGE_KEY } from '@/pages/arch/useArchDoc'
import { renderAt } from '@/test/render'

const WAIT = { timeout: 3000 }

beforeEach(() => localStorage.clear())

const crumbs = () =>
  within(screen.getByRole('navigation', { name: '層級' }))
    .getAllByText(/./, { selector: 'button, [aria-current]' })
    .map((el) => el.textContent)

describe('架構圖・檢視', () => {
  const view = () => screen.getByRole('group', { name: /架構圖$/ })

  it('只顯示成品：點有細部圖的元件逐層進入，層級路徑可回上一層', async () => {
    const user = userEvent.setup()
    renderAt('/arch')
    expect(await screen.findByRole('heading', { name: '架構圖' }, WAIT)).toBeInTheDocument()
    expect(crumbs()).toEqual(['飲食紀錄 APP'])
    // 沒有編輯用的欄位與按鈕
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新增元件' })).not.toBeInTheDocument()

    // 沒有細部圖的元件點了不會換頁
    await user.click(within(view()).getByRole('button', { name: '資料庫' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP'])

    await user.click(within(view()).getByRole('button', { name: 'Python 外掛' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP', 'Python 外掛'])
    await user.click(within(view()).getByRole('button', { name: '影像前處理' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP', 'Python 外掛', '影像前處理'])
    expect(within(view()).getByText('品質門檻')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '飲食紀錄 APP' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP'])
  })

  it('「編輯」在新分頁開啟編輯器，並停在同一層', async () => {
    renderAt('/arch/diagram?d=m1')
    const link = await screen.findByRole('link', { name: '編輯' }, WAIT)
    expect(link).toHaveAttribute('href', '/arch/edit?d=m1')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('編輯器分頁存檔時即時更新', async () => {
    renderAt('/arch/diagram')
    await screen.findByRole('heading', { name: '架構圖' }, WAIT)
    const doc = sampleDoc()
    doc.diagrams.system!.nodes[0]!.title = '一般使用者'
    act(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })
    expect(within(view()).getByRole('button', { name: '一般使用者' })).toBeInTheDocument()
  })
})

describe('架構圖・編輯器', () => {
  const canvas = () => screen.getByRole('group', { name: /編輯畫布$/ })
  const nodeBtn = (name: string) => within(canvas()).getByRole('button', { name })

  it('全頁介面（沒有工作台外框）：點點格子畫布與屬性面板', async () => {
    renderAt('/arch/edit')
    expect(await screen.findByRole('heading', { name: '架構圖編輯器' }, WAIT)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '模組清單' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '屬性' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '名稱' })).toHaveValue('飲食紀錄 APP')
    expect(screen.getByLabelText('縮放比例')).toHaveTextContent('100%')
  })

  it('改標題、復原／重做、新增與刪除元件，並存回瀏覽器', async () => {
    const user = userEvent.setup()
    renderAt('/arch/edit?d=m1')
    await screen.findByRole('heading', { name: '架構圖編輯器' }, WAIT)

    fireEvent.pointerDown(nodeBtn('品質測量'))
    const title = screen.getByRole('textbox', { name: '標題' })
    await user.clear(title)
    await user.type(title, '品質評估')
    expect(nodeBtn('品質評估')).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toContain('品質評估')

    // 一次聚焦的編輯只記一步復原
    title.blur()
    await user.click(screen.getByRole('button', { name: '復原' }))
    expect(nodeBtn('品質測量')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重做' }))
    expect(nodeBtn('品質評估')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新增元件' }))
    expect(nodeBtn('新元件')).toBeInTheDocument()
    await user.keyboard('{Delete}')
    expect(within(canvas()).queryByRole('button', { name: '新元件' })).not.toBeInTheDocument()
  })

  it('方向鍵以一格移動選取的元件', async () => {
    const user = userEvent.setup()
    renderAt('/arch/edit?d=m1')
    await screen.findByRole('heading', { name: '架構圖編輯器' }, WAIT)
    fireEvent.pointerDown(nodeBtn('影像輸入'))
    await user.keyboard('{ArrowRight}{ArrowDown}{Shift>}{ArrowDown}{/Shift}')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    const n = saved.diagrams.m1.nodes.find((x: { id: string }) => x.id === 'in')
    expect(n).toMatchObject({ x: 20, y: 300 + 20 + 100 })
  })

  it('建立細部圖後進入新的一層；點兩下有細部圖的元件進入、Esc 回上一層', async () => {
    const user = userEvent.setup()
    renderAt('/arch/edit')
    await screen.findByRole('heading', { name: '架構圖編輯器' }, WAIT)
    await user.dblClick(nodeBtn('Python 外掛'))
    expect(crumbs()).toEqual(['飲食紀錄 APP', 'Python 外掛'])
    await user.keyboard('{Escape}')
    expect(crumbs()).toEqual(['飲食紀錄 APP'])

    fireEvent.pointerDown(nodeBtn('資料庫'))
    await user.click(screen.getByRole('button', { name: '建立細部圖' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP', '資料庫'])
    expect(nodeBtn('輸入')).toBeInTheDocument()
  })

  it('選取連線可改路線、刪除', async () => {
    const user = userEvent.setup()
    renderAt('/arch/edit?d=m1')
    await screen.findByRole('heading', { name: '架構圖編輯器' }, WAIT)
    fireEvent.pointerDown(screen.getByTestId('edge-quality.accent>strategy'))
    expect(screen.getByRole('radio', { name: '先垂直' })).toHaveAttribute('data-state', 'on')
    await user.click(screen.getByRole('radio', { name: '自動' }))
    expect(screen.getByRole('radio', { name: '自動' })).toHaveAttribute('data-state', 'on')
    await user.click(screen.getByRole('button', { name: '刪除連線' }))
    expect(screen.queryByTestId('edge-quality.accent>strategy')).not.toBeInTheDocument()
  })

  it('匯出選單列出 PNG、SVG、Mermaid、JSON', async () => {
    const user = userEvent.setup()
    renderAt('/arch/edit')
    await screen.findByRole('heading', { name: '架構圖編輯器' }, WAIT)
    await user.click(screen.getByRole('button', { name: /匯出/ }))
    const items = (await screen.findAllByRole('menuitem', {}, WAIT)).map((el) => el.textContent)
    expect(items).toEqual([
      'PNG 圖片（這張圖）',
      'SVG 向量圖（這張圖）',
      'Mermaid 文字（這張圖）',
      'JSON（整份，可匯入）',
    ])
  })

  it('匯入不合法的 JSON 時顯示錯誤，內容不變', async () => {
    const user = userEvent.setup()
    renderAt('/arch/edit')
    await screen.findByRole('heading', { name: '架構圖編輯器' }, WAIT)
    const bad = new File(['{"version":1}'], 'bad.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('選擇架構圖 JSON'), bad)
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('匯入失敗')
    expect(crumbs()).toEqual(['飲食紀錄 APP'])
  })
})
