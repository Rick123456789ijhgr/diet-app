// 編輯器的無限畫布（類似 IcePanel）：點點格子、平移與縮放、拖曳元件（吸附格點與其他元件）、
// 右下角把手縮放尺寸、從圓點拉線連接、點兩下空白處新增元件、點兩下元件進入細部圖。
import { Maximize, Minus, Plus } from 'lucide-react'
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
  edgePoints,
  type Guide,
  hitPart,
  partRect,
  type Pt,
  roundedPath,
  snapMove,
} from '@/lib/arch/geometry'
import {
  type ArchNode,
  bounds,
  clamp,
  type Diagram,
  type EdgeEnd,
  GRID,
  hasAccent,
  nodeBox,
  type Part,
  SIZE_LIMITS,
  snap,
} from '@/lib/arch/model'
import { ARCH } from '@/lib/arch/theme'

import { ArrowDefs, DrillIcon, EdgeShape, markerIds, NodeShape } from './DiagramSvg'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

/** 畫面座標＝畫布座標 × k ＋ (x, y)。 */
export interface View {
  x: number
  y: number
  k: number
}

export interface CanvasApi {
  /** 縮放到看得到整張圖 */
  fit: () => void
  /** 目前畫面中央的畫布座標（新增元件的位置） */
  center: () => Pt
}

const ZOOM = { min: 0.2, max: 3 }
/** 吸附到其他元件的距離（畫面上的 px，依縮放換算成畫布座標） */
const SNAP_PX = 6
/** 按下後移動超過這個距離（畫面 px）才算拖曳 */
const DRAG_PX = 4

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean }
  | { kind: 'resize'; id: string; moved: boolean }

/** 以畫面上的 (sx, sy) 為中心縮放 f 倍。 */
export function zoomAt(v: View, sx: number, sy: number, f: number): View {
  const k = clamp(v.k * f, ZOOM.min, ZOOM.max)
  const wx = (sx - v.x) / v.k
  const wy = (sy - v.y) / v.k
  return { k, x: sx - wx * k, y: sy - wy * k }
}

/** 縮放到能看到整張圖（最多放大到 100%）。容器沒有大小（測試環境）時以 100% 對齊左上。 */
export function fitView(d: Diagram, cw: number, ch: number, pad = 60): View {
  const b = bounds(d.nodes)
  if (cw <= 0 || ch <= 0) return { k: 1, x: pad - b.x, y: pad - b.y }
  const k = clamp(Math.min((cw - pad * 2) / b.w, (ch - pad * 2) / b.h, 1), ZOOM.min, ZOOM.max)
  return { k, x: (cw - b.w * k) / 2 - b.x * k, y: (ch - b.h * k) / 2 - b.y * k }
}

/** 連線把手：有強調塊時主方塊的把手在下緣中點、強調塊在右緣中點；否則主方塊右緣中點。 */
function handlePoints(n: ArchNode): { part: Part; pt: Pt }[] {
  const main = partRect(n, 'main')
  if (!hasAccent(n)) return [{ part: 'main', pt: { x: main.x + main.w, y: main.y + main.h / 2 } }]
  const acc = partRect(n, 'accent')
  return [
    { part: 'main', pt: { x: main.x + main.w / 2, y: main.y + main.h } },
    { part: 'accent', pt: { x: acc.x + acc.w, y: acc.y + acc.h / 2 } },
  ]
}

