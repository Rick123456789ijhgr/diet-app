// 架構圖的純函式：連線路徑、命中測試、文字寬度、編輯操作、匯入驗證、麵包屑。
import { describe, expect, it } from 'vitest'

import {
  edgePoints,
  fitFontSize,
  hitPart,
  labelPoint,
  partRect,
  roundedPath,
  routePoints,
  simplify,
  textWidth,
} from './geometry'
import {
  applyOp,
  type ArchDoc,
  freeSpot,
  newNode,
  nextLevel,
  nodeWidth,
  parseDoc,
  pathTo,
  placeNode,
  subtree,
} from './model'
import { sampleDoc } from './sample'

const rect = (x: number, y: number, w = 100, h = 100) => ({ x, y, w, h })

describe('routePoints', () => {
  it('同一列：水平直線，高度取重疊區中點', () => {
    expect(routePoints(rect(0, 0), rect(200, 20), 'auto')).toEqual([
      { x: 100, y: 60 },
      { x: 200, y: 60 },
    ])
    // 目標在左邊時從左側出去
    expect(routePoints(rect(200, 0), rect(0, 0), 'auto')).toEqual([
      { x: 200, y: 50 },
      { x: 100, y: 50 },
    ])
  })

  it('同一欄：垂直直線（往上時從上緣出去）', () => {
    expect(routePoints(rect(0, 300), rect(0, 0), 'auto')).toEqual([
      { x: 50, y: 300 },
      { x: 50, y: 100 },
    ])
  })

  it('hv：從側邊出去、從下緣進入（參考圖的「檢驗結果 → 處理流程」）', () => {
    expect(routePoints(rect(0, 300), rect(300, 0), 'hv')).toEqual([
      { x: 100, y: 350 },
      { x: 350, y: 350 },
      { x: 350, y: 100 },
    ])
  })

  it('vh：從上緣出去、從側邊進入（參考圖的「品質門檻 → 優化策略」）', () => {
    expect(routePoints(rect(0, 300), rect(300, 0), 'vh')).toEqual([
      { x: 50, y: 300 },
      { x: 50, y: 50 },
      { x: 300, y: 50 },
    ])
  })

  it('L 形走不通時改用自動路線', () => {
    // 同一列無法先垂直再水平：改畫水平直線
    expect(routePoints(rect(0, 0), rect(300, 50), 'vh')).toEqual([
      { x: 100, y: 75 },
      { x: 300, y: 75 },
    ])
    // 目標中線剛好落在起點邊上也不算走得通（否則第一段長度為零）
    expect(routePoints(rect(0, 0), rect(300, 50, 100, 100), 'vh')[0]).toEqual({ x: 100, y: 75 })
  })

  it('auto 且不在同列同欄：沿距離較大的方向畫 Z 形', () => {
    expect(routePoints(rect(0, 0), rect(400, 200), 'auto')).toEqual([
      { x: 100, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 250 },
      { x: 400, y: 250 },
    ])
    expect(routePoints(rect(0, 0), rect(150, 400), 'auto')).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 250 },
      { x: 200, y: 250 },
      { x: 200, y: 400 },
    ])
  })
})

describe('路徑', () => {
  it('simplify 去掉重複點與共線點', () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ])
  })

  it('roundedPath 在轉角畫圓角，半徑不超過線段一半', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 10 },
      ]),
    ).toBe('M0 0 L95 0 Q100 0 100 5 L100 10')
    expect(roundedPath([])).toBe('')
  })

  it('labelPoint 取最長一段的中點', () => {
    expect(
      labelPoint([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 200, y: 10 },
      ]),
    ).toEqual({ x: 100, y: 10 })
  })
})

describe('元件幾何', () => {
  const n = { ...newNode('a', 100, 100), accent: '門檻' }

  it('partRect：強調塊接在主方塊右側；沒有強調塊時回傳主方塊', () => {
    expect(partRect(n, 'accent')).toEqual({ x: 350, y: 100, w: 170, h: 180 })
    expect(partRect({ ...n, accent: '' }, 'accent')).toEqual({ x: 100, y: 100, w: 250, h: 180 })
    expect(nodeWidth(n)).toBe(420)
  })

  it('hitPart：分辨主方塊與強調塊，後畫的優先', () => {
    const b = { ...newNode('b', 120, 120) }
    expect(hitPart([n], { x: 400, y: 150 })).toEqual({ node: 'a', part: 'accent' })
    expect(hitPart([n], { x: 110, y: 150 })).toEqual({ node: 'a', part: 'main' })
    expect(hitPart([n, b], { x: 130, y: 130 })).toEqual({ node: 'b', part: 'main' })
    expect(hitPart([n], { x: 0, y: 0 })).toBeUndefined()
  })

  it('edgePoints：端點元件不存在時為 undefined', () => {
    const e = {
      id: 'e',
      from: { node: 'a', part: 'main' as const },
      to: { node: 'x', part: 'main' as const },
      route: 'auto' as const,
      label: '',
    }
    expect(edgePoints([n], e)).toBeUndefined()
  })
})

describe('文字', () => {
  it('textWidth：中文 1em、拉丁較窄', () => {
    expect(textWidth('模組', 10)).toBe(20)
    expect(textWidth('AB', 10)).toBeCloseTo(13.2)
    expect(textWidth('ab', 10, 2)).toBeCloseTo(15.2)
  })

  it('fitFontSize：放得下用原字級，否則縮小但不小於下限', () => {
    expect(fitFontSize('模組', 36, 200)).toBe(36)
    expect(fitFontSize('一二三四五六七八', 36, 144)).toBe(18)
    expect(fitFontSize('一二三四五六七八九十', 36, 20, 14)).toBe(14)
  })
})

