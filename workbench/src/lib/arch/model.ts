// 專案架構圖的資料模型與編輯操作（純函式，不碰 React 與 DOM）。
//
// 一份文件（ArchDoc）由多張圖（Diagram）組成，像 C4 Model 一樣逐層放大：
// 圖上的元件（ArchNode）可以指向一張「細部圖」（child），點進去看該元件內部的組成或流程。
// 每張圖是一塊無限畫布，座標一律是畫布座標（px）；元件的位置與尺寸一律是 GRID 的整數倍（落在點點上）。
import { DEFAULT_EDGE_STYLE, DEFAULT_NODE_STYLE } from './theme'

/** 點點格子的間距；元件的位置與尺寸都對齊這個單位（px）。 */
export const GRID = 20

/** 元件尺寸的上下限（都是 GRID 的倍數）。 */
export const SIZE_LIMITS = { min: 40, maxW: 900, maxH: 600 } as const

/** 字級上下限。 */
export const FONT_LIMITS = { min: 10, max: 72 } as const

export type NodeShapeKind = 'rect' | 'ellipse' | 'diamond' | 'cylinder' | 'hexagon'

export const SHAPES: { value: NodeShapeKind; label: string }[] = [
  { value: 'rect', label: '矩形' },
  { value: 'ellipse', label: '橢圓' },
  { value: 'diamond', label: '菱形' },
  { value: 'cylinder', label: '圓柱' },
  { value: 'hexagon', label: '六角形' },
]

/** 元件外觀。顏色為 #rrggbb；底色與框線可為 'none'（透明）。 */
export interface NodeStyle {
  shape: NodeShapeKind
  fill: string
  stroke: string
  strokeWidth: number
  /** 圓角（只有矩形有） */
  radius: number
  textColor: string
  kickerColor: string
  accentFill: string
  accentText: string
  titleSize: number
  kickerSize: number
  /** 文字對齊（只有矩形可以靠左，其他形狀一律置中） */
  align: 'left' | 'center'
}

/**
 * 一個元件：主圖形（小標＋標題），矩形還可以在右側附一塊強調色方塊（accent，例如「品質門檻」）。
 * 連線可以接在主圖形或強調塊上（Part），對應參考圖中箭頭從橘色方塊出發的畫法。
 */
export interface ArchNode {
  id: string
  /** 主圖形左上角（畫布座標，GRID 的倍數） */
  x: number
  y: number
  /** 主圖形寬高（GRID 的倍數）；強調塊與主圖形同高、接在右側 */
  w: number
  h: number
  /** 小標（例如「01」「INPUT」），空字串時只顯示標題 */
  kicker: string
  title: string
  /** 強調塊文字；空字串（或非矩形）表示沒有強調塊 */
  accent: string
  accentW: number
  /** 說明：滑過元件時顯示，描述這個元件做什麼、怎麼運作 */
  note: string
  /** 細部圖的 id（C4 的下一層）；沒有時不能點進去 */
  child?: string
  style: NodeStyle
}

/** 連線接在元件的哪一塊。 */
export type Part = 'main' | 'accent'

/** 圖形的四個邊；每邊中點是一個定位點。 */
export type Side = 'top' | 'right' | 'bottom' | 'left'

/** 接在元件上的端點；side 省略時自動選邊（朝向另一端）。 */
export interface NodeEnd {
  node: string
  part: Part
  side?: Side
  /** 在那一邊上的位置（0＝上／左端、1＝下／右端），省略為中點 0.5；只在 side 有值時有意義 */
  pos?: number
}

/** 每一邊的定位點位置（邊長的比例）：中點，以及 1/4、3/4（兩個元件互指時可以各用一個）。 */
export const ANCHOR_POSITIONS = [0.25, 0.5, 0.75] as const

/** 自由端點（沒有接在元件上，畫布座標）。 */
export interface PointEnd {
  x: number
  y: number
}

export type EdgeEnd = NodeEnd | PointEnd

export function isNodeEnd(e: EdgeEnd): e is NodeEnd {
  return 'node' in e
}

