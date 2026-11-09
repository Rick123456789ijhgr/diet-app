// 工具頁共用版面：控制面板可收起（記在瀏覽器，所有工具頁共用）。
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { renderAt } from '@/test/render'

const WAIT = { timeout: 3000 }

afterEach(() => localStorage.removeItem('wb.panelCollapsed'))

describe('控制面板收起', () => {
  it('收起後主檢視變寬，切到其他工具頁仍保持收起；展開後還原', async () => {
    const user = userEvent.setup()
    const { unmount } = renderAt('/m1/multi/sweep')
    const toggle = await screen.findByRole('button', { name: '收起控制面板' }, WAIT)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: '控制面板' })).toBeVisible()
    await user.click(toggle)
    expect(screen.queryByRole('region', { name: '控制面板' })).not.toBeInTheDocument()
    expect(localStorage.getItem('wb.panelCollapsed')).toBe('1')
    unmount()

    renderAt('/m1/results/e1')
    const open = await screen.findByRole('button', { name: '展開控制面板' }, WAIT)
    expect(open).toHaveAttribute('aria-expanded', 'false')
    await user.click(open)
    expect(screen.getByRole('region', { name: '控制面板' })).toBeVisible()
    expect(localStorage.getItem('wb.panelCollapsed')).toBe('0')
  })
})
