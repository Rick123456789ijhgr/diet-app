import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { foldSeries, OTHER_KEY } from '@/lib/series'

import { Heatmap, PALETTE, StackedBars } from './charts'
import { DraftNumberInput, Slider } from './ui/primitives'

describe('系列合併（色盤不循環）', () => {
  it('未超過上限時原樣回傳', () => {
    const rows = [{ label: 'a', values: { x: 1 } }]
    expect(foldSeries(['x'], rows, 8)).toEqual({ keys: ['x'], rows })
  })

  it('超過上限時第 limit 個以後的鍵加總為「其他」', () => {
    const keys = ['a', 'b', 'c', 'd']
    const rows = [{ label: 'r', values: { a: 1, b: 2, c: 3, d: 4 } }]
    const out = foldSeries(keys, rows, 3)
    expect(out.keys).toEqual(['a', 'b', OTHER_KEY])
    expect(out.rows[0]!.values).toEqual({ a: 1, b: 2, [OTHER_KEY]: 7 })
  })

  it('StackedBars 超過 8 個鍵時不重複用色，圖例顯示「其他」', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}`)
    const values = Object.fromEntries(keys.map((k) => [k, 1]))
    const { container } = render(
      <StackedBars rows={[{ label: '列', values }]} keys={keys} label="圖" />,
    )
    const fills = [...container.querySelectorAll('rect')].map((r) => r.getAttribute('fill'))
    expect(fills).toHaveLength(PALETTE.length)
    expect(new Set(fills).size).toBe(fills.length)
    expect(screen.getByText('其他')).toBeInTheDocument()
    // 總數不因合併而改變
    expect(screen.getByText('10')).toBeInTheDocument()
  })
})

describe('主題變數（不寫死色碼）', () => {
  it('熱度圖深色格的文字用主題變數', () => {
    const { container } = render(
      <Heatmap rows={['r']} cols={['c']} value={() => ({ rate: 0.9, title: 't' })} label="圖" />,
    )
    expect(container.querySelector('text[fill="var(--on-primary)"]')).not.toBeNull()
  })

  it('新增的主題變數在淺色與深色都有定義', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../index.css'), 'utf8')
    for (const name of ['--on-primary', '--switch-thumb']) {
      expect(css.match(new RegExp(`\\s${name}:`, 'g'))).toHaveLength(2)
    }
  })
})

describe('基本元件', () => {
  it('Slider 的 aria-label 只標在 Thumb', () => {
    const { container } = render(<Slider aria-label="清晰度" value={[1]} min={0} max={2} />)
    expect(screen.getAllByLabelText('清晰度')).toHaveLength(1)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-label', '清晰度')
    expect(container.firstElementChild).not.toHaveAttribute('aria-label')
  })

  it('DraftNumberInput 依格式化字串同步：外部值改變時更新、編輯中不覆蓋', () => {
    // 內聯 format：每次渲染都是新參照
    const format = (v: number) => v.toFixed(1)
    const { rerender } = render(
      <DraftNumberInput aria-label="值" value={1} format={(v) => format(v)} onCommit={() => {}} />,
    )
    const input = screen.getByLabelText('值')
    expect(input).toHaveValue(1)
    // 外部值改變仍會同步
    rerender(
      <DraftNumberInput aria-label="值" value={2} format={(v) => format(v)} onCommit={() => {}} />,
    )
    expect(input).toHaveValue(2)
    // 編輯中不覆蓋草稿；失焦後恢復成目前值
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    rerender(
      <DraftNumberInput aria-label="值" value={2} format={(v) => format(v)} onCommit={() => {}} />,
    )
    expect(input).toHaveValue(null)
    fireEvent.blur(input)
    expect(input).toHaveValue(2)
  })
})

describe('參數表單與退化計數', () => {
  it('同頁兩個 ParamForm 有同名欄位時 id 不重複；說明提示可用鍵盤聚焦', async () => {
    const { ParamForm } = await import('./ParamForm')
    const { qualitySchema } = await import('@/test/server')
    const { TooltipProvider } = await import('./ui/primitives')
    render(
      <TooltipProvider>
        <ParamForm schema={qualitySchema} overrides={{}} onChange={() => {}} />
        <ParamForm schema={qualitySchema} overrides={{}} onChange={() => {}} />
      </TooltipProvider>,
    )
    const inputs = screen.getAllByLabelText('模糊下限', { selector: 'input' })
    expect(inputs).toHaveLength(2)
    expect(inputs[0]!.id).not.toBe(inputs[1]!.id)
    const help = screen.getAllByRole('button', { name: '模糊下限說明' })[0]!
    help.focus()
    expect(help).toHaveFocus()
  })

  it('退化計數不含 seed（徽章的數字與顏色共用）', async () => {
    const { degradationCount } = await import('@/lib/config')
    expect(degradationCount({ seed: 3 })).toBe(0)
    expect(degradationCount({ seed: 3, blur_sigma: 2 })).toBe(1)
  })
})

describe('影像檢視器', () => {
  it('觸控被中斷（pointercancel）後，下次移動不會被當成拖曳', async () => {
    const { ImageViewer } = await import('./ImageViewer')
    render(<ImageViewer src="x.png" width={100} height={80} alt="影像" />)
    const box = screen.getByAltText('影像').parentElement!.parentElement!
    const layer = screen.getByAltText('影像').parentElement!
    const before = layer.style.transform
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerCancel(box, { pointerId: 1 })
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 60, clientY: 50 })
    expect(layer.style.transform).toBe(before)
  })
})