/**
 * 轉彎方式（只用在「直角」且兩端都自動選邊時）：
 * - auto：同一列或同一欄時畫直線，否則畫 Z 形折線。
 * - hv：先水平再垂直。 - vh：先垂直再水平。
 */
export type Route = 'auto' | 'hv' | 'vh'

export interface EdgeStyle {
  color: string
  width: number
  dash: 'solid' | 'dashed' | 'dotted'
  /** 箭頭畫在哪一端 */
  arrow: 'end' | 'start' | 'both' | 'none'
  /** 直角折線、直線、曲線 */
  shape: 'orthogonal' | 'straight' | 'curved'
  /** 標籤字級 */
  labelSize: number
  /** 標籤文字顏色；'auto' 為跟線條同色 */
  labelColor: string
  /** 標籤底色；'auto' 為畫布底色（蓋住線），'none' 為透明 */
  labelBg: string
  labelBold: boolean
  /** 標籤沿著線的位置（0＝起點、100＝終點） */
  labelPos: number
}

export interface ArchEdge {
  id: string
  from: EdgeEnd
  to: EdgeEnd
  route: Route
  label: string
  style: EdgeStyle
}

/** 一張圖。 */
export interface Diagram {
  id: string
  /** C4 層級名稱（例如「L2 容器」），顯示在層級路徑旁 */
  level: string
  /** 圖的名稱，顯示在層級路徑上 */
  title: string
  nodes: ArchNode[]
  edges: ArchEdge[]
}

export interface ArchDoc {
  version: 1
  /** 最上層的圖 */
  root: string
  diagrams: Record<string, Diagram>
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 產生短 id（前綴＋8 碼）。 */
export function uid(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `${prefix}-${rand.slice(0, 8)}`
}

export function snap(v: number, grid = GRID): number {
  return Math.round(v / grid) * grid
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 尺寸：對齊格點並限制範圍。 */
export function snapSize(v: number, max: number): number {
  return clamp(snap(v), SIZE_LIMITS.min, max)
}

// ---------------------------------------------------------------- 查詢

/** 有沒有強調塊（只有矩形可以有）。 */
export function hasAccent(n: ArchNode): boolean {
  return n.style.shape === 'rect' && n.accent.trim() !== ''
}

/** 元件整體寬度（含強調塊）。 */
export function nodeWidth(n: ArchNode): number {
  return n.w + (hasAccent(n) ? n.accentW : 0)
}

/** 元件整體的外框（含強調塊）。 */
export function nodeBox(n: ArchNode): Box {
  return { x: n.x, y: n.y, w: nodeWidth(n), h: n.h }
}

/** 所有元件與自由端點的外框；什麼都沒有時回傳一塊預設大小的區域（讓空白圖也能置中）。 */
export function bounds(nodes: ArchNode[], edges: ArchEdge[] = []): Box {
  const boxes = nodes.map(nodeBox)
  for (const e of edges)
    for (const end of [e.from, e.to]) if (!isNodeEnd(end)) boxes.push({ ...end, w: 0, h: 0 })
  if (boxes.length === 0) return { x: 0, y: 0, w: 800, h: 450 }
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) }
}

/**
 * 從最上層到指定圖的路徑（層級路徑用）：依「哪個元件的 child 是這張圖」往上找。
 * 找不到（孤兒圖或 id 不存在）時只回傳最上層。
 */
export function pathTo(doc: ArchDoc, diagramId: string): { diagram: Diagram; via?: ArchNode }[] {
  const parentOf = new Map<string, { diagram: Diagram; node: ArchNode }>()
  for (const d of Object.values(doc.diagrams)) {
    for (const n of d.nodes) if (n.child) parentOf.set(n.child, { diagram: d, node: n })
  }
  const chain: { diagram: Diagram; via?: ArchNode }[] = []
  const seen = new Set<string>()
  let id: string | undefined = diagramId
  let d: Diagram | undefined
  while (id && (d = doc.diagrams[id]) && !seen.has(id)) {
    seen.add(id)
    const p = parentOf.get(id)
    chain.unshift({ diagram: d, via: p?.node })
    if (id === doc.root) return chain
    id = p?.diagram.id
  }
  const root = doc.diagrams[doc.root]
  return root ? [{ diagram: root }] : []
}

