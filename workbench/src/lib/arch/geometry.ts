// 架構圖的幾何：元件各塊的矩形、定位點、連線路徑（直角＋圓角、直線、曲線）、命中測試、
// 拖曳吸附、文字寬度估計。
import {
  ANCHOR_POSITIONS,
  type ArchEdge,
  type ArchNode,
  type EdgeEnd,
  hasAccent,
  isNodeEnd,
  type NodeEnd,
  type NodeShapeKind,
  type Part,
  type Route,
  type Side,
} from './model'

export interface Pt {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 兩個元件之間要有這麼多重疊（px）才畫成直線，否則畫折線。 */
export const MIN_OVERLAP = 12

/** 折線轉角的圓角半徑（px）。 */
export const CORNER_RADIUS = 14

/** 從定位點垂直伸出的最短距離（px），讓折線不會貼著圖形邊緣轉彎。 */
export const STUB = 20

export const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

/** 各邊的外法線方向。 */
export const NORMAL: Record<Side, Pt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

/** 元件某一塊的矩形；沒有強調塊時一律回傳主圖形。 */
export function partRect(n: ArchNode, part: Part): Rect {
  if (part === 'accent' && hasAccent(n)) return { x: n.x + n.w, y: n.y, w: n.accentW, h: n.h }
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

const cx = (r: Rect) => r.x + r.w / 2
const cy = (r: Rect) => r.y + r.h / 2

/** 元件某一塊的形狀（強調塊一律是矩形）。 */
export function partShape(n: ArchNode, part: Part): NodeShapeKind {
  return part === 'accent' && hasAccent(n) ? 'rect' : n.style.shape
}

/**
 * 某一邊上的定位點：沿著外框那一邊取 pos（0＝上／左端、1＝下／右端）的位置，
 * 再投影到圖形的實際輪廓上（橢圓、菱形、六角形、圓柱的頂底面不是直線）。
 */
export function anchorPoint(r: Rect, side: Side, pos = 0.5, shape: NodeShapeKind = 'rect'): Pt {
  const hw = r.w / 2
  const hh = r.h / 2
  if (side === 'top' || side === 'bottom') {
    const x = r.x + pos * r.w
    const u = Math.min(1, Math.abs(x - cx(r)) / hw) // 0＝中線、1＝左右端
    let dy = hh // 輪廓到中線的垂直距離
    if (shape === 'ellipse') dy = hh * Math.sqrt(1 - u * u)
    else if (shape === 'diamond') dy = hh * (1 - u)
    else if (shape === 'hexagon') {
      const inset = Math.min(r.w * 0.22, hh)
      const fromEnd = hw - Math.abs(x - cx(r))
      dy = fromEnd >= inset ? hh : hh * (fromEnd / inset)
    } else if (shape === 'cylinder') {
      const ry = Math.min(r.h * 0.12, 22)
      dy = hh - ry + ry * Math.sqrt(1 - u * u)
    }
    return { x, y: side === 'top' ? cy(r) - dy : cy(r) + dy }
  }
  const y = r.y + pos * r.h
  const v = Math.min(1, Math.abs(y - cy(r)) / hh)
  let dx = hw
  if (shape === 'ellipse') dx = hw * Math.sqrt(1 - v * v)
  else if (shape === 'diamond') dx = hw * (1 - v)
  else if (shape === 'hexagon') dx = hw - Math.min(r.w * 0.22, hh) * v
  return { x: side === 'left' ? cx(r) - dx : cx(r) + dx, y }
}

export interface Anchor {
  part: Part
  side: Side
  pos: number
  pt: Pt
}

/**
 * 元件的所有定位點：每一邊 1/4、中點、3/4 三個（太短的邊只有中點）；
 * 主圖形與強調塊相接的那一邊不算。
 */
export function nodeAnchors(n: ArchNode): Anchor[] {
  const out: Anchor[] = []
  const accent = hasAccent(n)
  const add = (part: Part, side: Side) => {
    const r = partRect(n, part)
    const len = side === 'top' || side === 'bottom' ? r.w : r.h
    for (const pos of len >= 80 ? ANCHOR_POSITIONS : [0.5]) {
      out.push({ part, side, pos, pt: anchorPoint(r, side, pos, partShape(n, part)) })
    }
  }
  for (const side of SIDES) if (!(accent && side === 'right')) add('main', side)
  if (accent) for (const side of SIDES) if (side !== 'left') add('accent', side)
  return out
}

/** 定位點轉成連線端點（中點不寫 pos）。 */
export function anchorEnd(node: string, a: Anchor): NodeEnd {
  return a.pos === 0.5
    ? { node, part: a.part, side: a.side }
    : { node, part: a.part, side: a.side, pos: a.pos }
}

/** 離 p 最近、且在 maxDist 內的定位點。 */
export function nearestAnchor(
  nodes: ArchNode[],
  p: Pt,
  maxDist: number,
): { node: string; anchor: Anchor } | undefined {
  let best: { node: string; anchor: Anchor; d: number } | undefined
  for (const n of nodes)
    for (const a of nodeAnchors(n)) {
      const d = Math.hypot(a.pt.x - p.x, a.pt.y - p.y)
      if (d <= maxDist && (!best || d < best.d)) best = { node: n.id, anchor: a, d }
    }
  return best && { node: best.node, anchor: best.anchor }
}

/** 兩個區間的重疊 [lo, hi]；不重疊時 lo > hi。 */
function overlap(a0: number, a1: number, b0: number, b1: number): [number, number] {
  return [Math.max(a0, b0), Math.min(a1, b1)]
}

/**
 * 兩端都「自動選邊」時的直角折線（起點在 s 的邊上、終點在 t 的邊上）。
 * - 兩塊在同一列（垂直方向重疊夠多）：水平直線，高度取重疊區中點。
 * - 兩塊在同一欄（水平方向重疊夠多）：垂直直線。
 * - hv：從 s 的左／右側出去，水平走到 t 的中線，再垂直進入 t 的上／下緣。
 * - vh：從 s 的上／下緣出去，垂直走到 t 的中線，再水平進入 t 的左／右側。
 * - L 形走不通時改用 auto；auto 不在同列同欄時畫 Z 形，沿距離較大的方向出去、在中點轉彎。
 */
export function routePoints(s: Rect, t: Rect, route: Route): Pt[] {
  const [oyLo, oyHi] = overlap(s.y, s.y + s.h, t.y, t.y + t.h)
  const [oxLo, oxHi] = overlap(s.x, s.x + s.w, t.x, t.x + t.w)
  const tRight = t.x >= s.x + s.w
  const tLeft = t.x + t.w <= s.x
  const tBelow = t.y >= s.y + s.h
  const tAbove = t.y + t.h <= s.y

  if (route === 'auto') {
    if (oyHi - oyLo >= MIN_OVERLAP && (tRight || tLeft)) {
      const y = (oyLo + oyHi) / 2
      return tRight
        ? [
            { x: s.x + s.w, y },
            { x: t.x, y },
          ]
        : [
            { x: s.x, y },
            { x: t.x + t.w, y },
          ]
    }
    if (oxHi - oxLo >= MIN_OVERLAP && (tBelow || tAbove)) {
      const x = (oxLo + oxHi) / 2
      return tBelow
        ? [
            { x, y: s.y + s.h },
            { x, y: t.y },
          ]
        : [
            { x, y: s.y },
            { x, y: t.y + t.h },
          ]
    }
  }

  if (route === 'hv') {
    const tx = cx(t)
    if ((tx > s.x + s.w || tx < s.x) && (tBelow || tAbove)) {
      const sy = cy(s)
      return [
        { x: tx > s.x + s.w ? s.x + s.w : s.x, y: sy },
        { x: tx, y: sy },
        { x: tx, y: tBelow ? t.y : t.y + t.h },
      ]
    }
  }

  if (route === 'vh') {
    const ty = cy(t)
    if ((ty > s.y + s.h || ty < s.y) && (tRight || tLeft)) {
      const sx = cx(s)
      return [
        { x: sx, y: ty > s.y + s.h ? s.y + s.h : s.y },
        { x: sx, y: ty },
        { x: tRight ? t.x : t.x + t.w, y: ty },
      ]
    }
  }

  if (route !== 'auto') return routePoints(s, t, 'auto')

  const gapX = tRight ? t.x - (s.x + s.w) : tLeft ? s.x - (t.x + t.w) : -1
  const gapY = tBelow ? t.y - (s.y + s.h) : tAbove ? s.y - (t.y + t.h) : -1
  if (gapX >= gapY && gapX >= 0) {
    const x0 = tRight ? s.x + s.w : s.x
    const x1 = tRight ? t.x : t.x + t.w
    const mx = (x0 + x1) / 2
    return [
      { x: x0, y: cy(s) },
      { x: mx, y: cy(s) },
      { x: mx, y: cy(t) },
      { x: x1, y: cy(t) },
    ]
  }
  if (gapY >= 0) {
    const y0 = tBelow ? s.y + s.h : s.y
    const y1 = tBelow ? t.y : t.y + t.h
    const my = (y0 + y1) / 2
    return [
      { x: cx(s), y: y0 },
      { x: cx(s), y: my },
      { x: cx(t), y: my },
      { x: cx(t), y: y1 },
    ]
  }
  // 兩塊互相重疊：直接連中心
  return [
    { x: cx(s), y: cy(s) },
    { x: cx(t), y: cy(t) },
  ]
}

/** 自動選邊：矩形朝向 o 的那一邊（依寬高比例判斷水平或垂直）。 */
export function facingSide(r: Rect, o: Pt): Side {
  const dx = o.x - cx(r)
  const dy = o.y - cy(r)
  if (Math.abs(dx) * Math.max(r.h, 1) >= Math.abs(dy) * Math.max(r.w, 1))
    return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

/** 點落在矩形的哪一邊（最近的那邊）。 */
export function sideOfPoint(r: Rect, p: Pt): Side {
  const d: Record<Side, number> = {
    top: Math.abs(p.y - r.y),
    bottom: Math.abs(p.y - (r.y + r.h)),
    left: Math.abs(p.x - r.x),
    right: Math.abs(p.x - (r.x + r.w)),
  }
  return SIDES.reduce((a, b) => (d[b] < d[a] ? b : a))
}

/** 自由端點的出線方向：朝另一端、沿距離較大的軸。 */
function towards(p: Pt, o: Pt): Pt {
  const dx = o.x - p.x
  const dy = o.y - p.y
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) }
}

/**
 * 依兩端的出線方向畫直角折線：先各自沿方向伸出 STUB，再以 L 形或 Z 形接起來。
 * dS 為起點的出線方向，dT 為終點「往外」的方向（箭頭從反方向進入）。
 */
export function orthoRoute(p: Pt, dS: Pt, q: Pt, dT: Pt, stub = STUB): Pt[] {
  const p1 = { x: p.x + dS.x * stub, y: p.y + dS.y * stub }
  const q1 = { x: q.x + dT.x * stub, y: q.y + dT.y * stub }
  const sH = dS.x !== 0
  const tH = dT.x !== 0
  let mid: Pt[]
  if (sH && tH) {
    const mx = (p1.x + q1.x) / 2
    mid = [
      { x: mx, y: p1.y },
      { x: mx, y: q1.y },
    ]
  } else if (!sH && !tH) {
    const my = (p1.y + q1.y) / 2
    mid = [
      { x: p1.x, y: my },
      { x: q1.x, y: my },
    ]
  } else if (sH) {
    mid = [{ x: q1.x, y: p1.y }]
  } else {
    mid = [{ x: p1.x, y: q1.y }]
  }
  return simplify([p, p1, ...mid, q1, q])
}

/** 去掉重複點與共線的中間點（避免零長度線段造成怪異的圓角）。 */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of points) {
    const b = out.at(-1)
    if (b && b.x === p.x && b.y === p.y) continue
    const a = out.at(-2)
    // 同一直線上（同 x 或同 y）的中間點拿掉，但折返（方向相反）時保留
    if (a && b) {
      const sameX = a.x === b.x && b.x === p.x
      const sameY = a.y === b.y && b.y === p.y
      const forward = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) > 0
      if ((sameX || sameY) && forward) out.pop()
    }
    out.push(p)
  }
  return out
}

