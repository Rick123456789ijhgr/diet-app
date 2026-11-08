// 專案架構圖的資料模型與編輯操作（純函式，不碰 React 與 DOM）。
//
// 一份文件（ArchDoc）由多張圖（Diagram）組成，像 C4 Model 一樣逐層放大：
// 圖上的元件（ArchNode）可以指向一張「細部圖」（child），點進去看該元件內部的組成或流程。
// 每張圖是一塊無限畫布，座標一律是畫布座標（px）；元件對齊 GRID 的點點格子。

/** 點點格子的間距，也是拖曳與縮放尺寸時吸附的單位（px）。 */
export const GRID = 20

/** 新元件的預設尺寸（都是格子的整數倍，放在格點上時四邊都會落在格線上）。 */
export const NODE_DEFAULTS = { w: 240, h: 160, accentW: 160 } as const

/** 元件尺寸的上下限。 */
export const SIZE_LIMITS = { min: 60, maxW: 900, maxH: 600 } as const

/**
 * 一個元件：左邊是主方塊（小標＋標題），右邊可附一塊強調色方塊（accent，例如「品質門檻」）。
 * 連線可以接在主方塊或強調塊上（Part），對應參考圖中箭頭從橘色方塊出發的畫法。
 */
export interface ArchNode {
  id: string
  /** 主方塊左上角（畫布座標） */
  x: number
  y: number
  /** 主方塊寬高；強調塊與主方塊同高、接在右側 */
  w: number
  h: number
  /** 小標（例如「01」「INPUT」），空字串時標題垂直置中 */
  kicker: string
  title: string
  /** 強調塊文字；空字串表示沒有強調塊 */
  accent: string
  accentW: number
  /** 說明：滑過元件時顯示，描述這個元件做什麼、怎麼運作 */
  note: string
  /** 細部圖的 id（C4 的下一層）；沒有時不能點進去 */
  child?: string
}

/** 連線接在元件的哪一塊。 */
export type Part = 'main' | 'accent'

export interface EdgeEnd {
  node: string
  part: Part
}

/**
 * 連線路線：
 * - auto：同一列或同一欄時畫直線，否則畫 Z 形折線。
 * - hv：先水平再垂直（從側邊出去、從上方或下方進入）。
 * - vh：先垂直再水平（從上方或下方出去、從側邊進入）。
 */
export type Route = 'auto' | 'hv' | 'vh'

