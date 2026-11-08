// 架構圖畫板（SVG，1920×1080 畫板座標）：畫出頁首、標題、元件與連線；編輯模式可拖曳元件、拉線連接。
// 標示 data-editor 的元素（選取框、連線把手、細部圖圖示）只在畫面上出現，匯出時會移除。
import { type PointerEvent, type RefObject, useId, useRef, useState } from 'react'

import {
  fitFontSize,
  hitPart,
  labelPoint,
  partRect,
  type Pt,
  roundedPath,
  edgePoints,
  textWidth,
} from '@/lib/arch/geometry'
import {
  ARTBOARD,
  type ArchNode,
  type Diagram,
  type EdgeEnd,
  hasAccent,
  type Part,
} from '@/lib/arch/model'
import { SLIDE } from '@/lib/arch/theme'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

/** 頁首、標章、標題的位置（與參考簡報相同）。 */
const MARGIN = 120
const EDGE_WIDTH = 4

interface DragState {
  id: string
  ox: number
  oy: number
  sx: number
  sy: number
  moved: boolean
}

export function ArchCanvas({
  diagram,
  editable,
  selection,
  svgRef,
  onSelect,
  onDragStart,
  onMove,
  onConnect,
  onDrill,
}: {
  diagram: Diagram
  editable: boolean
  selection: Selection
  svgRef: RefObject<SVGSVGElement | null>
  onSelect: (s: Selection) => void
  /** 真的開始拖曳時呼叫一次（記入復原） */
  onDragStart: () => void
  onMove: (node: string, x: number, y: number) => void
  onConnect: (from: EdgeEnd, to: EdgeEnd) => void
  onDrill: (node: string) => void
}) {
  // useId 會含冒號等字元，不適合放進 url(#…)；換成安全字元
  const uidBase = `arch${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const ids = {
    glow: `${uidBase}-glow`,
    arrow: `${uidBase}-arrow`,
    arrowSel: `${uidBase}-arrow-sel`,
  }
  const drag = useRef<DragState | null>(null)
  const [link, setLink] = useState<{ from: EdgeEnd; start: Pt; pt: Pt } | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  /** 螢幕座標 → 畫板座標（jsdom 沒有 getScreenCTM，回傳原點）。 */
  function toLocal(e: { clientX: number; clientY: number }): Pt {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM?.()
    if (!svg || !ctm) return { x: 0, y: 0 }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  function onNodePointerDown(e: PointerEvent, n: ArchNode) {
    e.stopPropagation()
    onSelect({ kind: 'node', id: n.id })
    if (!editable || e.button !== 0) return
    const p = toLocal(e)
    drag.current = { id: n.id, ox: p.x - n.x, oy: p.y - n.y, sx: p.x, sy: p.y, moved: false }
  }

  function onHandlePointerDown(e: PointerEvent, n: ArchNode, part: Part, start: Pt) {
    e.stopPropagation()
    if (e.button !== 0) return
    svgRef.current?.setPointerCapture?.(e.pointerId)
    setLink({ from: { node: n.id, part }, start, pt: start })
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current
    if (!d && !link) return
    const p = toLocal(e)
    if (link) setLink({ ...link, pt: p })
    if (d) {
      if (!d.moved) {
        // 移動超過幾 px 才算拖曳，避免點一下就被記成一步
        if (Math.hypot(p.x - d.sx, p.y - d.sy) < 4) return
        d.moved = true
        svgRef.current?.setPointerCapture?.(e.pointerId)
        onDragStart()
      }
      onMove(d.id, p.x - d.ox, p.y - d.oy)
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (link) {
      const hit = hitPart(diagram.nodes, toLocal(e))
      if (hit) onConnect(link.from, hit)
      setLink(null)
    }
    drag.current = null
  }

  const selectedNode = selection?.kind === 'node' ? selection.id : null
  const selectedEdge = selection?.kind === 'edge' ? selection.id : null
  const badgeW = diagram.badge ? textWidth(diagram.badge, 34) + 58 : 0

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${ARTBOARD.w} ${ARTBOARD.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={`${diagram.title} 架構圖`}
      className="block h-full w-full touch-none select-none"
      fontFamily={SLIDE.font}
      onPointerDown={() => onSelect(null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        setLink(null)
      }}
    >
      <defs>
        <radialGradient id={ids.glow}>
          <stop offset="0" stopColor={SLIDE.glow} stopOpacity="0.55" />
          <stop offset="0.6" stopColor={SLIDE.glow} stopOpacity="0.18" />
          <stop offset="1" stopColor={SLIDE.glow} stopOpacity="0" />
        </radialGradient>
        {[
          [ids.arrow, SLIDE.edge],
          [ids.arrowSel, SLIDE.select],
        ].map(([id, color]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 12 12"
            refX="11"
            refY="6"
            markerWidth="14"
            markerHeight="14"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L12 6 L0 12 Z" fill={color} />
          </marker>
        ))}
      </defs>

      {/* 背景：深藍底＋右下斜向的藍色光暈 */}
      <rect width={ARTBOARD.w} height={ARTBOARD.h} fill={SLIDE.bg} />
      <ellipse
        cx={1500}
        cy={860}
        rx={980}
        ry={300}
        transform="rotate(-24 1500 860)"
        fill={`url(#${ids.glow})`}
      />

      {/* 頁首：章節＋頁碼＋細線 */}
      <text x={MARGIN} y={80} fontSize={20} letterSpacing={6} fill={SLIDE.header} fontWeight={600}>
        {diagram.section}
      </text>
      <text
        x={ARTBOARD.w - MARGIN}
        y={80}
        fontSize={20}
        letterSpacing={6}
        fill={SLIDE.header}
        textAnchor="end"
      >
        {diagram.page}
      </text>
      <line
        x1={MARGIN}
        x2={ARTBOARD.w - MARGIN}
        y1={100.5}
        y2={100.5}
        stroke={SLIDE.rule}
        strokeWidth={1.5}
      />

      {/* 標章＋標題 */}
      {diagram.badge && (
        <g>
          <rect x={MARGIN} y={160} width={badgeW} height={58} fill={SLIDE.badgeBg} />
          <text
            x={MARGIN + badgeW / 2}
            y={189}
            fontSize={34}
            fontWeight={900}
            fill={SLIDE.badgeText}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {diagram.badge}
          </text>
        </g>
      )}
      <text
        x={MARGIN}
        y={diagram.badge ? 275 : 220}
        fontSize={40}
        fontWeight={900}
        fill={SLIDE.title}
      >
        {diagram.title}
      </text>

      {/* 連線在元件下層：箭頭尖端剛好停在元件邊上 */}
      {diagram.edges.map((e) => {
        const pts = edgePoints(diagram.nodes, e)
        if (!pts) return null
        const d = roundedPath(pts)
        const sel = e.id === selectedEdge
        const lp = labelPoint(pts)
        const lw = e.label ? textWidth(e.label, 18) + 20 : 0
        return (
          <g key={e.id}>
            <path
              d={d}
              fill="none"
              stroke={sel ? SLIDE.select : SLIDE.edge}
              strokeWidth={EDGE_WIDTH}
              strokeLinejoin="round"
              markerEnd={`url(#${sel ? ids.arrowSel : ids.arrow})`}
            />
            {e.label && (
              <g>
                <rect
                  x={lp.x - lw / 2}
                  y={lp.y - 16}
                  width={lw}
                  height={32}
                  rx={4}
                  fill={SLIDE.edgeLabelBg}
                />
                <text
                  x={lp.x}
                  y={lp.y}
                  fontSize={18}
                  fill={SLIDE.edgeLabel}
                  textAnchor="middle"
                  dominantBaseline="central"
                  letterSpacing={1}
                >
                  {e.label}
                </text>
              </g>
            )}
            {/* 透明的粗線當點選範圍 */}
            <path
              data-editor
              data-testid={`edge-${e.id}`}
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={22}
              style={{ cursor: 'pointer' }}
              onPointerDown={(ev) => {
                ev.stopPropagation()
                onSelect({ kind: 'edge', id: e.id })
              }}
            />
          </g>
        )
      })}

      {diagram.nodes.map((n) => (
        <NodeShape
          key={n.id}
          node={n}
          editable={editable}
          selected={n.id === selectedNode}
          showHandles={editable && (n.id === selectedNode || n.id === hover)}
          onPointerDown={(e) => onNodePointerDown(e, n)}
          onHandlePointerDown={(e, part, start) => onHandlePointerDown(e, n, part, start)}
          onHover={(on) => setHover(on ? n.id : (h) => (h === n.id ? null : h))}
          onDrill={() => onDrill(n.id)}
          onSelect={() => onSelect({ kind: 'node', id: n.id })}
        />
      ))}

      {/* 拉線中：從把手到游標的虛線 */}
      {link && (
        <line
          data-editor
          x1={link.start.x}
          y1={link.start.y}
          x2={link.pt.x}
          y2={link.pt.y}
          stroke={SLIDE.select}
          strokeWidth={3}
          strokeDasharray="10 8"
          pointerEvents="none"
        />
      )}
    </svg>
  )
}