/** 相鄰兩點組成的線段。 */
function segments(pts: Pt[]): [Pt, Pt][] {
  return pts.slice(1).map((p, i) => [pts[i]!, p])
}

const f1 = (v: number) => Math.round(v * 10) / 10

/** 直角折線轉成 SVG path，轉角以二次曲線畫圓角（半徑不超過相鄰線段的一半）。 */
export function roundedPath(points: Pt[], radius = CORNER_RADIUS): string {
  const pts = simplify(points)
  const first = pts[0]
  const last = pts.at(-1)
  if (!first || !last) return ''
  let d = `M${f1(first.x)} ${f1(first.y)}`
  const segs = segments(pts)
  for (let i = 0; i < segs.length - 1; i++) {
    const [prev, cur] = segs[i]!
    const next = segs[i + 1]![1]
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const a = {
      x: cur.x - ((cur.x - prev.x) / inLen) * r,
      y: cur.y - ((cur.y - prev.y) / inLen) * r,
    }
    const b = {
      x: cur.x + ((next.x - cur.x) / outLen) * r,
      y: cur.y + ((next.y - cur.y) / outLen) * r,
    }
    d += ` L${f1(a.x)} ${f1(a.y)} Q${f1(cur.x)} ${f1(cur.y)} ${f1(b.x)} ${f1(b.y)}`
  }
  return `${d} L${f1(last.x)} ${f1(last.y)}`
}

