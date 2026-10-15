// 疊在 ImageViewer 上的幾何圖形（影像座標）。px 為「一個螢幕像素等於幾個影像像素」，
// 讓標記與文字在任何縮放下都維持相同的螢幕大小。
import type { Box, Ellipse, Point } from '@/api/client'

/** 程式找到的結果（橘，實線）與合成影像的真值（青綠，虛線）；影像檢視區固定是深色底。 */
export const FOUND = 'var(--series-2)'
export const TRUTH = 'var(--series-3)'

const STROKE = { vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 2, fill: 'none' }

/** 四邊形（例如條碼四角、標示表格框）；左上角以實心圓標示方向。 */
export function Quad({
  points,
  color,
  label,
  px,
  dashed,
}: {
  points: Point[]
  color: string
  label?: string
  px: number
  dashed?: boolean
}) {
  if (points.length === 0) return null
  const first = points[0]!
  return (
    <g>
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(' ')}
        stroke={color}
        strokeDasharray={dashed ? '6 4' : undefined}
        {...STROKE}
      />
      <circle cx={first.x} cy={first.y} r={5 * px} fill={color} />
      {label && (
        <Label x={first.x + 8 * px} y={first.y - 6 * px} text={label} color={color} px={px} />
      )}
    </g>
  )
}

export function Rect({
  box,
  color,
  label,
  px,
  dashed,
}: {
  box: Box
  color: string
  label?: string
  px: number
  dashed?: boolean
}) {
  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        stroke={color}
        strokeDasharray={dashed ? '6 4' : undefined}
        {...STROKE}
      />
      {label && <Label x={box.x + 4 * px} y={box.y + 16 * px} text={label} color={color} px={px} />}
    </g>
  )
}

export function EllipseShape({
  e,
  color,
  px,
  dashed,
}: {
  e: Ellipse
  color: string
  px: number
  dashed?: boolean
}) {
  return (
    <g transform={`rotate(${e.angle} ${e.cx} ${e.cy})`}>
      <ellipse
        cx={e.cx}
        cy={e.cy}
        rx={e.major / 2}
        ry={e.minor / 2}
        stroke={color}
        strokeDasharray={dashed ? '6 4' : undefined}
        {...STROKE}
      />
      <circle cx={e.cx} cy={e.cy} r={3 * px} fill={color} />
    </g>
  )
}

function Label({
  x,
  y,
  text,
  color,
  px,
}: {
  x: number
  y: number
  text: string
  color: string
  px: number
}) {
  return (
    <text
      x={x}
      y={y}
      fill={color}
      fontSize={13 * px}
      fontWeight={600}
      paintOrder="stroke"
      stroke="rgb(15 15 14 / 0.85)"
      strokeWidth={3 * px}
    >
      {text}
    </text>
  )
}
