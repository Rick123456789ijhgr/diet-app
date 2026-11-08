// 架構圖的純函式：連線路徑、定位點、吸附、命中測試、文字寬度、編輯操作、匯入驗證、層級路徑、Mermaid 匯出。
import { describe, expect, it } from 'vitest'

import {
  anchorPoint,
  edgeGeometry,
  edgePoints,
  facingSide,
  fitFontSize,
  hitPart,
  layoutEdges,
  nearestAnchor,
  nodeAnchors,
  orthoRoute,
  pointAlong,
  partRect,
  roundedPath,
  routePoints,
  simplify,
  snapMove,
  textWidth,
} from './geometry'
import { toMermaid } from './mermaid'
import {
  applyOp,
  type ArchDoc,
  type ArchEdge,
  bounds,
  type EdgeEnd,
  freeSpot,
  GRID,
  newEdge,
  newNode,
  nextLevel,
  nodeBox,
  nodeWidth,
  overlaps,
  parseDoc,
  pathTo,
  sameEnd,
  subtree,
} from './model'
import { sampleDoc } from './sample'
import { DEFAULT_EDGE_STYLE, DEFAULT_NODE_STYLE } from './theme'

const rect = (x: number, y: number, w = 100, h = 100) => ({ x, y, w, h })
const edge = (from: EdgeEnd, to: EdgeEnd, extra: Partial<ArchEdge> = {}): ArchEdge => ({
  ...newEdge('e', from, to),
  ...extra,
})

describe('routePoints（兩端都自動選邊）', () => {
  it('同一列：水平直線，高度取重疊區中點', () => {
    expect(routePoints(rect(0, 0), rect(200, 20), 'auto')).toEqual([
      { x: 100, y: 60 },
      { x: 200, y: 60 },
    ])
    expect(routePoints(rect(200, 0), rect(0, 0), 'auto')).toEqual([
      { x: 200, y: 50 },
      { x: 100, y: 50 },
    ])
  })

  it('同一欄：垂直直線', () => {
    expect(routePoints(rect(0, 300), rect(0, 0), 'auto')).toEqual([
      { x: 50, y: 300 },
      { x: 50, y: 100 },
    ])
  })

  it('hv／vh：L 形（參考圖的「檢驗結果 → 處理流程」「品質門檻 → 優化策略」）', () => {
    expect(routePoints(rect(0, 300), rect(300, 0), 'hv')).toEqual([
      { x: 100, y: 350 },
      { x: 350, y: 350 },
      { x: 350, y: 100 },
    ])
    expect(routePoints(rect(0, 300), rect(300, 0), 'vh')).toEqual([
      { x: 50, y: 300 },
      { x: 50, y: 50 },
      { x: 300, y: 50 },
    ])
  })

  it('L 形走不通時改用自動；自動且不在同列同欄時畫 Z 形', () => {
    expect(routePoints(rect(0, 0), rect(300, 50), 'vh')).toEqual([
      { x: 100, y: 75 },
      { x: 300, y: 75 },
    ])
    expect(routePoints(rect(0, 0), rect(400, 200), 'auto')).toEqual([
      { x: 100, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 250 },
      { x: 400, y: 250 },
    ])
  })
})

describe('orthoRoute（依端點的邊向）', () => {
  const R = { x: 1, y: 0 }
  const L = { x: -1, y: 0 }
  const U = { x: 0, y: -1 }
  const D = { x: 0, y: 1 }

  it('右側對左側、同高：直線', () => {
    expect(orthoRoute({ x: 100, y: 50 }, R, { x: 300, y: 50 }, L)).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
    ])
  })

  it('右側對左側、不同高：在中間轉彎的 Z 形', () => {
    expect(orthoRoute({ x: 100, y: 50 }, R, { x: 300, y: 150 }, L)).toEqual([
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 150 },
      { x: 300, y: 150 },
    ])
  })

  it('右側對下緣：L 形', () => {
    expect(orthoRoute({ x: 100, y: 300 }, R, { x: 300, y: 100 }, D)).toEqual([
      { x: 100, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 100 },
    ])
  })

  it('上緣對上緣：先伸出再轉彎（不貼著邊）', () => {
    const pts = orthoRoute({ x: 50, y: 100 }, U, { x: 250, y: 100 }, U)
    expect(pts).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 80 },
      { x: 250, y: 80 },
      { x: 250, y: 100 },
    ])
  })
})

