// 架構圖的幾何：元件各塊的矩形、連線的折線路徑（直角＋圓角）、命中測試、文字寬度估計。
import {
  type ArchEdge,
  type ArchNode,
  type EdgeEnd,
  hasAccent,
  type Part,
  type Route,
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
export const CORNER_RADIUS = 18

/** 元件某一塊的矩形；沒有強調塊時一律回傳主方塊。 */
export function partRect(n: ArchNode, part: Part): Rect {
  if (part === 'accent' && hasAccent(n)) return { x: n.x + n.w, y: n.y, w: n.accentW, h: n.h }
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

const cx = (r: Rect) => r.x + r.w / 2
const cy = (r: Rect) => r.y + r.h / 2

/** 兩個區間的重疊 [lo, hi]；不重疊時 lo > hi。 */
function overlap(a0: number, a1: number, b0: number, b1: number): [number, number] {
  return [Math.max(a0, b0), Math.min(a1, b1)]
}

/**
 * 連線的折線端點（起點在 s 的邊上、終點在 t 的邊上）。
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
    // t 的中線要在 s 的左右兩側之外，且 t 在 s 的上方或下方
    const tx = cx(t)
    if ((tx > s.x + s.w || tx < s.x) && (tBelow || tAbove)) {
      const sy = cy(s)
      const startX = tx > s.x + s.w ? s.x + s.w : s.x
      return [
        { x: startX, y: sy },
        { x: tx, y: sy },
        { x: tx, y: tBelow ? t.y : t.y + t.h },
      ]
    }
  }

  if (route === 'vh') {
    const ty = cy(t)
    if ((ty > s.y + s.h || ty < s.y) && (tRight || tLeft)) {
      const sx = cx(s)
      const startY = ty > s.y + s.h ? s.y + s.h : s.y
      return [
        { x: sx, y: startY },
        { x: sx, y: ty },
        { x: tRight ? t.x : t.x + t.w, y: ty },
      ]
    }
  }

  // 指定的 L 形走不通（例如兩塊在同一列）：改用自動路線
  if (route !== 'auto') return routePoints(s, t, 'auto')

  // Z 形：水平距離較大時左右出入、在水平中點轉彎；否則上下出入
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

/** 去掉重複點與共線的中間點（避免零長度線段造成怪異的圓角）。 */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of points) {
    const b = out.at(-1)
    if (b && b.x === p.x && b.y === p.y) continue
    const a = out.at(-2)
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) out.pop()
    out.push(p)
  }
  return out
}

/** 相鄰兩點組成的線段。 */
function segments(pts: Pt[]): [Pt, Pt][] {
  return pts.slice(1).map((p, i) => [pts[i]!, p])
}

/** 直角折線轉成 SVG path，轉角以二次曲線畫圓角（半徑不超過相鄰線段的一半）。 */
export function roundedPath(points: Pt[], radius = CORNER_RADIUS): string {
  const pts = simplify(points)
  const first = pts[0]
  const last = pts.at(-1)
  if (!first || !last) return ''
  const f = (v: number) => Math.round(v * 10) / 10
  let d = `M${f(first.x)} ${f(first.y)}`
  const segs = segments(pts)
  // 每個轉角由「進入的線段」與「離開的線段」決定
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
    d += ` L${f(a.x)} ${f(a.y)} Q${f(cur.x)} ${f(cur.y)} ${f(b.x)} ${f(b.y)}`
  }
  return `${d} L${f(last.x)} ${f(last.y)}`
}

/** 折線上最長一段的中點（放連線標籤）。 */
export function labelPoint(points: Pt[]): Pt {
  const pts = simplify(points)
  let best = { len: -1, p: pts[0] ?? { x: 0, y: 0 } }
  for (const [a, b] of segments(pts)) {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > best.len) best = { len, p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }
  return best.p
}

/** 連線的折線；任一端的元件不存在時回傳 undefined。 */
export function edgePoints(nodes: ArchNode[], e: ArchEdge): Pt[] | undefined {
  const s = nodes.find((n) => n.id === e.from.node)
  const t = nodes.find((n) => n.id === e.to.node)
  if (!s || !t) return undefined
  return routePoints(partRect(s, e.from.part), partRect(t, e.to.part), e.route)
}

/** 點落在哪個元件的哪一塊（後畫的元件在上層，優先命中）。 */
export function hitPart(nodes: ArchNode[], p: Pt): EdgeEnd | undefined {
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
  minSize = 14,
  letterSpacing = 0,
): number {
  const w = textWidth(text, size, letterSpacing)
  if (w <= maxWidth || w === 0) return size
  return Math.max(minSize, Math.floor((size * maxWidth) / w))
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
 * 拖曳中的元件吸附位置：每一軸各自判斷。
 * 1. 元件的左／中／右（上／中／下）與其他元件的左／中／右在 threshold 內 → 對齊該元件，並回傳參考線。
 * 2. 否則對齊格點。
 * threshold 以畫布座標計（呼叫端依縮放換算，畫面上約 6 px）。
 */
export function snapMove(
  moving: Rect,
  others: Rect[],
  threshold: number,
  grid: number,
): { x: number; y: number; guides: Guide[] } {
  const guides: Guide[] = []
  const axis = (a: 'x' | 'y') => {
    const pos = a === 'x' ? moving.x : moving.y
    const size = a === 'x' ? moving.w : moving.h
    let best: { delta: number; line: number } | undefined
    for (const o of others) {
      const opos = a === 'x' ? o.x : o.y
      const osize = a === 'x' ? o.w : o.h
      for (const mine of [0, size / 2, size]) {
        for (const theirs of [0, osize / 2, osize]) {
          const delta = opos + theirs - (pos + mine)
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta)))
            best = { delta, line: opos + theirs }
        }
      }
    }
    if (!best) return Math.round(pos / grid) * grid
    const snapped = pos + best.delta
    // 參考線畫過所有在這條線上的元件
    const line = best.line
    const span = [moving, ...others].filter((r) => {
      const p = a === 'x' ? r.x : r.y
      const s = a === 'x' ? r.w : r.h
      const shift = r === moving ? best.delta : 0
      return [p + shift, p + shift + s / 2, p + shift + s].some((v) => Math.abs(v - line) < 0.5)
    })
    const lo = Math.min(...span.map((r) => (a === 'x' ? r.y : r.x)))
    const hi = Math.max(...span.map((r) => (a === 'x' ? r.y + r.h : r.x + r.w)))
    guides.push({ axis: a, pos: line, from: lo, to: hi })
    return snapped
  }
  const x = axis('x')
  const y = axis('y')
  return { x, y, guides }
}
