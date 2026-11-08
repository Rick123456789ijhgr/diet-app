// 架構圖的 SVG 畫法（檢視頁、編輯器、匯出共用）：元件（五種形狀）、連線（三種樣式）、箭頭，
// 以及縮放到內容大小的靜態圖。
import type { ReactNode, Ref, SVGProps } from 'react'

import {
  type EdgeGeometry,
  fitFontSize,
  layoutEdges,
  partRect,
  textWidth,
} from '@/lib/arch/geometry'
import {
  type ArchEdge,
  type ArchNode,
  bounds,
  type Diagram,
  type EdgeStyle,
  hasAccent,
} from '@/lib/arch/model'
import { ARCH } from '@/lib/arch/theme'

/** 靜態圖（檢視頁、匯出）在內容外留的邊（px）。 */
export const PADDING = 60

/** 掛在元件外層 <g> 的屬性（含 data-* 屬性）。 */
export type NodeGProps = SVGProps<SVGGElement> & { [key: `data-${string}`]: string | undefined }

/** 箭頭的 id：每種顏色一個（marker 的顏色無法跟著線變），前綴區分同一頁的多張 SVG。 */
export function arrowId(prefix: string, color: string): string {
  return `${prefix.replace(/[^a-zA-Z0-9]/g, '')}-arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`
}

/** 這張圖用到的所有箭頭顏色（含選取色）。 */
export function ArrowDefs({ prefix, edges }: { prefix: string; edges: ArchEdge[] }) {
  const colors = [...new Set([ARCH.select, ...edges.map((e) => e.style.color)])]
  return (
    <defs>
      {colors.map((color) => (
        <marker
          key={color}
          id={arrowId(prefix, color)}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          // 以線寬為單位：粗線的箭頭跟著變大
          markerWidth="4.2"
          markerHeight="4.2"
          markerUnits="strokeWidth"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L12 6 L0 12 Z" fill={color} />
        </marker>
      ))}
    </defs>
  )
}

function dashArray(s: EdgeStyle): string | undefined {
  if (s.dash === 'dashed') return `${s.width * 3} ${s.width * 2}`
  if (s.dash === 'dotted') return `0 ${s.width * 2}`
  return undefined
}

/** 一條連線（路徑＋箭頭＋標籤）。canvasBg 為畫布底色（標籤底色選「自動」時用它蓋住線）。 */
export function EdgeShape({
  edge: e,
  geometry: g,
  prefix,
  selected,
  canvasBg,
}: {
  edge: ArchEdge
  geometry: EdgeGeometry | undefined
  prefix: string
  selected?: boolean
  canvasBg: string
}) {
  if (!g) return null
  const s = e.style
  const color = selected ? ARCH.select : s.color
  const marker = `url(#${arrowId(prefix, color)})`
  const textColor = s.labelColor === 'auto' ? s.color : s.labelColor
  const bg = s.labelBg === 'auto' ? canvasBg : s.labelBg
  const lw = e.label ? textWidth(e.label, s.labelSize) + s.labelSize : 0
  const lh = s.labelSize * 1.6
  return (
    <g>
      <path
        d={g.d}
        fill="none"
        stroke={color}
        strokeWidth={s.width}
        strokeDasharray={dashArray(s)}
        strokeLinecap={s.dash === 'dotted' ? 'round' : 'butt'}
        strokeLinejoin="round"
        markerEnd={s.arrow === 'end' || s.arrow === 'both' ? marker : undefined}
        markerStart={s.arrow === 'start' || s.arrow === 'both' ? marker : undefined}
      />
      {e.label && (
        <g>
          {bg !== 'none' && (
            <rect
              x={g.label.x - lw / 2}
              y={g.label.y - lh / 2}
              width={lw}
              height={lh}
              rx={4}
              fill={bg}
            />
          )}
          <text
            x={g.label.x}
            y={g.label.y}
            fontSize={s.labelSize}
            fontWeight={s.labelBold ? 700 : 400}
            fill={textColor}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {e.label}
          </text>
        </g>
      )}
    </g>
  )
}