/** 一張圖與它底下所有細部圖的 id（刪除元件時連同細部圖一起刪）。 */
export function subtree(doc: ArchDoc, diagramId: string): string[] {
  const out: string[] = []
  const stack = [diagramId]
  while (stack.length) {
    const id = stack.pop()!
    const d = doc.diagrams[id]
    if (out.includes(id) || !d) continue
    out.push(id)
    for (const n of d.nodes) if (n.child) stack.push(n.child)
  }
  return out
}

// ---------------------------------------------------------------- 編輯操作

export type NodePatch = Partial<Omit<ArchNode, 'id' | 'style'>> & { style?: Partial<NodeStyle> }
export type EdgePatch = Partial<Omit<ArchEdge, 'id' | 'style'>> & { style?: Partial<EdgeStyle> }

export type Op =
  /** 位置會對齊格點 */
  | { type: 'moveNode'; diagram: string; node: string; x: number; y: number }
  | { type: 'updateNode'; diagram: string; node: string; patch: NodePatch }
  | { type: 'addNode'; diagram: string; node: ArchNode }
  | { type: 'removeNode'; diagram: string; node: string }
  | { type: 'addEdge'; diagram: string; edge: ArchEdge }
  | { type: 'updateEdge'; diagram: string; edge: string; patch: EdgePatch }
  | { type: 'removeEdge'; diagram: string; edge: string }
  | { type: 'updateDiagram'; diagram: string; patch: Partial<Pick<Diagram, 'level' | 'title'>> }
  /** 為元件建立細部圖（已有則不動） */
  | { type: 'createChild'; diagram: string; node: string; childId: string }

function withDiagram(doc: ArchDoc, id: string, fn: (d: Diagram) => Diagram): ArchDoc {
  const d = doc.diagrams[id]
  if (!d) return doc
  const next = fn(d)
  return next === d ? doc : { ...doc, diagrams: { ...doc.diagrams, [id]: next } }
}

/** 兩個端點是否相同（自由端點比座標；元件端點比元件、塊與邊）。 */
export function sameEnd(a: EdgeEnd, b: EdgeEnd): boolean {
  if (isNodeEnd(a) && isNodeEnd(b))
    return (
      a.node === b.node &&
      a.part === b.part &&
      a.side === b.side &&
      (a.side ? (a.pos ?? 0.5) === (b.pos ?? 0.5) : true)
    )
  if (!isNodeEnd(a) && !isNodeEnd(b)) return a.x === b.x && a.y === b.y
  return false
}

const touches = (e: ArchEdge, node: string) =>
  [e.from, e.to].some((end) => isNodeEnd(end) && end.node === node)

