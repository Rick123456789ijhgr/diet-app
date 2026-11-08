// 編輯器的無限畫布（類似 IcePanel）：點點格子、平移與縮放、拖曳元件（一律落在格點上）、
// 右下角把手縮放尺寸、從定位點或用線條工具拉線（自動吸附到最近的定位點）、拖曳線條兩端重新接、
// 點兩下空白處新增元件、點兩下元件進入細部圖。
import { LocateFixed, Maximize, Minus, Plus } from 'lucide-react'
import {
  type PointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Hint } from '@/components/ui/primitives'
import {
  anchorEnd,
  edgeGeometry,
  type Guide,
  hitPart,
  layoutEdges,
  nearestAnchor,
  nodeAnchors,
  type Pt,
  snapMove,
} from '@/lib/arch/geometry'
import {
  type ArchEdge,
  type ArchNode,
  bounds,
  clamp,
  type Diagram,
  type EdgeEnd,
  GRID,
  isNodeEnd,
  newEdge,
  nodeBox,
  sameEnd,
  SIZE_LIMITS,
  snap,
  snapSize,
} from '@/lib/arch/model'
import { ARCH } from '@/lib/arch/theme'

import { ArrowDefs, DrillIcon, EdgeShape, NodeShape } from './DiagramSvg'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

/** 選取工具或線條工具。 */
export type Tool = 'select' | 'line'

/** 畫面座標＝畫布座標 × k ＋ (x, y)。 */
export interface View {
  x: number
  y: number
  k: number
}

export interface CanvasApi {
  /** 縮放到看得到整張圖（最多 80%） */
  fit: () => void
  /** 不改縮放，把整張圖移到畫面中央 */
  recenter: () => void
  /** 目前畫面中央的畫布座標（新增元件的位置） */
  center: () => Pt
}

const ZOOM = { min: 0.2, max: 3 }
/** 拉線時吸附到定位點的距離（畫面 px） */
const ANCHOR_PX = 18
/** 按下後移動超過這個距離（畫面 px）才算拖曳 */
const DRAG_PX = 4
/** 初始與「符合畫面」的最大縮放（太大時一進來元件就塞滿畫面） */
const FIT_MAX = 0.8
/** 「符合畫面」時內容佔畫面的比例（四周留白） */
const FIT_FILL = 0.76

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean }
  | { kind: 'resize'; id: string; moved: boolean }

/** 拉線中：新增一條，或拖曳既有連線的一端（fixed 為不動的那一端）。 */
type Link =
  | { mode: 'new'; from: EdgeEnd; pt: Pt }
  | { mode: 'edit'; edge: ArchEdge; which: 'from' | 'to'; pt: Pt }

/** 以畫面上的 (sx, sy) 為中心縮放 f 倍。 */
export function zoomAt(v: View, sx: number, sy: number, f: number): View {
  const k = clamp(v.k * f, ZOOM.min, ZOOM.max)
  const wx = (sx - v.x) / v.k
  const wy = (sy - v.y) / v.k
  return { k, x: sx - wx * k, y: sy - wy * k }
}

/** 不改縮放，把整張圖移到畫面中央。 */
export function centerView(d: Diagram, cw: number, ch: number, k: number): View {
  const b = bounds(d.nodes, d.edges)
  return { k, x: cw / 2 - (b.x + b.w / 2) * k, y: ch / 2 - (b.y + b.h / 2) * k }
}

/** 縮放到能看到整張圖（四周留白，最多 80%）。容器沒有大小（測試環境）時以 80% 對齊左上。 */
export function fitView(d: Diagram, cw: number, ch: number): View {
  const b = bounds(d.nodes, d.edges)
  if (cw <= 0 || ch <= 0) return { k: FIT_MAX, x: 60 - b.x * FIT_MAX, y: 60 - b.y * FIT_MAX }
  const k = clamp(Math.min((cw * FIT_FILL) / b.w, (ch * FIT_FILL) / b.h, FIT_MAX), ZOOM.min, 1)
  return centerView(d, cw, ch, k)
}