/** 折線上、從起點算起全長 t（0–1）處的點（放連線標籤）。 */
export function pointAlong(points: Pt[], t: number): Pt {
  const pts = simplify(points)
  const segs = segments(pts)
  const total = segs.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)
  let left = Math.min(1, Math.max(0, t)) * total
  for (const [a, b] of segs) {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (left <= len && len > 0)
      return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len }
    left -= len
  }
  return pts.at(-1) ?? { x: 0, y: 0 }
}

export interface EdgeGeometry {
  /** SVG path */
  d: string
  /** 折線的點（曲線與直線只有兩端） */
  points: Pt[]
  start: Pt
  end: Pt
  /** 標籤位置 */
  label: Pt
}

/** 端點解析：位置、出線方向（undefined 表示還沒決定）、所在矩形。 */
interface Resolved {
  pt: Pt
  dir?: Pt
  rect?: Rect
  auto: boolean
}

function resolveEnd(nodes: ArchNode[], end: EdgeEnd): Resolved | undefined {
  if (!isNodeEnd(end)) return { pt: { x: end.x, y: end.y }, auto: false }
  const n = nodes.find((m) => m.id === end.node)
  if (!n) return undefined
  const rect = partRect(n, end.part)
  if (end.side) {
    const pt = anchorPoint(rect, end.side, end.pos ?? 0.5, partShape(n, end.part))
    return { pt, dir: NORMAL[end.side], rect, auto: false }
  }
  return { pt: { x: cx(rect), y: cy(rect) }, rect, auto: true }
}