/** 套用一個編輯操作，回傳新文件（不改動原文件；沒有變化時回傳同一個物件）。 */
export function applyOp(doc: ArchDoc, op: Op): ArchDoc {
  switch (op.type) {
    case 'moveNode':
      return withDiagram(doc, op.diagram, (d) => {
        const x = snap(op.x)
        const y = snap(op.y)
        const n = d.nodes.find((m) => m.id === op.node)
        if (!n || (n.x === x && n.y === y)) return d
        return { ...d, nodes: d.nodes.map((m) => (m === n ? { ...m, x, y } : m)) }
      })
    case 'updateNode':
      return withDiagram(doc, op.diagram, (d) => ({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === op.node ? { ...n, ...op.patch, style: { ...n.style, ...op.patch.style } } : n,
        ),
      }))
    case 'addNode':
      return withDiagram(doc, op.diagram, (d) => ({ ...d, nodes: [...d.nodes, op.node] }))
    case 'removeNode': {
      const d = doc.diagrams[op.diagram]
      const node = d?.nodes.find((n) => n.id === op.node)
      if (!d || !node) return doc
      const diagrams = { ...doc.diagrams }
      if (node.child) for (const id of subtree(doc, node.child)) delete diagrams[id]
      diagrams[d.id] = {
        ...d,
        nodes: d.nodes.filter((n) => n.id !== op.node),
        edges: d.edges.filter((e) => !touches(e, op.node)),
      }
      return { ...doc, diagrams }
    }
    case 'addEdge':
      return withDiagram(doc, op.diagram, (d) => {
        const { from, to } = op.edge
        const known = (end: EdgeEnd) => !isNodeEnd(end) || d.nodes.some((n) => n.id === end.node)
        // 兩端都要存在、不能是同一點、不重複
        if (!known(from) || !known(to) || sameEnd(from, to)) return d
        if (isNodeEnd(from) && isNodeEnd(to) && from.node === to.node && from.part === to.part)
          return d
        if (d.edges.some((e) => sameEnd(e.from, from) && sameEnd(e.to, to))) return d
        return { ...d, edges: [...d.edges, op.edge] }
      })
    case 'updateEdge':
      return withDiagram(doc, op.diagram, (d) => ({
        ...d,
        edges: d.edges.map((e) =>
          e.id === op.edge ? { ...e, ...op.patch, style: { ...e.style, ...op.patch.style } } : e,
        ),
      }))
    case 'removeEdge':
      return withDiagram(doc, op.diagram, (d) => ({
        ...d,
        edges: d.edges.filter((e) => e.id !== op.edge),
      }))
    case 'updateDiagram':
      return withDiagram(doc, op.diagram, (d) => ({ ...d, ...op.patch }))
    case 'createChild': {
      const d = doc.diagrams[op.diagram]
      const node = d?.nodes.find((n) => n.id === op.node)
      if (!d || !node || node.child || doc.diagrams[op.childId]) return doc
      const child = starterDiagram(op.childId, d, node)
      const withChild = { ...doc, diagrams: { ...doc.diagrams, [child.id]: child } }
      return applyOp(withChild, {
        type: 'updateNode',
        diagram: d.id,
        node: node.id,
        patch: { child: child.id },
      })
    }
  }
}

export function newEdge(id: string, from: EdgeEnd, to: EdgeEnd): ArchEdge {
  return { id, from, to, route: 'auto', label: '', style: { ...DEFAULT_EDGE_STYLE } }
}

/** 新的細部圖：名稱用元件名稱，放一組「輸入 → 輸出」當起點。 */
function starterDiagram(id: string, parent: Diagram, node: ArchNode): Diagram {
  const a = uid('n')
  const b = uid('n')
  return {
    id,
    level: nextLevel(parent.level),
    title: node.title || '細部圖',
    nodes: [
      { ...newNode(a, 0, 0), kicker: 'INPUT', title: '輸入' },
      { ...newNode(b, 400, 0), kicker: 'OUTPUT', title: '輸出' },
    ],
    edges: [newEdge(uid('e'), { node: a, part: 'main' }, { node: b, part: 'main' })],
  }
}

/** 「L2 容器」→「L3 元件」→「L4 流程」；其他名稱沿用。 */
export function nextLevel(level: string): string {
  const m = /^L(\d)/.exec(level)
  if (!m) return level
  const n = Number(m[1]) + 1
  const name: Record<number, string> = { 1: '系統情境', 2: '容器', 3: '元件', 4: '流程' }
  return `L${n} ${name[n] ?? '細部'}`
}

/** 各形狀新元件的預設尺寸與標題（尺寸都是 GRID 的倍數）。 */
const SHAPE_DEFAULTS: Record<NodeShapeKind, { w: number; h: number; title: string }> = {
  rect: { w: 240, h: 160, title: '新元件' },
  ellipse: { w: 220, h: 140, title: '新元件' },
  diamond: { w: 220, h: 160, title: '判斷' },
  cylinder: { w: 180, h: 160, title: '資料庫' },
  hexagon: { w: 220, h: 140, title: '服務' },
}