describe('編輯操作', () => {
  const doc = sampleDoc()

  it('moveNode 對齊格線並限制在畫板內', () => {
    const next = applyOp(doc, { type: 'moveNode', diagram: 'm1', node: 'in', x: 123, y: -50 })
    expect(next.diagrams.m1!.nodes.find((n) => n.id === 'in')).toMatchObject({ x: 120, y: 0 })
    expect(doc.diagrams.m1!.nodes.find((n) => n.id === 'in')).toMatchObject({ x: 120, y: 480 })
    expect(placeNode(newNode('z', 0, 0), 5000, 5000)).toEqual({ x: 1670, y: 900 })
  })

  it('removeNode 一併刪除相連的線與整棵細部圖', () => {
    expect(subtree(doc, 'ai')).toEqual(['ai', 'm1'])
    const next = applyOp(doc, { type: 'removeNode', diagram: 'system', node: 'ai' })
    expect(next.diagrams.ai).toBeUndefined()
    expect(next.diagrams.m1).toBeUndefined()
    expect(
      next.diagrams.system!.edges.some((e) => e.from.node === 'ai' || e.to.node === 'ai'),
    ).toBe(false)
  })

  it('addEdge 不接自己、不重複、兩端都要存在', () => {
    const e = (from: string, to: string) => ({
      type: 'addEdge' as const,
      diagram: 'm1',
      edge: {
        id: 'x',
        from: { node: from, part: 'main' as const },
        to: { node: to, part: 'main' as const },
        route: 'auto' as const,
        label: '',
      },
    })
    expect(applyOp(doc, e('in', 'in'))).toBe(doc)
    expect(applyOp(doc, e('in', 'quality'))).toBe(doc) // 範例已有這條
    expect(applyOp(doc, e('in', 'nope'))).toBe(doc)
    expect(applyOp(doc, e('in', 'out')).diagrams.m1!.edges).toHaveLength(9)
  })

  it('createChild 建立細部圖並連到元件；已有細部圖時不動', () => {
    const next = applyOp(doc, { type: 'createChild', diagram: 'm1', node: 'in', childId: 'd-1' })
    expect(next.diagrams.m1!.nodes.find((n) => n.id === 'in')!.child).toBe('d-1')
    expect(next.diagrams['d-1']).toMatchObject({ badge: '影像輸入', level: 'L5 細部' })
    expect(next.diagrams['d-1']!.nodes).toHaveLength(2)
    expect(
      applyOp(doc, { type: 'createChild', diagram: 'system', node: 'ai', childId: 'd-2' }),
    ).toBe(doc)
  })

  it('nextLevel', () => {
    expect(nextLevel('L2 容器')).toBe('L3 元件')
    expect(nextLevel('L3 元件')).toBe('L4 流程')
    expect(nextLevel('自訂')).toBe('自訂')
  })

  it('freeSpot 找不與既有元件重疊的位置', () => {
    const d = doc.diagrams.m1!
    const { x, y } = freeSpot(d)
    const placed = { ...newNode('new', x, y) }
    for (const n of d.nodes) {
      const apart =
        x + placed.w <= n.x || n.x + nodeWidth(n) <= x || y + placed.h <= n.y || n.y + n.h <= y
      expect(apart).toBe(true)
    }
  })
})

describe('pathTo', () => {
  it('從最上層一路到細部圖', () => {
    const doc = sampleDoc()
    expect(pathTo(doc, 'm1').map((p) => p.diagram.id)).toEqual(['system', 'ai', 'm1'])
    expect(pathTo(doc, 'm1').at(-1)!.via!.id).toBe('m1')
    expect(pathTo(doc, 'nope').map((p) => p.diagram.id)).toEqual(['system'])
  })
})

describe('parseDoc', () => {
  it('範例來回 JSON 不變', () => {
    const doc = sampleDoc()
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })

  it('補預設值、丟掉接不上的線與不存在的細部圖', () => {
    const raw = {
      version: 1,
      root: 'r',
      diagrams: {
        r: {
          nodes: [
            { id: 'a', title: 'A', child: 'missing' },
            { id: 'b', w: 5 },
          ],
          edges: [
            { from: { node: 'a' }, to: { node: 'b', part: 'accent' }, route: 'weird' },
            { from: { node: 'a' }, to: { node: 'ghost' } },
          ],
        },
      },
    }
    const doc: ArchDoc = parseDoc(raw)
    const r = doc.diagrams.r!
    expect(r.nodes[0]).toMatchObject({ id: 'a', title: 'A', w: 250, h: 180, accent: '' })
    expect(r.nodes[0]!.child).toBeUndefined()
    expect(r.nodes[1]!.w).toBe(60)
    expect(r.edges).toHaveLength(1)
    expect(r.edges[0]).toMatchObject({ to: { node: 'b', part: 'accent' }, route: 'auto' })
  })

  it('結構不對時丟出中文錯誤', () => {
    expect(() => parseDoc(null)).toThrow('缺少 diagrams')
    expect(() => parseDoc({ version: 2, diagrams: {} })).toThrow('不支援的版本')
    expect(() => parseDoc({ version: 1, root: 'x', diagrams: {} })).toThrow('root')
  })
})