/** 一條連線的幾何；任一端的元件不存在時回傳 undefined。 */
export function edgeGeometry(nodes: ArchNode[], e: ArchEdge): EdgeGeometry | undefined {
  const s = resolveEnd(nodes, e.from)
  const t = resolveEnd(nodes, e.to)
  if (!s || !t) return undefined

  let points: Pt[]
  if (s.auto && t.auto && s.rect && t.rect) {
    // 兩端都自動：沿用依位置判斷的直線／L 形／Z 形
    points = routePoints(s.rect, t.rect, e.route)
    s.pt = points[0]!
    t.pt = points.at(-1)!
    s.dir = NORMAL[sideOfPoint(s.rect, s.pt)]
    t.dir = NORMAL[sideOfPoint(t.rect, t.pt)]
  } else {
    // 自動的那端改成朝向另一端的那一邊
    for (const [me, other] of [
      [s, t],
      [t, s],
    ] as const) {
      if (me.auto && me.rect) {
        const side = facingSide(me.rect, other.pt)
        const end = (me === s ? e.from : e.to) as NodeEnd
        const n = nodes.find((m) => m.id === end.node)!
        me.pt = anchorPoint(me.rect, side, 0.5, partShape(n, end.part))
        me.dir = NORMAL[side]
      }
    }
    s.dir ??= towards(s.pt, t.pt)
    t.dir ??= towards(t.pt, s.pt)
    points = orthoRoute(s.pt, s.dir, t.pt, t.dir)
  }

  const start = s.pt
  const end = t.pt
  const lt = e.style.labelPos / 100
  if (e.style.shape === 'straight') {
    return {
      d: `M${f1(start.x)} ${f1(start.y)} L${f1(end.x)} ${f1(end.y)}`,
      points: [start, end],
      start,
      end,
      label: { x: start.x + (end.x - start.x) * lt, y: start.y + (end.y - start.y) * lt },
    }
  }
  if (e.style.shape === 'curved') {
    const k = Math.min(160, Math.max(30, Math.hypot(end.x - start.x, end.y - start.y) * 0.4))
    const c1 = { x: start.x + s.dir!.x * k, y: start.y + s.dir!.y * k }
    const c2 = { x: end.x + t.dir!.x * k, y: end.y + t.dir!.y * k }
    return {
      d: `M${f1(start.x)} ${f1(start.y)} C${f1(c1.x)} ${f1(c1.y)} ${f1(c2.x)} ${f1(c2.y)} ${f1(end.x)} ${f1(end.y)}`,
      points: [start, end],
      start,
      end,
      label: bezier(start, c1, c2, end, lt),
    }
  }
  return { d: roundedPath(points), points, start, end, label: pointAlong(points, lt) }
}