export function newNode(id: string, x: number, y: number, shape: NodeShapeKind = 'rect'): ArchNode {
  const s = SHAPE_DEFAULTS[shape]
  return {
    id,
    x,
    y,
    w: s.w,
    h: s.h,
    kicker: '',
    title: s.title,
    accent: '',
    accentW: 160,
    note: '',
    style: { ...DEFAULT_NODE_STYLE, shape, align: shape === 'rect' ? 'left' : 'center' },
  }
}

/** 兩個外框（彼此至少相隔 gap）是否重疊。 */
export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  )
}

/**
 * 新元件的位置：從 near（通常是畫面中央）附近的格點由近而遠找，
 * 第一個與既有元件（留一格間距）不重疊的位置。找不到就放在 near。
 */
export function freeSpot(
  d: Diagram,
  near: { x: number; y: number },
  size: { w: number; h: number } = SHAPE_DEFAULTS.rect,
): { x: number; y: number } {
  const { w, h } = size
  const cx = snap(near.x - w / 2)
  const cy = snap(near.y - h / 2)
  const boxes = d.nodes.map(nodeBox)
  const free = (x: number, y: number) => boxes.every((b) => !overlaps({ x, y, w, h }, b, GRID))
  // 以 near 為中心一圈一圈往外找（第 r 圈是邊長 2r+1 格的方框），同一圈取最近的
  for (let r = 0; r <= 40; r++) {
    let best: { x: number; y: number; dist: number } | undefined
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue
        const x = cx + i * GRID
        const y = cy + j * GRID
        const dist = Math.hypot(i, j)
        if (free(x, y) && (!best || dist < best.dist)) best = { x, y, dist }
      }
    }
    if (best) return { x: best.x, y: best.y }
  }
  return { x: cx, y: cy }
}

// ---------------------------------------------------------------- 匯入驗證

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback

/** 顏色只接受 #rgb／#rrggbb；allowNone 時也接受 'none'。 */
export function isColor(v: unknown, allowNone = false): v is string {
  return (
    typeof v === 'string' &&
    (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || (allowNone && v === 'none'))
  )
}
const color = (v: unknown, fallback: string, allowNone = false) =>
  isColor(v, allowNone) ? v : fallback

const SIDES = ['top', 'right', 'bottom', 'left'] as const

function parseEnd(v: unknown): EdgeEnd | undefined {
  if (!isObj(v)) return undefined
  if (typeof v.node === 'string') {
    const end: NodeEnd = { node: v.node, part: v.part === 'accent' ? 'accent' : 'main' }
    if (SIDES.includes(v.side as Side)) {
      end.side = v.side as Side
      const pos = num(v.pos, 0.5)
      if (pos !== 0.5) end.pos = clamp(pos, 0, 1)
    }
    return end
  }
  if (typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x + v.y))
    return { x: snap(v.x), y: snap(v.y) }
  return undefined
}

function parseNodeStyle(v: unknown): NodeStyle {
  const s = isObj(v) ? v : {}
  const d = DEFAULT_NODE_STYLE
  const shape = oneOf(
    s.shape,
    SHAPES.map((x) => x.value),
    d.shape,
  )
  return {
    shape,
    fill: color(s.fill, d.fill, true),
    stroke: color(s.stroke, d.stroke, true),
    strokeWidth: clamp(num(s.strokeWidth, d.strokeWidth), 0, 8),
    radius: clamp(num(s.radius, d.radius), 0, 80),
    textColor: color(s.textColor, d.textColor),
    kickerColor: color(s.kickerColor, d.kickerColor),
    accentFill: color(s.accentFill, d.accentFill),
    accentText: color(s.accentText, d.accentText),
    titleSize: clamp(num(s.titleSize, d.titleSize), FONT_LIMITS.min, FONT_LIMITS.max),
    kickerSize: clamp(num(s.kickerSize, d.kickerSize), FONT_LIMITS.min, FONT_LIMITS.max),
    align: oneOf(s.align, ['left', 'center'] as const, shape === 'rect' ? 'left' : 'center'),
  }
}