/** 各角圓角可不同的矩形路徑（主圖形接強調塊時，相接那側不圓角）。 */
function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: [number, number, number, number],
): string {
  const m = Math.min(w, h) / 2
  const [a, b, c, d] = [tl, tr, br, bl].map((r) => Math.min(r, m)) as [
    number,
    number,
    number,
    number,
  ]
  return [
    `M${x + a} ${y}`,
    `H${x + w - b}`,
    b ? `A${b} ${b} 0 0 1 ${x + w} ${y + b}` : '',
    `V${y + h - c}`,
    c ? `A${c} ${c} 0 0 1 ${x + w - c} ${y + h}` : '',
    `H${x + d}`,
    d ? `A${d} ${d} 0 0 1 ${x} ${y + h - d}` : '',
    `V${y + a}`,
    a ? `A${a} ${a} 0 0 1 ${x + a} ${y}` : '',
    'Z',
  ].join(' ')
}

/** 主圖形的外框（依形狀）。 */
function MainShape({ node: n }: { node: ArchNode }) {
  const s = n.style
  const paint = {
    fill: s.fill,
    stroke: s.strokeWidth > 0 ? s.stroke : 'none',
    strokeWidth: s.strokeWidth,
    // 透明底色時內部也要能點選
    pointerEvents: 'all' as const,
  }
  const { x, y, w, h } = n
  switch (s.shape) {
    case 'ellipse':
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...paint} />
    case 'diamond':
      return (
        <polygon
          points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
          {...paint}
        />
      )
    case 'hexagon': {
      const i = Math.min(w * 0.22, h / 2)
      return (
        <polygon
          points={`${x + i},${y} ${x + w - i},${y} ${x + w},${y + h / 2} ${x + w - i},${y + h} ${x + i},${y + h} ${x},${y + h / 2}`}
          {...paint}
        />
      )
    }
    case 'cylinder': {
      const ry = Math.min(h * 0.12, 22)
      const rx = w / 2
      return (
        <g>
          <path
            d={`M${x} ${y + ry} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} Z`}
            {...paint}
          />
          {/* 頂面的下緣弧線 */}
          <path
            d={`M${x} ${y + ry} A${rx} ${ry} 0 0 0 ${x + w} ${y + ry}`}
            fill="none"
            stroke={s.strokeWidth > 0 ? s.stroke : s.textColor}
            strokeOpacity={s.strokeWidth > 0 ? 1 : 0.35}
            strokeWidth={Math.max(s.strokeWidth, 1)}
          />
        </g>
      )
    }
    default: {
      const r = s.radius
      const corners: [number, number, number, number] = hasAccent(n) ? [r, 0, 0, r] : [r, r, r, r]
      return <path d={roundedRect(x, y, w, h, corners)} {...paint} />
    }
  }
}

/** 形狀內可放文字的寬度比例（橢圓、菱形邊緣內縮）。 */
const TEXT_WIDTH_RATIO: Record<ArchNode['style']['shape'], number> = {
  rect: 1,
  ellipse: 0.72,
  diamond: 0.56,
  cylinder: 0.9,
  hexagon: 0.72,
}

/**
 * 一個元件（主圖形＋強調塊）。gProps 掛在外層 <g>（事件、role 等）；
 * children 畫在元件上層（編輯器的選取框與定位點、檢視頁的 <title> 提示）。
 */