export interface ArchEdge {
  id: string
  from: EdgeEnd
  to: EdgeEnd
  route: Route
  label: string
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

// ---------------------------------------------------------------- 查詢

export function hasAccent(n: ArchNode): boolean {
  return n.accent.trim() !== ''
}

/** 元件整體寬度（含強調塊）。 */
export function nodeWidth(n: ArchNode): number {
  return n.w + (hasAccent(n) ? n.accentW : 0)
}

/** 元件整體的外框（含強調塊）。 */
export function nodeBox(n: ArchNode): Box {
  return { x: n.x, y: n.y, w: nodeWidth(n), h: n.h }
}

/** 所有元件的外框；沒有元件時回傳一塊預設大小的區域（讓空白圖也能置中）。 */
export function bounds(nodes: ArchNode[]): Box {
  if (nodes.length === 0) return { x: 0, y: 0, w: 800, h: 450 }
  const x0 = Math.min(...nodes.map((n) => n.x))
  const y0 = Math.min(...nodes.map((n) => n.y))
  const x1 = Math.max(...nodes.map((n) => n.x + nodeWidth(n)))
  const y1 = Math.max(...nodes.map((n) => n.y + n.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
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

export type Op =
  /** 位置由編輯器決定（格點或對齊其他元件），這裡只取整數 */
  | { type: 'moveNode'; diagram: string; node: string; x: number; y: number }
  | { type: 'updateNode'; diagram: string; node: string; patch: Partial<Omit<ArchNode, 'id'>> }
  | { type: 'addNode'; diagram: string; node: ArchNode }
  | { type: 'removeNode'; diagram: string; node: string }
  | { type: 'addEdge'; diagram: string; edge: ArchEdge }
  | { type: 'updateEdge'; diagram: string; edge: string; patch: Partial<Omit<ArchEdge, 'id'>> }
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

const sameEnd = (a: EdgeEnd, b: EdgeEnd) => a.node === b.node && a.part === b.part

/** 套用一個編輯操作，回傳新文件（不改動原文件；沒有變化時回傳同一個物件）。 */
export function applyOp(doc: ArchDoc, op: Op): ArchDoc {
  switch (op.type) {
    case 'moveNode':
      return withDiagram(doc, op.diagram, (d) => {
        const x = Math.round(op.x)
        const y = Math.round(op.y)
        const n = d.nodes.find((m) => m.id === op.node)
        if (!n || (n.x === x && n.y === y)) return d
        return { ...d, nodes: d.nodes.map((m) => (m === n ? { ...m, x, y } : m)) }
      })
    case 'updateNode':
      return withDiagram(doc, op.diagram, (d) => ({
        ...d,
        nodes: d.nodes.map((n) => (n.id === op.node ? { ...n, ...op.patch } : n)),
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
        edges: d.edges.filter((e) => e.from.node !== op.node && e.to.node !== op.node),
      }
      return { ...doc, diagrams }
    }
    case 'addEdge':
      return withDiagram(doc, op.diagram, (d) => {
        const { from, to } = op.edge
        const known = (end: EdgeEnd) => d.nodes.some((n) => n.id === end.node)
        // 不接自己、不重複、兩端都要存在
        if (sameEnd(from, to) || !known(from) || !known(to)) return d
        if (d.edges.some((e) => sameEnd(e.from, from) && sameEnd(e.to, to))) return d
        return { ...d, edges: [...d.edges, op.edge] }
      })
    case 'updateEdge':
      return withDiagram(doc, op.diagram, (d) => ({
        ...d,
        edges: d.edges.map((e) => (e.id === op.edge ? { ...e, ...op.patch } : e)),
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
    edges: [
      {
        id: uid('e'),
        from: { node: a, part: 'main' },
        to: { node: b, part: 'main' },
        route: 'auto',
        label: '',
      },
    ],
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

export function newNode(id: string, x: number, y: number): ArchNode {
  return {
    id,
    x,
    y,
    w: NODE_DEFAULTS.w,
    h: NODE_DEFAULTS.h,
    kicker: '',
    title: '新元件',
    accent: '',
    accentW: NODE_DEFAULTS.accentW,
    note: '',
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
export function freeSpot(d: Diagram, near: { x: number; y: number }): { x: number; y: number } {
  const { w, h } = NODE_DEFAULTS
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

function parseEnd(v: unknown): EdgeEnd | undefined {
  if (!isObj(v) || typeof v.node !== 'string') return undefined
  return { node: v.node, part: v.part === 'accent' ? 'accent' : 'main' }
}

/**
 * 驗證並正規化匯入的 JSON（或 localStorage 內容）；缺的欄位補預設值、多的欄位丟掉。
 * 結構不對時丟出中文錯誤訊息。
 */
export function parseDoc(raw: unknown): ArchDoc {
  if (!isObj(raw) || !isObj(raw.diagrams)) throw new Error('不是架構圖檔案：缺少 diagrams')
  if (raw.version !== 1) throw new Error(`不支援的版本：${String(raw.version)}`)
  const diagrams: Record<string, Diagram> = {}
  for (const [id, d] of Object.entries(raw.diagrams)) {
    if (!isObj(d)) throw new Error(`圖 ${id} 的格式不正確`)
    const nodes: ArchNode[] = (Array.isArray(d.nodes) ? d.nodes : []).filter(isObj).map((n) => ({
      id: str(n.id) || uid('n'),
      x: num(n.x, 0),
      y: num(n.y, 0),
      w: clamp(num(n.w, NODE_DEFAULTS.w), SIZE_LIMITS.min, SIZE_LIMITS.maxW),
      h: clamp(num(n.h, NODE_DEFAULTS.h), SIZE_LIMITS.min, SIZE_LIMITS.maxH),
      kicker: str(n.kicker),
      title: str(n.title),
      accent: str(n.accent),
      accentW: clamp(num(n.accentW, NODE_DEFAULTS.accentW), SIZE_LIMITS.min, SIZE_LIMITS.maxW),
      note: str(n.note),
      ...(typeof n.child === 'string' ? { child: n.child } : {}),
    }))
    const ids = new Set(nodes.map((n) => n.id))
    const edges: ArchEdge[] = []
    for (const e of Array.isArray(d.edges) ? d.edges : []) {
      if (!isObj(e)) continue
      const from = parseEnd(e.from)
      const to = parseEnd(e.to)
      if (!from || !to || !ids.has(from.node) || !ids.has(to.node)) continue
      const route: Route = e.route === 'hv' || e.route === 'vh' ? e.route : 'auto'
      edges.push({ id: str(e.id) || uid('e'), from, to, route, label: str(e.label) })
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
