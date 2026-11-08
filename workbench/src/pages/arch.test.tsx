// 專案架構・架構圖（純前端，不呼叫架構圖相關的 API；文件存在 localStorage）。
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_KEY } from '@/pages/arch/useArchDoc'
import { renderAt } from '@/test/render'

const WAIT = { timeout: 3000 }

beforeEach(() => localStorage.clear())

const crumbs = () =>
  within(screen.getByRole('navigation', { name: '層級' }))
    .getAllByText(/./, { selector: 'button, [aria-current]' })
    .map((el) => el.textContent)

const canvas = () => screen.getByRole('group', { name: /架構圖$/ })

describe('架構圖', () => {
  it('預設顯示本專案的範例；點兩下逐層進入，層級路徑可回上一層', async () => {
    const user = userEvent.setup()
    renderAt('/arch')
    expect(await screen.findByRole('heading', { name: '架構圖' }, WAIT)).toBeInTheDocument()
    expect(crumbs()).toEqual(['飲食紀錄 APP'])

    await user.dblClick(within(canvas()).getByRole('button', { name: 'Python 外掛' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP', '服務內部元件'])
    await user.dblClick(within(canvas()).getByRole('button', { name: '影像前處理' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP', '服務內部元件', '影像前處理'])
    expect(within(canvas()).getByRole('button', { name: '品質測量' })).toBeInTheDocument()
    expect(within(canvas()).getByText('品質門檻')).toBeInTheDocument()

    // Esc 回上一層；點層級路徑回最上層
    await user.keyboard('{Escape}')
    expect(crumbs()).toEqual(['飲食紀錄 APP', '服務內部元件'])
    await user.click(screen.getByRole('button', { name: '飲食紀錄 APP' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP'])
  })

  it('檢視模式點選元件顯示說明與「進入細部圖」', async () => {
    const user = userEvent.setup()
    renderAt('/arch/diagram')
    await screen.findByRole('heading', { name: '架構圖' }, WAIT)
    await user.click(screen.getByRole('radio', { name: /檢視/ }))
    fireEvent.pointerDown(within(canvas()).getByRole('button', { name: 'Go 主伺服器' }))
    expect(screen.getByText(/資料庫唯一的寫入者/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '進入細部圖' })).not.toBeInTheDocument()
    fireEvent.pointerDown(within(canvas()).getByRole('button', { name: 'Python 外掛' }))
    await user.click(screen.getByRole('button', { name: '進入細部圖' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP', '服務內部元件'])
  })

  it('編輯：改標題、復原、新增與刪除元件，並存回瀏覽器', async () => {
    const user = userEvent.setup()
    renderAt('/arch/diagram?d=m1')
    await screen.findByRole('heading', { name: '架構圖' }, WAIT)

    fireEvent.pointerDown(within(canvas()).getByRole('button', { name: '品質測量' }))
    const title = screen.getByRole('textbox', { name: '標題' })
    await user.clear(title)
    await user.type(title, '品質評估')
    expect(within(canvas()).getByRole('button', { name: '品質評估' })).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toContain('品質評估')

    // 一次聚焦的編輯只記一步復原
    title.blur()
    await user.click(screen.getByRole('button', { name: '復原' }))
    expect(within(canvas()).getByRole('button', { name: '品質測量' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重做' }))
    expect(within(canvas()).getByRole('button', { name: '品質評估' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新增元件' }))
    expect(within(canvas()).getByRole('button', { name: '新元件' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /刪除元件/ }))
    expect(within(canvas()).queryByRole('button', { name: '新元件' })).not.toBeInTheDocument()
  })

  it('建立細部圖後進入新的一層', async () => {
    const user = userEvent.setup()
    renderAt('/arch/diagram?d=m1')
    await screen.findByRole('heading', { name: '架構圖' }, WAIT)
    fireEvent.pointerDown(within(canvas()).getByRole('button', { name: '影像輸入' }))
    await user.click(screen.getByRole('button', { name: '建立細部圖' }))
    expect(crumbs()).toEqual(['飲食紀錄 APP', '服務內部元件', '影像前處理', '內部流程'])
    expect(within(canvas()).getByRole('button', { name: '輸入' })).toBeInTheDocument()
  })

  it('選取連線可改路線、刪除', async () => {
    const user = userEvent.setup()
    renderAt('/arch/diagram?d=m1')
    await screen.findByRole('heading', { name: '架構圖' }, WAIT)
    fireEvent.pointerDown(screen.getByTestId('edge-quality.accent>strategy'))
    expect(screen.getByRole('heading', { name: '連線' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '先垂直' })).toHaveAttribute('data-state', 'on')
    await user.click(screen.getByRole('radio', { name: '自動' }))
    expect(screen.getByRole('radio', { name: '自動' })).toHaveAttribute('data-state', 'on')
    await user.click(screen.getByRole('button', { name: '刪除連線' }))
    expect(screen.queryByTestId('edge-quality.accent>strategy')).not.toBeInTheDocument()
  })

  it('匯入不合法的 JSON 時顯示錯誤，內容不變', async () => {
    const user = userEvent.setup()
    renderAt('/arch/diagram')
    await screen.findByRole('heading', { name: '架構圖' }, WAIT)
    const bad = new File(['{"version":1}'], 'bad.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('選擇架構圖 JSON'), bad)
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('匯入失敗')
    expect(crumbs()).toEqual(['飲食紀錄 APP'])
  })
})