export function NodeShape({
  node: n,
  gProps,
  children,
}: {
  node: ArchNode
  gProps?: NodeGProps
  children?: ReactNode
}) {
  const s = n.style
  const left = s.shape === 'rect' && s.align === 'left'
  const pad = left ? Math.max(16, Math.min(28, n.w * 0.12)) : 12
  const inner = n.w * TEXT_WIDTH_RATIO[s.shape] - pad * 2
  const titleSize = fitFontSize(n.title, s.titleSize, inner)
  const kickerSpacing = s.kickerSize * 0.25
  const kickerSize = n.kicker ? fitFontSize(n.kicker, s.kickerSize, inner, 8, kickerSpacing) : 0
  // 小標＋標題當成一個區塊，在圖形內垂直置中（圓柱扣掉頂面）
  const top = s.shape === 'cylinder' ? Math.min(n.h * 0.12, 22) : 0
  const gap = n.kicker ? Math.round(titleSize * 0.35) : 0
  const blockH = kickerSize + gap + titleSize
  const blockTop = n.y + top + (n.h - top - blockH) / 2
  const kickerY = blockTop + kickerSize * 0.85
  const titleY = blockTop + kickerSize + gap + titleSize * 0.85
  const tx = left ? n.x + pad : n.x + n.w / 2
  const anchor = left ? 'start' : 'middle'
  const accent = hasAccent(n) ? partRect(n, 'accent') : null
  const accentSize = accent ? fitFontSize(n.accent, s.titleSize * 0.87, accent.w - 20) : 0
  const r = s.shape === 'rect' ? Math.min(s.radius, n.h / 2) : 0

  return (
    <g {...gProps}>
      <MainShape node={n} />
      {n.kicker && (
        <text
          x={tx}
          y={kickerY}
          fontSize={kickerSize}
          letterSpacing={kickerSpacing}
          fontWeight={700}
          fill={s.kickerColor}
          textAnchor={anchor}
        >
          {n.kicker}
        </text>
      )}
      <text
        x={tx}
        y={titleY}
        fontSize={titleSize}
        fontWeight={900}
        fill={s.textColor}
        textAnchor={anchor}
      >
        {n.title}
      </text>
      {accent && (
        <g>
          <path
            d={roundedRect(accent.x, accent.y, accent.w, accent.h, [0, r, r, 0])}
            fill={s.accentFill}
          />
          <text
            x={accent.x + accent.w / 2}
            y={accent.y + accent.h / 2}
            fontSize={accentSize}
            fontWeight={900}
            fill={s.accentText}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {n.accent}
          </text>
        </g>
      )}
      {children}
    </g>
  )
}

/** 細部圖圖示（右上角兩個疊起的方塊），表示可以點進去。 */
export function DrillIcon({ node: n }: { node: ArchNode }) {
  const c = n.style.kickerColor
  const inset = n.style.shape === 'rect' ? 12 + Math.min(n.style.radius, 24) * 0.3 : n.h * 0.18
  return (
    <g transform={`translate(${n.x + n.w - 22 - inset} ${n.y + inset})`} pointerEvents="none">
      <rect x={7} y={2} width={13} height={13} fill="none" stroke={c} strokeWidth={2} />
      <rect
        x={2}
        y={7}
        width={13}
        height={13}
        fill={n.style.fill === 'none' ? ARCH.canvas : n.style.fill}
        stroke={c}
        strokeWidth={2}
      />
    </g>
  )
}

/**
 * 縮放到內容大小的靜態圖（檢視頁與匯出用）：viewBox 為所有元件的外框外加 PADDING。
 * - background：畫一塊底色（匯出時用，讓 PNG 不透明）。
 * - nodeProps／nodeChildren：檢視頁加上點擊進入細部圖與滑過提示。
 */
export function StaticDiagram({
  diagram,
  idPrefix,
  background,
  labelBg,
  svgRef,
  nodeProps,
  nodeChildren,
  ...svgProps
}: {
  diagram: Diagram
  idPrefix: string
  background?: string
  labelBg: string
  svgRef?: Ref<SVGSVGElement>
  nodeProps?: (n: ArchNode) => NodeGProps
  nodeChildren?: (n: ArchNode) => ReactNode
} & SVGProps<SVGSVGElement>) {
  const box = staticBox(diagram)
  const geometries = layoutEdges(diagram.nodes, diagram.edges)
  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      width={box.w}
      height={box.h}
      fontFamily={ARCH.font}
      {...svgProps}
    >
      <ArrowDefs prefix={idPrefix} edges={diagram.edges} />
      {background && <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={background} />}
      {diagram.edges.map((e) => (
        <EdgeShape
          key={e.id}
          edge={e}
          geometry={geometries.get(e.id)}
          prefix={idPrefix}
          canvasBg={labelBg}
        />
      ))}
      {diagram.nodes.map((n) => (
        <NodeShape key={n.id} node={n} gProps={nodeProps?.(n)}>
          {nodeChildren?.(n)}
        </NodeShape>
      ))}
    </svg>
  )
}

/** 靜態圖的範圍：內容外框外加 PADDING。 */
export function staticBox(d: Diagram) {
  const b = bounds(d.nodes, d.edges)
  return { x: b.x - PADDING, y: b.y - PADDING, w: b.w + PADDING * 2, h: b.h + PADDING * 2 }
}

/** SVG 元素轉成可下載的字串。 */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.removeAttribute('class')
  clone.removeAttribute('style')
  clone.removeAttribute('aria-hidden')
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(clone)
}

/** SVG 字串轉 PNG（scale 倍的原尺寸）。 */
export async function svgToPng(
  svgText: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
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