/** 三次貝茲曲線參數 t 的位置。 */
function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** 兩端都自動選邊的連線：連的是同一對（元件、塊）時歸成一組（不分方向）。 */
function pairKey(e: ArchEdge): string | undefined {
  const { from, to } = e
  if (!isNodeEnd(from) || !isNodeEnd(to) || from.side || to.side) return undefined
  return [`${from.node}:${from.part}`, `${to.node}:${to.part}`].sort().join('|')
}

/**
 * 整張圖的連線幾何。同一對元件之間有多條自動選邊的連線（例如 A→B 與 B→A）時，
 * 先照自動路線決定兩端的邊，再把它們在邊上錯開（0.35／0.65…），畫成平行線而不重疊。
 */
export function layoutEdges(nodes: ArchNode[], edges: ArchEdge[]): Map<string, EdgeGeometry> {
  const groups = new Map<string, ArchEdge[]>()
  for (const e of edges) {
    const key = pairKey(e)
    if (key) groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const out = new Map<string, EdgeGeometry>()
  for (const e of edges) {
    const key = pairKey(e)
    const group = key ? groups.get(key)! : []
    const g =
      group.length > 1
        ? edgeGeometry(nodes, spread(nodes, e, group.indexOf(e), group.length))
        : edgeGeometry(nodes, e)
    if (g) out.set(e.id, g)
  }
  return out
}

/** 把第 i 條（共 n 條）連線的兩端固定在自動路線選的邊上，位置錯開。 */
function spread(nodes: ArchNode[], e: ArchEdge, i: number, n: number): ArchEdge {
  const base = edgeGeometry(nodes, e)
  const from = e.from as NodeEnd
  const to = e.to as NodeEnd
  const sn = nodes.find((m) => m.id === from.node)
  const tn = nodes.find((m) => m.id === to.node)
  if (!base || !sn || !tn) return e
  const step = Math.min(0.3, 0.8 / n)
  const pos = 0.5 + (i - (n - 1) / 2) * step
  return {
    ...e,
    from: { ...from, side: sideOfPoint(partRect(sn, from.part), base.start), pos },
    to: { ...to, side: sideOfPoint(partRect(tn, to.part), base.end), pos },
  }
}

/** 連線的折線點；任一端的元件不存在時回傳 undefined。 */
export function edgePoints(nodes: ArchNode[], e: ArchEdge): Pt[] | undefined {
  return edgeGeometry(nodes, e)?.points
}

/** 點落在哪個元件的哪一塊（後畫的元件在上層，優先命中）。 */
export function hitPart(nodes: ArchNode[], p: Pt): NodeEnd | undefined {
  for (const n of [...nodes].reverse()) {
    for (const part of ['accent', 'main'] as const) {
      if (part === 'accent' && !hasAccent(n)) continue
      const r = partRect(n, part)
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)
        return { node: n.id, part }
    }
  }
  return undefined
}