/** 連線把手的位置：有強調塊時主方塊的把手在下緣中點，其餘在右緣中點。 */
function handlePoints(n: ArchNode): { part: Part; pt: Pt }[] {
  const main = partRect(n, 'main')
  if (!hasAccent(n)) return [{ part: 'main', pt: { x: main.x + main.w, y: main.y + main.h / 2 } }]
  const acc = partRect(n, 'accent')
  return [
    { part: 'main', pt: { x: main.x + main.w / 2, y: main.y + main.h } },
    { part: 'accent', pt: { x: acc.x + acc.w, y: acc.y + acc.h / 2 } },
  ]
}

function NodeShape({
  node: n,
  editable,
  selected,
  showHandles,
  onPointerDown,
  onHandlePointerDown,
  onHover,
  onDrill,
  onSelect,
}: {
  node: ArchNode
  editable: boolean
  selected: boolean
  showHandles: boolean
  onPointerDown: (e: PointerEvent) => void
  onHandlePointerDown: (e: PointerEvent, part: Part, start: Pt) => void
  onHover: (on: boolean) => void
  onDrill: () => void
  onSelect: () => void
}) {
  // 字級依方塊高度等比縮放（參考尺寸為高 180）
  const k = Math.min(1.3, Math.max(0.6, n.h / 180))
  const pad = 34 * k
  const kickerSize = 24 * k
  const titleSize = fitFontSize(n.title, 36 * k, n.w - pad * 2, 14)
  const titleY = n.kicker ? n.y + n.h * 0.71 : n.y + n.h / 2 + titleSize * 0.36
  const accent = hasAccent(n) ? partRect(n, 'accent') : null
  const accentSize = accent ? fitFontSize(n.accent, 30 * k, accent.w - 24, 14) : 0
  const drillable = Boolean(n.child)
  const totalW = n.w + (accent?.w ?? 0)

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={n.title || '未命名元件'}
      aria-pressed={selected}
      data-node={n.id}
      style={{ cursor: editable ? 'move' : drillable ? 'zoom-in' : 'pointer', outline: 'none' }}
      onPointerDown={onPointerDown}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onDoubleClick={() => drillable && onDrill()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && drillable) onDrill()
        else if (e.key === 'Enter' || e.key === ' ') onSelect()
        else return
        e.preventDefault()
      }}
    >
      <rect
        x={n.x}
        y={n.y}
        width={n.w}
        height={n.h}
        fill={SLIDE.node}
        stroke={SLIDE.nodeStroke}
        strokeWidth={1.5}
      />
      {n.kicker && (
        <text
          x={n.x + pad}
          y={n.y + n.h * 0.38}
          fontSize={kickerSize}
          letterSpacing={6 * k}
          fontWeight={700}
          fill={SLIDE.kicker}
        >
          {n.kicker}
        </text>
      )}
      <text x={n.x + pad} y={titleY} fontSize={titleSize} fontWeight={900} fill={SLIDE.title}>
        {n.title}
      </text>
      {accent && (
        <g>
          <rect x={accent.x} y={accent.y} width={accent.w} height={accent.h} fill={SLIDE.accent} />
          <text
            x={accent.x + accent.w / 2}
            y={accent.y + accent.h / 2}
            fontSize={accentSize}
            fontWeight={900}
            fill={SLIDE.accentText}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {n.accent}
          </text>
        </g>
      )}

      {/* 有細部圖：右上角疊層圖示（點一下進入） */}
      {drillable && (
        <g
          data-editor
          transform={`translate(${n.x + n.w - 40} ${n.y + 16})`}
          style={{ cursor: 'zoom-in' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onDrill()
          }}
        >
          <title>進入細部圖</title>
          <rect width={26} height={26} fill="transparent" />
          <rect
            x={8}
            y={2}
            width={14}
            height={14}
            fill="none"
            stroke={SLIDE.kicker}
            strokeWidth={2}
          />
          <rect
            x={3}
            y={8}
            width={14}
            height={14}
            fill={SLIDE.node}
            stroke={SLIDE.kicker}
            strokeWidth={2}
          />
        </g>
      )}

      {selected && (
        <rect
          data-editor
          x={n.x - 6}
          y={n.y - 6}
          width={totalW + 12}
          height={n.h + 12}
          fill="none"
          stroke={SLIDE.select}
          strokeWidth={2.5}
          strokeDasharray="8 6"
          pointerEvents="none"
        />
      )}

      {showHandles &&
        handlePoints(n).map(({ part, pt }) => (
          <circle
            key={part}
            data-editor
            data-testid={`handle-${n.id}-${part}`}
            cx={pt.x}
            cy={pt.y}
            r={10}
            fill={SLIDE.select}
            stroke={SLIDE.bg}
            strokeWidth={3}
            style={{ cursor: 'crosshair' }}
            onPointerDown={(e) => onHandlePointerDown(e, part, pt)}
          >
            <title>拖到另一個元件以連線</title>
          </circle>
        ))}
    </g>
  )
}

/** 匯出用的乾淨 SVG 字串：移除編輯用元素，補上寬高。 */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[data-editor]').forEach((el) => el.remove())
  clone.removeAttribute('class')
  clone.removeAttribute('role')
  clone.setAttribute('width', String(ARTBOARD.w))
  clone.setAttribute('height', String(ARTBOARD.h))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(clone)
}

/** SVG 字串轉 PNG（scale 倍的畫板尺寸）。 */
export async function svgToPng(svgText: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = ARTBOARD.w * scale
    canvas.height = ARTBOARD.h * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('瀏覽器不支援 canvas')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('無法產生 PNG'))), 'image/png'),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