export function EditorCanvas({
  diagram,
  selection,
  tool,
  apiRef,
  onSelect,
  onDragStart,
  onMove,
  onResize,
  onCreateEdge,
  onUpdateEdge,
  onDrill,
  onAddAt,
}: {
  diagram: Diagram
  selection: Selection
  tool: Tool
  apiRef?: Ref<CanvasApi>
  onSelect: (s: Selection) => void
  /** 真的開始拖曳或縮放時呼叫一次（記入復原） */
  onDragStart: () => void
  onMove: (node: string, x: number, y: number) => void
  onResize: (node: string, w: number, h: number) => void
  onCreateEdge: (from: EdgeEnd, to: EdgeEnd) => void
  onUpdateEdge: (edge: string, which: 'from' | 'to', end: EdgeEnd) => void
  onDrill: (node: string) => void
  /** 點兩下空白處：在該畫布座標新增元件 */
  onAddAt: (p: Pt) => void
}) {
  const prefix = `ed${useId()}`
  const dotsId = `${prefix.replace(/[^a-zA-Z0-9]/g, '')}-dots`
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const drag = useRef<Drag | null>(null)
  const [link, setLink] = useState<Link | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [hover, setHover] = useState<string | null>(null)

  const size = () => {
    const r = svgRef.current?.getBoundingClientRect()
    return { w: r?.width ?? 0, h: r?.height ?? 0, left: r?.left ?? 0, top: r?.top ?? 0 }
  }
  const fit = () => {
    const s = size()
    setView(fitView(diagram, s.w, s.h))
  }
  const recenter = () => {
    const s = size()
    setView((v) => centerView(diagram, s.w, s.h, v.k))
  }

  // 換到另一張圖時縮放到整張圖
  useLayoutEffect(fit, [diagram.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(apiRef, () => ({
    fit,
    recenter,
    center: () => {
      const s = size()
      return { x: (s.w / 2 - view.x) / view.k, y: (s.h / 2 - view.y) / view.k }
    },
  }))

  // 滾輪平移、Ctrl／⌘＋滾輪（觸控板捏合）縮放；要 preventDefault 所以用非 passive 的原生監聽
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * 0.0015)
        setView((v) => zoomAt(v, e.clientX - r.left, e.clientY - r.top, f))
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const s = size()
    return { x: (e.clientX - s.left - view.x) / view.k, y: (e.clientY - s.top - view.y) / view.k }
  }

  /** 某個位置當作連線端點：靠近定位點就固定在那一邊；落在元件上就自動選邊；否則是格點上的自由端點。 */
  function endAt(p: Pt): EdgeEnd {
    const a = nearestAnchor(diagram.nodes, p, ANCHOR_PX / view.k)
    if (a) return anchorEnd(a.node, a.anchor)
    return hitPart(diagram.nodes, p) ?? { x: snap(p.x), y: snap(p.y) }
  }

  function startLink(e: PointerEvent, from: EdgeEnd) {
    e.stopPropagation()
    svgRef.current?.setPointerCapture?.(e.pointerId)
    setLink({ mode: 'new', from, pt: toWorld(e) })
  }

  function onBackgroundPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    onSelect(null)
    if (tool === 'line') return startLink(e, endAt(toWorld(e)))
    svgRef.current?.setPointerCapture?.(e.pointerId)
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
  }

  function onNodePointerDown(e: PointerEvent, n: ArchNode) {
    if (tool === 'line' && e.button === 0) return startLink(e, endAt(toWorld(e)))
    e.stopPropagation()
    onSelect({ kind: 'node', id: n.id })
    if (e.button !== 0) return
    const p = toWorld(e)
    drag.current = {
      kind: 'move',
      id: n.id,
      ox: p.x - n.x,
      oy: p.y - n.y,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
    }
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current
    if (link) setLink({ ...link, pt: toWorld(e) })
    if (!d) return
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }))
      return
    }
    const n = diagram.nodes.find((m) => m.id === d.id)
    if (!n) return
    if (!d.moved) {
      if (d.kind === 'move' && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_PX) return
      d.moved = true
      svgRef.current?.setPointerCapture?.(e.pointerId)
      onDragStart()
    }
    const p = toWorld(e)
    if (d.kind === 'move') {
      const others = diagram.nodes.filter((m) => m.id !== n.id).map(nodeBox)
      const r = snapMove({ ...nodeBox(n), x: p.x - d.ox, y: p.y - d.oy }, others, GRID)
      setGuides(r.guides)
      onMove(n.id, r.x, r.y)
    } else {
      const w = snapSize(p.x - n.x, SIZE_LIMITS.maxW)
      const h = snapSize(p.y - n.y, SIZE_LIMITS.maxH)
      if (w !== n.w || h !== n.h) onResize(n.id, w, h)
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (link) {
      const target = endAt(toWorld(e))
      if (link.mode === 'new') {
        // 從自由端點拉到同一個格點（只是點一下）不算
        if (!sameEnd(link.from, target)) onCreateEdge(link.from, target)
      } else {
        const fixed = link.which === 'from' ? link.edge.to : link.edge.from
        if (!sameEnd(fixed, target)) onUpdateEdge(link.edge.id, link.which, target)
      }
      setLink(null)
    }
    drag.current = null
    setGuides([])
  }

  /** 拉線中的預覽：與完成後同樣的路徑。 */
  function previewEdge(): ArchEdge | undefined {
    if (!link) return undefined
    const target = endAt(link.pt)
    if (link.mode === 'new') return newEdge('preview', link.from, target)
    return { ...link.edge, [link.which]: target }
  }
  const preview = previewEdge()
  const snapTarget = link ? nearestAnchor(diagram.nodes, link.pt, ANCHOR_PX / view.k) : undefined

  const geometries = layoutEdges(diagram.nodes, diagram.edges)
  const selectedNode = selection?.kind === 'node' ? selection.id : null
  const selectedEdge = selection?.kind === 'edge' ? selection.id : null
  const editingEdge = link?.mode === 'edit' ? link.edge.id : null
  const showAllAnchors = tool === 'line' || link !== null
  // 畫面上固定大小的線寬與把手（除以縮放倍率）
  const px = (v: number) => v / view.k
  // 每個格點都畫一點（元件一律落在點上）；縮得太小、點太密時不畫
  const gk = GRID * view.k
  const showDots = gk >= 8

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: ARCH.canvas }}>
      <svg
        ref={svgRef}
        role="group"
        aria-label={`${diagram.title} 編輯畫布`}
        className="block h-full w-full touch-none select-none"
        style={{ cursor: tool === 'line' ? 'crosshair' : undefined }}
        fontFamily={ARCH.font}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null
          setLink(null)
          setGuides([])
        }}
        onDoubleClick={(e) => {
          if (tool !== 'select') return
          if (e.target === e.currentTarget || (e.target as Element).id === `${dotsId}-bg`)
            onAddAt(toWorld(e))
        }}
      >
        <defs>
          <pattern
            id={dotsId}
            patternUnits="userSpaceOnUse"
            width={gk}
            height={gk}
            x={view.x - gk / 2}
            y={view.y - gk / 2}
          >
            <circle cx={gk / 2} cy={gk / 2} r={Math.min(1.6, gk / 10)} fill={ARCH.dot} />
          </pattern>
        </defs>
        <ArrowDefs prefix={prefix} edges={diagram.edges} />
        <rect
          id={`${dotsId}-bg`}
          width="100%"
          height="100%"
          fill={showDots ? `url(#${dotsId})` : 'transparent'}
        />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {diagram.edges.map((e) => {
            if (e.id === editingEdge) return null
            const g = geometries.get(e.id)
            return (
              <g key={e.id}>
                <EdgeShape
                  edge={e}
                  geometry={g}
                  prefix={prefix}
                  selected={e.id === selectedEdge}
                  canvasBg={ARCH.canvas}
                />
                {g && (
                  <path
                    data-testid={`edge-${e.id}`}
                    d={g.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={px(14)}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(ev) => {
                      if (tool === 'line') return
                      ev.stopPropagation()
                      onSelect({ kind: 'edge', id: e.id })
                    }}
                  />
                )}
              </g>
            )
          })}

          {diagram.nodes.map((n) => {
            const selected = n.id === selectedNode
            const box = nodeBox(n)
            const anchors = showAllAnchors || selected || hover === n.id
            return (
              <NodeShape
                key={n.id}
                node={n}
                gProps={{
                  role: 'button',
                  tabIndex: -1,
                  'aria-label': n.title || '未命名元件',
                  'aria-pressed': selected,
                  'data-node': n.id,
                  style: { cursor: tool === 'line' ? 'crosshair' : 'move', outline: 'none' },
                  onPointerDown: (e) => onNodePointerDown(e, n),
                  onPointerEnter: () => setHover(n.id),
                  onPointerLeave: () => setHover((h) => (h === n.id ? null : h)),
                  onDoubleClick: (e) => {
                    e.stopPropagation()
                    if (n.child) onDrill(n.id)
                  },
                }}
              >
                {n.child && <DrillIcon node={n} />}
                {selected && (
                  <>
                    <rect
                      x={box.x - px(4)}
                      y={box.y - px(4)}
                      width={box.w + px(8)}
                      height={box.h + px(8)}
                      fill="none"
                      stroke={ARCH.select}
                      strokeWidth={px(1.5)}
                      strokeDasharray={`${px(5)} ${px(4)}`}
                      pointerEvents="none"
                    />
                    {/* 右下角：拖曳縮放主圖形（對齊格點） */}
                    <rect
                      data-testid={`resize-${n.id}`}
                      x={n.x + n.w - px(5)}
                      y={n.y + n.h - px(5)}
                      width={px(10)}
                      height={px(10)}
                      fill="#ffffff"
                      stroke={ARCH.select}
                      strokeWidth={px(1.5)}
                      style={{ cursor: 'nwse-resize' }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (e.button !== 0) return
                        svgRef.current?.setPointerCapture?.(e.pointerId)
                        drag.current = { kind: 'resize', id: n.id, moved: false }
                      }}
                    />
                  </>
                )}
                {/* 定位點：每邊 1/4、中點、3/4；從這裡拖出線條，或把線條拖到這裡固定 */}
                {anchors &&
                  nodeAnchors(n).map((a) => {
                    const t = snapTarget?.node === n.id ? snapTarget.anchor : undefined
                    const hot = t?.part === a.part && t.side === a.side && t.pos === a.pos
                    const mid = a.pos === 0.5
                    // 測試用的 id：中點只寫邊，其他加上位置（例如 right-25）
                    const id = `${a.part}-${a.side}${mid ? '' : `-${a.pos * 100}`}`
                    return (
                      <circle
                        key={id}
                        data-testid={`anchor-${n.id}-${id}`}
                        cx={a.pt.x}
                        cy={a.pt.y}
                        r={px(hot ? 8 : mid ? 5 : 4)}
                        fill={hot ? ARCH.select : '#ffffff'}
                        stroke={ARCH.select}
                        strokeWidth={px(1.5)}
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          startLink(e, anchorEnd(n.id, a))
                        }}
                      >
                        <title>拖到另一個元件以連線</title>
                      </circle>
                    )
                  })}
              </NodeShape>
            )
          })}

          {/* 選取的連線：兩端的把手，拖曳可重新接到別的定位點或移動自由端點 */}
          {diagram.edges
            .filter((e) => e.id === selectedEdge && !editingEdge)
            .map((e) => {
              const g = geometries.get(e.id)
              if (!g) return null
              return (['from', 'to'] as const).map((which) => {
                const pt = which === 'from' ? g.start : g.end
                return (
                  <rect
                    key={which}
                    data-testid={`edge-end-${which}`}
                    x={pt.x - px(6)}
                    y={pt.y - px(6)}
                    width={px(12)}
                    height={px(12)}
                    rx={px(2)}
                    fill="#ffffff"
                    stroke={ARCH.select}
                    strokeWidth={px(2)}
                    style={{ cursor: 'move' }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation()
                      if (ev.button !== 0) return
                      svgRef.current?.setPointerCapture?.(ev.pointerId)
                      onDragStart()
                      setLink({ mode: 'edit', edge: e, which, pt })
                    }}
                  />
                )
              })
            })}

          {guides.map((g, i) => (
            <line
              key={i}
              x1={g.axis === 'x' ? g.pos : g.from}
              x2={g.axis === 'x' ? g.pos : g.to}
              y1={g.axis === 'x' ? g.from : g.pos}
              y2={g.axis === 'x' ? g.to : g.pos}
              stroke={ARCH.guide}
              strokeWidth={px(1.5)}
              strokeDasharray={`${px(4)} ${px(3)}`}
              pointerEvents="none"
            />
          ))}

          {preview && (
            <g opacity={0.7} pointerEvents="none">
              <EdgeShape
                edge={preview}
                geometry={edgeGeometry(diagram.nodes, preview)}
                prefix={prefix}
                selected
                canvasBg={ARCH.canvas}
              />
              {/* 自由端點的位置 */}
              {[preview.from, preview.to]
                .filter((end) => !isNodeEnd(end))
                .map((end, i) => (
                  <circle
                    key={i}
                    cx={(end as Pt).x}
                    cy={(end as Pt).y}
                    r={px(4)}
                    fill={ARCH.select}
                  />
                ))}
            </g>
          )}
        </g>
      </svg>

      {/* 左下角縮放控制 */}
      <div className="bg-card shadow-card absolute bottom-3 left-3 flex items-center gap-0.5 rounded-full p-1">
        <ZoomButton
          label="縮小"
          onClick={() => {
            const s = size()
            setView((v) => zoomAt(v, s.w / 2, s.h / 2, 1 / 1.2))
          }}
        >
          <Minus className="size-4" aria-hidden />
        </ZoomButton>
        <span className="tabular w-12 text-center text-xs" aria-label="縮放比例">
          {Math.round(view.k * 100)}%
        </span>
        <ZoomButton
          label="放大"
          onClick={() => {
            const s = size()
            setView((v) => zoomAt(v, s.w / 2, s.h / 2, 1.2))
          }}
        >
          <Plus className="size-4" aria-hidden />
        </ZoomButton>
        <span className="bg-card-border mx-0.5 h-4 w-px" aria-hidden />
        <ZoomButton label="回到中心（Shift+2）" onClick={recenter}>
          <LocateFixed className="size-4" aria-hidden />
        </ZoomButton>
        <ZoomButton label="符合畫面（Shift+1）" onClick={fit}>
          <Maximize className="size-4" aria-hidden />
        </ZoomButton>
      </div>
    </div>
  )
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Hint text={label}>
      <button
        type="button"
        aria-label={label.replace(/（.*）$/, '')}
        onClick={onClick}
        className="text-ink-2 hover:bg-hover hover:text-ink focus-visible:ring-primary/40 inline-flex size-7 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
      >
        {children}
      </button>
    </Hint>
  )
}