describe('路徑', () => {
  it('simplify 去掉重複點與同向的共線點，折返時保留', () => {
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
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toHaveLength(3)
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

  it('pointAlong 依全長比例取點（標籤位置）', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 200, y: 10 },
    ]
    expect(pointAlong(pts, 0.5)).toEqual({ x: 95, y: 10 })
    expect(pointAlong(pts, 0)).toEqual({ x: 0, y: 0 })
    expect(pointAlong(pts, 1)).toEqual({ x: 200, y: 10 })
  })
})

describe('定位點與連線幾何', () => {
  const a = newNode('a', 0, 0) // 240×160
  const b = newNode('b', 400, 0)
  const acc = { ...newNode('c', 0, 300), accent: '門檻' }

  it('每邊 1/4、中點、3/4 三個定位點；主圖形與強調塊相接的邊不算', () => {
    expect(nodeAnchors(a)).toHaveLength(12)
    expect(
      nodeAnchors(a)
        .filter((x) => x.side === 'right')
        .map((x) => x.pt),
    ).toEqual([
      { x: 240, y: 40 },
      { x: 240, y: 80 },
      { x: 240, y: 120 },
    ])
    const mids = (n: typeof a) => nodeAnchors(n).filter((x) => x.pos === 0.5)
    expect(mids(a).map((x) => [x.side, x.pt])).toEqual([
      ['top', { x: 120, y: 0 }],
      ['right', { x: 240, y: 80 }],
      ['bottom', { x: 120, y: 160 }],
      ['left', { x: 0, y: 80 }],
    ])
    const sides = mids(acc).map((x) => `${x.part}-${x.side}`)
    expect(sides).toEqual([
      'main-top',
      'main-bottom',
      'main-left',
      'accent-top',
      'accent-right',
      'accent-bottom',
    ])
  })

  it('橢圓、菱形的定位點貼著實際輪廓', () => {
    const r = rect(0, 0, 220, 140)
    const top = anchorPoint(r, 'top', 0.25, 'ellipse')
    expect(top.x).toBe(55)
    expect(top.y).toBeCloseTo(70 - 70 * Math.sqrt(0.75))
    expect(anchorPoint(r, 'left', 0.25, 'diamond')).toEqual({ x: 55, y: 35 })
    expect(anchorPoint(r, 'top', 0.5, 'diamond')).toEqual({ x: 110, y: 0 })
  })

  it('nearestAnchor 只在距離內吸附（含 1/4、3/4 的定位點）', () => {
    expect(nearestAnchor([a, b], { x: 245, y: 85 }, 18)).toMatchObject({
      node: 'a',
      anchor: { part: 'main', side: 'right', pos: 0.5 },
    })
    expect(nearestAnchor([a, b], { x: 243, y: 44 }, 18)).toMatchObject({
      anchor: { side: 'right', pos: 0.25 },
    })
    expect(nearestAnchor([a, b], { x: 300, y: 85 }, 18)).toBeUndefined()
  })

  it('facingSide 選朝向另一端的邊', () => {
    expect(facingSide(rect(0, 0, 200, 100), { x: 500, y: 60 })).toBe('right')
    expect(facingSide(rect(0, 0, 200, 100), { x: 100, y: -300 })).toBe('top')
  })

  it('固定在某一邊的端點從該邊的定位點出發', () => {
    const g = edgeGeometry(
      [a, b],
      edge(
        { node: 'a', part: 'main', side: 'bottom' },
        { node: 'b', part: 'main', side: 'bottom' },
      ),
    )!
    expect(g.start).toEqual({ x: 120, y: 160 })
    expect(g.end).toEqual({ x: 520, y: 160 })
    // 兩個下緣：先往下伸出再接起來
    expect(g.points).toEqual([
      { x: 120, y: 160 },
      { x: 120, y: 180 },
      { x: 520, y: 180 },
      { x: 520, y: 160 },
    ])
  })

  it('自由端點：另一端自動選朝向它的邊', () => {
    const g = edgeGeometry([a], edge({ node: 'a', part: 'main' }, { x: 600, y: 80 }))!
    expect(g.start).toEqual(anchorPoint(partRect(a, 'main'), 'right'))
    expect(g.end).toEqual({ x: 600, y: 80 })
  })

  it('直線與曲線樣式', () => {
    const ends = [
      { node: 'a', part: 'main' },
      { node: 'b', part: 'main' },
    ] as const
    const straight = edgeGeometry(
      [a, b],
      edge(ends[0], ends[1], { style: { ...DEFAULT_EDGE_STYLE, shape: 'straight' } }),
    )!
    expect(straight.d).toBe('M240 80 L400 80')
    const curved = edgeGeometry(
      [a, b],
      edge(ends[0], ends[1], { style: { ...DEFAULT_EDGE_STYLE, shape: 'curved' } }),
    )!
    expect(curved.d).toMatch(/^M240 80 C/)
    expect(curved.label).toEqual({ x: 320, y: 80 })
    // 標籤位置：25% 處
    const quarter = edgeGeometry(
      [a, b],
      edge(ends[0], ends[1], { style: { ...DEFAULT_EDGE_STYLE, shape: 'straight', labelPos: 25 } }),
    )!
    expect(quarter.label).toEqual({ x: 280, y: 80 })
  })

  it('固定在 1/4 位置的端點', () => {
    const g = edgeGeometry(
      [a, b],
      edge(
        { node: 'a', part: 'main', side: 'right', pos: 0.25 },
        { node: 'b', part: 'main', side: 'left', pos: 0.25 },
      ),
    )!
    expect(g.start).toEqual({ x: 240, y: 40 })
    expect(g.end).toEqual({ x: 400, y: 40 })
  })

  it('A→B 與 B→A 都自動選邊時錯開成兩條平行線', () => {
    const ab = { ...edge({ node: 'a', part: 'main' }, { node: 'b', part: 'main' }), id: 'ab' }
    const ba = { ...edge({ node: 'b', part: 'main' }, { node: 'a', part: 'main' }), id: 'ba' }
    const g = layoutEdges([a, b], [ab, ba])
    expect(g.get('ab')!.points).toEqual([
      { x: 240, y: 56 },
      { x: 400, y: 56 },
    ])
    expect(g.get('ba')!.points).toEqual([
      { x: 400, y: 104 },
      { x: 240, y: 104 },
    ])
    // 只有一條時維持原本的中線
    expect(layoutEdges([a, b], [ab]).get('ab')!.start).toEqual({ x: 240, y: 80 })
  })

  it('端點元件不存在時為 undefined', () => {
    expect(edgePoints([a], edge({ node: 'a', part: 'main' }, { node: 'x', part: 'main' }))).toBe(
      undefined,
    )
  })

  it('hitPart：分辨主圖形與強調塊，後畫的優先', () => {
    expect(hitPart([acc], { x: 300, y: 350 })).toEqual({ node: 'c', part: 'accent' })
    expect(hitPart([acc], { x: 10, y: 350 })).toEqual({ node: 'c', part: 'main' })
    expect(hitPart([a, { ...b, x: 20 }], { x: 30, y: 30 })).toEqual({ node: 'b', part: 'main' })
    expect(hitPart([a], { x: 500, y: 500 })).toBeUndefined()
  })
})