// ---------------------------------------------------------------- 吸附

/** 對齊參考線：axis 'x' 為垂直線（位置 pos＝x），從 from 畫到 to（另一軸的範圍）。 */
export interface Guide {
  axis: 'x' | 'y'
  pos: number
  from: number
  to: number
}

/**
 * 拖曳中的元件位置：一律對齊格點（元件永遠落在點點上），
 * 對齊後若與其他元件的左／中／右（上／中／下）在同一條線上，回傳參考線當提示。
 */
export function snapMove(
  moving: Rect,
  others: Rect[],
  grid: number,
): { x: number; y: number; guides: Guide[] } {
  const x = Math.round(moving.x / grid) * grid
  const y = Math.round(moving.y / grid) * grid
  const placed = { ...moving, x, y }
  const guides: Guide[] = []
  for (const a of ['x', 'y'] as const) {
    const lines = (r: Rect) =>
      a === 'x' ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h]
    for (const line of new Set(lines(placed))) {
      const hits = others.filter((o) => lines(o).includes(line))
      if (!hits.length) continue
      const all = [placed, ...hits]
      guides.push({
        axis: a,
        pos: line,
        from: Math.min(...all.map((r) => (a === 'x' ? r.y : r.x))),
        to: Math.max(...all.map((r) => (a === 'x' ? r.y + r.h : r.x + r.w))),
      })
    }
  }
  return { x, y, guides }
}

// ---------------------------------------------------------------- 文字

/**
 * 估計單行文字寬度（px）：SVG 沒有自動換行，也無法在畫之前量字寬，以字元類別近似。
 * 中日韓與全形字約 1em，大寫拉丁約 0.66em，其他半形約 0.56em，空白 0.3em。
 */
export function textWidth(text: string, size: number, letterSpacing = 0): number {
  let w = 0
  for (const ch of text) {
    if (/[⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/.test(ch)) w += 1
    else if (ch === ' ') w += 0.3
    else if (/[A-Z0-9]/.test(ch)) w += 0.66
    else w += 0.56
  }
  return w * size + letterSpacing * [...text].length
}

/** 讓文字塞進 maxWidth 的字級：原字級放得下就用原字級，否則等比縮小，但不小於 minSize。 */
export function fitFontSize(
  text: string,
  size: number,
  maxWidth: number,
  minSize = 10,
  letterSpacing = 0,
): number {
  const w = textWidth(text, size, letterSpacing)
  if (w <= maxWidth || w === 0) return size
  return Math.max(minSize, Math.floor((size * maxWidth) / w))
}