function parseEdgeStyle(v: unknown): EdgeStyle {
  const s = isObj(v) ? v : {}
  const d = DEFAULT_EDGE_STYLE
  return {
    color: color(s.color, d.color),
    width: clamp(num(s.width, d.width), 1, 10),
    dash: oneOf(s.dash, ['solid', 'dashed', 'dotted'] as const, d.dash),
    arrow: oneOf(s.arrow, ['end', 'start', 'both', 'none'] as const, d.arrow),
    shape: oneOf(s.shape, ['orthogonal', 'straight', 'curved'] as const, d.shape),
    labelSize: clamp(num(s.labelSize, d.labelSize), FONT_LIMITS.min, FONT_LIMITS.max),
    labelColor: s.labelColor === 'auto' ? 'auto' : color(s.labelColor, d.labelColor),
    labelBg: s.labelBg === 'auto' ? 'auto' : color(s.labelBg, d.labelBg, true),
    labelBold: typeof s.labelBold === 'boolean' ? s.labelBold : d.labelBold,
    labelPos: clamp(num(s.labelPos, d.labelPos), 0, 100),
  }
}

/**
 * 驗證並正規化匯入的 JSON（或 localStorage 內容）：缺的欄位補預設值、多的欄位丟掉，
 * 位置與尺寸對齊格點（舊檔案的元件可能不在點點上）。結構不對時丟出中文錯誤訊息。
 */
export function parseDoc(raw: unknown): ArchDoc {
  if (!isObj(raw) || !isObj(raw.diagrams)) throw new Error('不是架構圖檔案：缺少 diagrams')
  if (raw.version !== 1) throw new Error(`不支援的版本：${String(raw.version)}`)
  const diagrams: Record<string, Diagram> = {}
  for (const [id, d] of Object.entries(raw.diagrams)) {
    if (!isObj(d)) throw new Error(`圖 ${id} 的格式不正確`)
    const nodes: ArchNode[] = (Array.isArray(d.nodes) ? d.nodes : []).filter(isObj).map((n) => ({
      id: str(n.id) || uid('n'),
      x: snap(num(n.x, 0)),
      y: snap(num(n.y, 0)),
      w: snapSize(num(n.w, 240), SIZE_LIMITS.maxW),
      h: snapSize(num(n.h, 160), SIZE_LIMITS.maxH),
      kicker: str(n.kicker),
      title: str(n.title),
      accent: str(n.accent),
      accentW: snapSize(num(n.accentW, 160), SIZE_LIMITS.maxW),
      note: str(n.note),
      ...(typeof n.child === 'string' ? { child: n.child } : {}),
      style: parseNodeStyle(n.style),
    }))
    const ids = new Set(nodes.map((n) => n.id))
    const edges: ArchEdge[] = []
    for (const e of Array.isArray(d.edges) ? d.edges : []) {
      if (!isObj(e)) continue
      const from = parseEnd(e.from)
      const to = parseEnd(e.to)
      const ok = (end?: EdgeEnd) => end && (!isNodeEnd(end) || ids.has(end.node))
      if (!from || !to || !ok(from) || !ok(to)) continue
      edges.push({
        id: str(e.id) || uid('e'),
        from,
        to,
        route: oneOf(e.route, ['auto', 'hv', 'vh'] as const, 'auto'),
        label: str(e.label),
        style: parseEdgeStyle(e.style),
      })
    }
    diagrams[id] = { id, level: str(d.level), title: str(d.title), nodes, edges }
  }
  const root = str(raw.root)
  if (!diagrams[root]) throw new Error('找不到最上層的圖（root）')
  // 指向不存在的細部圖時拿掉連結，避免點進去是空的
  for (const d of Object.values(diagrams)) {
    d.nodes = d.nodes.map((n) => {
      if (!n.child || diagrams[n.child]) return n
      const rest = { ...n }
      delete rest.child
      return rest
    })
  }
  return { version: 1, root, diagrams }
}