describe('snapMove：一律落在格點上', () => {
  it('對齊格點；與其他元件同一條線時回傳參考線', () => {
    const r = snapMove(rect(203, 307), [rect(200, 0)], GRID)
    expect(r).toMatchObject({ x: 200, y: 300 })
    expect(r.guides).toEqual([
      { axis: 'x', pos: 200, from: 0, to: 400 },
      { axis: 'x', pos: 250, from: 0, to: 400 },
      { axis: 'x', pos: 300, from: 0, to: 400 },
    ])
  })

  it('不會為了對齊其他元件而停在格點之間', () => {
    // 另一個元件不在格點上（例如舊檔案）：仍然落在格點，不出現參考線
    const r = snapMove(rect(203, 300), [rect(205, 0)], GRID)
    expect(r.x).toBe(200)
    expect(r.guides).toEqual([])
  })
})

describe('元件與外框', () => {
  it('強調塊只有矩形有', () => {
    const n = { ...newNode('a', 0, 0), accent: '門檻' }
    expect(nodeWidth(n)).toBe(400)
    expect(nodeWidth({ ...n, style: { ...n.style, shape: 'ellipse' } })).toBe(240)
  })

  it('各形狀的預設尺寸都是格點的倍數', () => {
    for (const shape of ['rect', 'ellipse', 'diamond', 'cylinder', 'hexagon'] as const) {
      const n = newNode('a', 0, 0, shape)
      expect(n.w % GRID).toBe(0)
      expect(n.h % GRID).toBe(0)
      expect(n.style.shape).toBe(shape)
    }
  })

  it('bounds 含強調塊與自由端點；什麼都沒有時給預設區域', () => {
    const n = { ...newNode('a', 100, 100), accent: '門檻' }
    expect(bounds([n, newNode('b', 0, 400)])).toEqual({ x: 0, y: 100, w: 500, h: 460 })
    expect(bounds([n], [edge({ node: 'a', part: 'main' }, { x: 900, y: 0 })])).toEqual({
      x: 100,
      y: 0,
      w: 800,
      h: 260,
    })
    expect(bounds([])).toEqual({ x: 0, y: 0, w: 800, h: 450 })
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

  it('範例的元件位置與尺寸都在格點上', () => {
    for (const d of Object.values(doc.diagrams))
      for (const n of d.nodes)
        for (const v of [n.x, n.y, n.w, n.h, n.accentW]) expect(v % GRID).toBe(0)
  })

  it('moveNode 對齊格點；位置沒變時回傳同一份文件', () => {
    const next = applyOp(doc, { type: 'moveNode', diagram: 'm1', node: 'in', x: 123, y: -50 })
    expect(next.diagrams.m1!.nodes.find((n) => n.id === 'in')).toMatchObject({ x: 120, y: -40 })
    expect(applyOp(doc, { type: 'moveNode', diagram: 'm1', node: 'in', x: 4, y: 296 })).toBe(doc)
  })

  it('updateNode 合併樣式，不覆蓋其他樣式欄位', () => {
    const next = applyOp(doc, {
      type: 'updateNode',
      diagram: 'm1',
      node: 'in',
      patch: { style: { fill: '#ffffff', radius: 12 } },
    })
    const n = next.diagrams.m1!.nodes.find((x) => x.id === 'in')!
    expect(n.style).toEqual({ ...DEFAULT_NODE_STYLE, fill: '#ffffff', radius: 12 })
  })

  it('removeNode 一併刪除相連的線與整棵細部圖', () => {
    expect(subtree(doc, 'ai')).toEqual(['ai', 'm1'])
    const next = applyOp(doc, { type: 'removeNode', diagram: 'system', node: 'ai' })
    expect(next.diagrams.ai).toBeUndefined()
    expect(next.diagrams.m1).toBeUndefined()
    expect(next.diagrams.system!.edges).toHaveLength(4)
  })

  it('addEdge：可接自由端點；不接同一塊、不重複、元件要存在', () => {
    const add = (from: EdgeEnd, to: EdgeEnd) =>
      applyOp(doc, { type: 'addEdge', diagram: 'm1', edge: newEdge('x', from, to) })
    const main = (node: string) => ({ node, part: 'main' as const })
    expect(add(main('in'), main('in'))).toBe(doc)
    expect(add(main('in'), main('quality'))).toBe(doc) // 範例已有這條
    expect(add(main('in'), main('nope'))).toBe(doc)
    expect(add({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(doc)
    expect(add(main('in'), main('out')).diagrams.m1!.edges).toHaveLength(9)
    expect(add(main('in'), { x: 0, y: 900 }).diagrams.m1!.edges).toHaveLength(9)
  })

  it('sameEnd 區分邊與自由端點', () => {
    expect(sameEnd({ node: 'a', part: 'main' }, { node: 'a', part: 'main', side: 'top' })).toBe(
      false,
    )
    expect(sameEnd({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true)
    expect(
      sameEnd(
        { node: 'a', part: 'main', side: 'top', pos: 0.25 },
        { node: 'a', part: 'main', side: 'top' },
      ),
    ).toBe(false)
    expect(sameEnd({ x: 1, y: 2 }, { node: 'a', part: 'main' })).toBe(false)
  })

  it('createChild 建立細部圖並連到元件；已有細部圖時不動', () => {
    const next = applyOp(doc, { type: 'createChild', diagram: 'm1', node: 'in', childId: 'd-1' })
    expect(next.diagrams.m1!.nodes.find((n) => n.id === 'in')!.child).toBe('d-1')
    expect(next.diagrams['d-1']).toMatchObject({ title: '影像輸入', level: 'L5 細部' })
    expect(
      applyOp(doc, { type: 'createChild', diagram: 'system', node: 'ai', childId: 'd-2' }),
    ).toBe(doc)
  })

  it('nextLevel', () => {
    expect(nextLevel('L2 容器')).toBe('L3 元件')
    expect(nextLevel('自訂')).toBe('自訂')
  })

  it('freeSpot：在指定位置附近的格點上，且與既有元件留一格不重疊', () => {
    const d = doc.diagrams.m1!
    const { x, y } = freeSpot(d, { x: 500, y: 380 })
    expect(x % GRID).toBe(0)
    expect(y % GRID).toBe(0)
    const placed = nodeBox(newNode('new', x, y))
    for (const n of d.nodes) expect(overlaps(placed, nodeBox(n), GRID)).toBe(false)
    expect(freeSpot({ ...d, nodes: [] }, { x: 120, y: 80 })).toEqual({ x: 0, y: 0 })
  })
})

describe('pathTo', () => {
  it('從最上層一路到細部圖', () => {
    const doc = sampleDoc()
    expect(pathTo(doc, 'm1').map((p) => p.diagram.id)).toEqual(['system', 'ai', 'm1'])
    expect(pathTo(doc, 'nope').map((p) => p.diagram.id)).toEqual(['system'])
  })
})

describe('parseDoc', () => {
  it('範例來回 JSON 不變', () => {
    const doc = sampleDoc()
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })

  it('舊格式：補樣式預設值、位置與尺寸對齊格點、丟掉多的欄位', () => {
    const raw = {
      version: 1,
      root: 'r',
      diagrams: {
        r: {
          title: 'R',
          badge: '舊版欄位',
          nodes: [
            { id: 'a', title: 'A', x: 33, y: 47, w: 250, child: 'missing' },
            { id: 'b', w: 5 },
          ],
          edges: [
            { from: { node: 'a' }, to: { node: 'b', part: 'accent' }, route: 'weird' },
            { from: { node: 'a' }, to: { node: 'ghost' } },
            { from: { node: 'a', side: 'top', pos: 0.25 }, to: { x: 101, y: 9 } },
          ],
        },
      },
    }
    const doc: ArchDoc = parseDoc(raw)
    const r = doc.diagrams.r!
    expect(Object.keys(r).sort()).toEqual(['edges', 'id', 'level', 'nodes', 'title'])
    expect(r.nodes[0]).toMatchObject({ x: 40, y: 40, w: 260, h: 160, style: DEFAULT_NODE_STYLE })
    expect(r.nodes[0]!.child).toBeUndefined()
    expect(r.nodes[1]!.w).toBe(40)
    expect(r.edges).toHaveLength(2)
    expect(r.edges[0]).toMatchObject({ route: 'auto', style: DEFAULT_EDGE_STYLE })
    expect(r.edges[1]).toMatchObject({
      from: { node: 'a', part: 'main', side: 'top', pos: 0.25 },
      to: { x: 100, y: 0 },
    })
  })

  it('樣式值不合法時用預設值', () => {
    const raw = {
      version: 1,
      root: 'r',
      diagrams: {
        r: {
          nodes: [
            { id: 'a', style: { shape: 'star', fill: 'red', stroke: 'none', titleSize: 999 } },
          ],
          edges: [],
        },
      },
    }
    const s = parseDoc(raw).diagrams.r!.nodes[0]!.style
    expect(s).toMatchObject({ shape: 'rect', fill: DEFAULT_NODE_STYLE.fill, stroke: 'none' })
    expect(s.titleSize).toBe(72)
  })

  it('結構不對時丟出中文錯誤', () => {
    expect(() => parseDoc(null)).toThrow('缺少 diagrams')
    expect(() => parseDoc({ version: 2, diagrams: {} })).toThrow('不支援的版本')
    expect(() => parseDoc({ version: 1, root: 'x', diagrams: {} })).toThrow('root')
  })
})

describe('toMermaid', () => {
  it('元件、形狀、強調塊與連線標籤', () => {
    const text = toMermaid(sampleDoc().diagrams.system!)
    expect(text).toContain('flowchart LR')
    expect(text).toContain('n_api["API<br/>Go 主伺服器<br/>〔唯一寫入〕"]')
    expect(text).toContain('n_db[("DATA<br/>資料庫")]')
    expect(text).toContain('n_app -->|"REST"| n_api')
  })

  it('id 只留英數底線並避免重複；虛線、雙向、起點箭頭；略過自由端點', () => {
    const style = (s: Partial<typeof DEFAULT_EDGE_STYLE>) => ({ ...DEFAULT_EDGE_STYLE, ...s })
    const main = (node: string) => ({ node, part: 'main' as const })
    const d = {
      id: 'x',
      level: '',
      title: 'X',
      nodes: [
        { ...newNode('a-b', 0, 0), title: '說"明"' },
        { ...newNode('a_b', 0, 400, 'diamond'), title: 'B' },
      ],
      edges: [
        {
          ...newEdge('1', main('a-b'), main('a_b')),
          label: 'a|b',
          style: style({ dash: 'dashed' }),
        },
        { ...newEdge('2', main('a-b'), main('a_b')), style: style({ arrow: 'both' }) },
        { ...newEdge('3', main('a-b'), main('a_b')), style: style({ arrow: 'start' }) },
        newEdge('4', main('a-b'), { x: 0, y: 0 }),
      ],
    }
    const text = toMermaid(d)
    expect(text).toContain('flowchart TB')
    expect(text).toContain('n_a_b["說#quot;明#quot;"]')
    expect(text).toContain('n_a_b_2{"B"}')
    expect(text).toContain('n_a_b -.->|"a#124;b"| n_a_b_2')
    expect(text).toContain('n_a_b <--> n_a_b_2')
    expect(text).toContain('n_a_b_2 --> n_a_b')
    expect(text.trim().split('\n')).toHaveLength(7)
  })
})
