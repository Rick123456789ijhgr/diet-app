// 架構圖的 SVG 畫法（檢視頁、編輯器、匯出共用）：元件、連線、箭頭，以及縮放到內容大小的靜態圖。
import type { ReactNode, Ref, SVGProps } from 'react'

import {
  edgePoints,
  fitFontSize,
  labelPoint,
  partRect,
  roundedPath,
  textWidth,
} from '@/lib/arch/geometry'
import { type ArchEdge, type ArchNode, bounds, type Diagram, hasAccent } from '@/lib/arch/model'
import { ARCH } from '@/lib/arch/theme'

export const EDGE_WIDTH = 3

/** 掛在元件外層 <g> 的屬性（含 data-* 屬性）。 */
export type NodeGProps = SVGProps<SVGGElement> & { [key: `data-${string}`]: string | undefined }
/** 靜態圖（檢視頁、匯出）在內容外留的邊（px）。 */
export const PADDING = 60

/** 同一頁可能同時有多張 SVG（例如編輯器＋隱藏的匯出用圖），箭頭的 id 要各自不同。 */
export function markerIds(prefix: string) {
  const safe = prefix.replace(/[^a-zA-Z0-9]/g, '')
  return { arrow: `${safe}-arrow`, arrowSel: `${safe}-arrow-sel` }
}

export function ArrowDefs({ ids }: { ids: ReturnType<typeof markerIds> }) {
  return (
    <defs>
      {[
        [ids.arrow, ARCH.edge],
        [ids.arrowSel, ARCH.select],
      ].map(([id, color]) => (
        <marker
          key={id}
          id={id}
          viewBox="0 0 12 12"
          refX="11"
          refY="6"
          markerWidth="12"
          markerHeight="12"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L12 6 L0 12 Z" fill={color} />
        </marker>
      ))}
    </defs>
  )
}

/** 一條連線（折線＋箭頭＋標籤）。labelBg 為標籤底色（與畫布同色，蓋住線）。 */
export function EdgeShape({
  diagram,
  edge: e,
  ids,
  selected,
  labelBg,
}: {
  diagram: Diagram
  edge: ArchEdge
  ids: ReturnType<typeof markerIds>
  selected?: boolean
  labelBg: string
}) {
  const pts = edgePoints(diagram.nodes, e)
  if (!pts) return null
  const lp = labelPoint(pts)
  const lw = e.label ? textWidth(e.label, 16) + 16 : 0
  return (
    <g>
      <path
        d={roundedPath(pts)}
        fill="none"
        stroke={selected ? ARCH.select : ARCH.edge}
        strokeWidth={EDGE_WIDTH}
        strokeLinejoin="round"
        markerEnd={`url(#${selected ? ids.arrowSel : ids.arrow})`}
      />
      {e.label && (
        <g>
          <rect x={lp.x - lw / 2} y={lp.y - 13} width={lw} height={26} rx={4} fill={labelBg} />
          <text
            x={lp.x}
            y={lp.y}
            fontSize={16}
            fill={ARCH.edgeLabel}
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

/**
 * 一個元件（主方塊＋強調塊）。gProps 掛在外層 <g>（事件、role 等）；
 * children 畫在元件上層（編輯器的選取框與把手、檢視頁的 <title> 提示）。
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
  // 字級依方塊高度等比縮放（參考尺寸為高 160）
  const k = Math.min(1.3, Math.max(0.6, n.h / 160))
  const pad = 28 * k
  const titleSize = fitFontSize(n.title, 30 * k, n.w - pad * 2, 12)
  const titleY = n.kicker ? n.y + n.h * 0.68 : n.y + n.h / 2 + titleSize * 0.36
  const accent = hasAccent(n) ? partRect(n, 'accent') : null
  const accentSize = accent ? fitFontSize(n.accent, 26 * k, accent.w - 20, 12) : 0
  return (
    <g {...gProps}>
      <rect
        x={n.x}
        y={n.y}
        width={n.w}
        height={n.h}
        fill={ARCH.node}
        stroke={ARCH.nodeStroke}
        strokeWidth={1}
      />
      {n.kicker && (
        <text
          x={n.x + pad}
          y={n.y + n.h * 0.38}
          fontSize={20 * k}
          letterSpacing={5 * k}
          fontWeight={700}
          fill={ARCH.kicker}
        >
          {n.kicker}
        </text>
      )}
      <text x={n.x + pad} y={titleY} fontSize={titleSize} fontWeight={900} fill={ARCH.title}>
        {n.title}
      </text>
      {accent && (
        <g>
          <rect x={accent.x} y={accent.y} width={accent.w} height={accent.h} fill={ARCH.accent} />
          <text
            x={accent.x + accent.w / 2}
            y={accent.y + accent.h / 2}
            fontSize={accentSize}
            fontWeight={900}
            fill={ARCH.accentText}
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
  return (
    <g transform={`translate(${n.x + n.w - 34} ${n.y + 12})`} pointerEvents="none">
      <rect x={7} y={2} width={13} height={13} fill="none" stroke={ARCH.kicker} strokeWidth={2} />
      <rect
        x={2}
        y={7}
        width={13}
        height={13}
        fill={ARCH.node}
        stroke={ARCH.kicker}
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
  const b = bounds(diagram.nodes)
  const box = { x: b.x - PADDING, y: b.y - PADDING, w: b.w + PADDING * 2, h: b.h + PADDING * 2 }
  const ids = markerIds(idPrefix)
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
      <ArrowDefs ids={ids} />
      {background && <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={background} />}
      {diagram.edges.map((e) => (
        <EdgeShape key={e.id} diagram={diagram} edge={e} ids={ids} labelBg={labelBg} />
      ))}
      {diagram.nodes.map((n) => (
        <NodeShape key={n.id} node={n} gProps={nodeProps?.(n)}>
          {nodeChildren?.(n)}
        </NodeShape>
      ))}
    </svg>
  )
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