export function EditorCanvas({
  diagram,
  selection,
  apiRef,
  onSelect,
  onDragStart,
  onMove,
  onResize,
  onConnect,
  onDrill,
  onAddAt,
}: {
  diagram: Diagram
  selection: Selection
  apiRef?: Ref<CanvasApi>
  onSelect: (s: Selection) => void
  /** 真的開始拖曳或縮放時呼叫一次（記入復原） */
  onDragStart: () => void
  onMove: (node: string, x: number, y: number) => void
  onResize: (node: string, w: number, h: number) => void
  onConnect: (from: EdgeEnd, to: EdgeEnd) => void
  onDrill: (node: string) => void
  /** 點兩下空白處：在該畫布座標新增元件 */
  onAddAt: (p: Pt) => void
}) {
  const uidBase = `ed${useId()}`
  const ids = markerIds(uidBase)
  const dotsId = `${ids.arrow}-dots`
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const drag = useRef<Drag | null>(null)
  const [link, setLink] = useState<{ from: EdgeEnd; start: Pt; pt: Pt } | null>(null)
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

  // 換到另一張圖時縮放到整張圖
  useLayoutEffect(fit, [diagram.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(apiRef, () => ({
    fit,
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

  function onBackgroundPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    onSelect(null)
    svgRef.current?.setPointerCapture?.(e.pointerId)
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
  }

  function onNodePointerDown(e: PointerEvent, n: ArchNode) {
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
      const box = { ...nodeBox(n), x: p.x - d.ox, y: p.y - d.oy }
      const r = snapMove(box, others, SNAP_PX / view.k, GRID)
      setGuides(r.guides)
      onMove(n.id, r.x, r.y)
    } else {
      const w = clamp(snap(p.x - n.x), SIZE_LIMITS.min, SIZE_LIMITS.maxW)
      const h = clamp(snap(p.y - n.y), SIZE_LIMITS.min, SIZE_LIMITS.maxH)
      if (w !== n.w || h !== n.h) onResize(n.id, w, h)
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (link) {
      const hit = hitPart(diagram.nodes, toWorld(e))
      if (hit) onConnect(link.from, hit)
      setLink(null)
    }
    drag.current = null
    setGuides([])
  }

  const selectedNode = selection?.kind === 'node' ? selection.id : null
  const selectedEdge = selection?.kind === 'edge' ? selection.id : null
  // 畫面上固定大小的線寬與把手（除以縮放倍率）
  const px = (v: number) => v / view.k
  // 縮得很小時點點太密：改成每 2、4… 格一點
  let dotStep = GRID
  while (dotStep * view.k < 12) dotStep *= 2
  const gk = dotStep * view.k

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: ARCH.canvas }}>
      <svg
        ref={svgRef}
        role="group"
        aria-label={`${diagram.title} 編輯畫布`}
        className="block h-full w-full touch-none select-none"
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
            <circle cx={gk / 2} cy={gk / 2} r={1.3} fill={ARCH.dot} />
          </pattern>
        </defs>
        <ArrowDefs ids={ids} />
        <rect id={`${dotsId}-bg`} width="100%" height="100%" fill={`url(#${dotsId})`} />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {diagram.edges.map((e) => (
            <g key={e.id}>
              <EdgeShape
                diagram={diagram}
                edge={e}
                ids={ids}
                selected={e.id === selectedEdge}
                labelBg={ARCH.canvas}
              />
              <EdgeHit
                diagram={diagram}
                edgeId={e.id}
                width={px(14)}
                onPointerDown={(ev) => {
                  ev.stopPropagation()
                  onSelect({ kind: 'edge', id: e.id })
                }}
              />
            </g>
          ))}

          {diagram.nodes.map((n) => {
            const selected = n.id === selectedNode
            const box = nodeBox(n)
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
                  style: { cursor: 'move', outline: 'none' },
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
                      strokeWidth={px(2)}
                      pointerEvents="none"
                    />
                    {/* 右下角：拖曳縮放主方塊（吸附格點） */}
                    <rect
                      data-testid={`resize-${n.id}`}
                      x={n.x + n.w - px(6)}
                      y={n.y + n.h - px(6)}
                      width={px(12)}
                      height={px(12)}
                      fill="#ffffff"
                      stroke={ARCH.select}
                      strokeWidth={px(2)}
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
                {(selected || hover === n.id) &&
                  handlePoints(n).map(({ part, pt }) => (
                    <circle
                      key={part}
                      data-testid={`handle-${n.id}-${part}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={px(7)}
                      fill={ARCH.select}
                      stroke="#ffffff"
                      strokeWidth={px(2)}
                      style={{ cursor: 'crosshair' }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (e.button !== 0) return
                        svgRef.current?.setPointerCapture?.(e.pointerId)
                        setLink({ from: { node: n.id, part }, start: pt, pt })
                      }}
                    >
                      <title>拖到另一個元件以連線</title>
                    </circle>
                  ))}
              </NodeShape>
            )
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

          {link && (
            <line
              x1={link.start.x}
              y1={link.start.y}
              x2={link.pt.x}
              y2={link.pt.y}
              stroke={ARCH.select}
              strokeWidth={px(2)}
              strokeDasharray={`${px(6)} ${px(5)}`}
              pointerEvents="none"
            />
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
        aria-label={label}
        onClick={onClick}
        className="text-ink-2 hover:bg-hover hover:text-ink focus-visible:ring-primary/40 inline-flex size-7 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
      >
        {children}
      </button>
    </Hint>
  )
}

/** 連線的透明粗線（點選範圍）。 */
function EdgeHit({
  diagram,
  edgeId,
  width,
  onPointerDown,
}: {
  diagram: Diagram
  edgeId: string
  width: number
  onPointerDown: (e: PointerEvent) => void
}) {
  const e = diagram.edges.find((x) => x.id === edgeId)
  const pts = e && edgePointsSafe(diagram, e)
  if (!pts) return null
  return (
    <path
      data-testid={`edge-${edgeId}`}
      d={pts}
      fill="none"
      stroke="transparent"
      strokeWidth={width}
      style={{ cursor: 'pointer' }}
      onPointerDown={onPointerDown}
    />
  )
}

function edgePointsSafe(diagram: Diagram, e: Diagram['edges'][number]): string | undefined {
  const pts = edgePoints(diagram.nodes, e)
  return pts && roundedPath(pts)
}
