// 疊在 ImageViewer 上的幾何圖形（影像座標）。px 為「一個螢幕像素等於幾個影像像素」，
// 讓標記與文字在任何縮放下都維持相同的螢幕大小。
import type { Box, Ellipse, Point } from '@/api/client'

/** 程式找到的結果（橘，實線）與合成影像的真值（藍，虛線）。 */
export const FOUND = 'var(--series-1)'
export const TRUTH = 'var(--series-2)'

// 共用線條樣式：non-scaling-stroke 讓線寬固定為 2 個螢幕像素，不隨 ImageViewer 的縮放變粗變細；
// fill none 只畫外框，不遮住底下的影像
const STROKE = { vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 2, fill: 'none' }

/**
 * 四邊形（例如條碼四角、標示表格框）；左上角以實心圓標示方向。
 * - points：影像座標的頂點，依序連成多邊形；第一點視為「左上角」，畫實心圓並把標籤放在它旁邊。
 * - px：一個螢幕像素等於幾個影像像素；圓點半徑、標籤位移都乘上 px，維持固定的螢幕大小。
 * - dashed：虛線（慣例上用於真值 TRUTH）。
 * 沒有頂點時不渲染。
 */
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

/** 軸對齊矩形（例如食物偵測框）；box 為影像座標的左上角與寬高，標籤放在框內左上角。 */
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

/**
 * 旋轉橢圓（例如盤子輪廓）＋中心點。major／minor 為長、短軸「全長」，所以半徑要除以 2。
 * 以 SVG rotate(angle cx cy) 繞中心旋轉；rotate 的單位是「度」，angle 須為度（規格未註明單位）。
 */
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

/**
 * 疊圖文字標籤。字級與描邊都乘上 px，維持固定螢幕大小；
 * paintOrder="stroke" 先畫描邊再畫填色，形成一圈 halo（--overlay-halo），在任何底色的影像上都看得清楚。
 */
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
      stroke="var(--overlay-halo)"
      strokeWidth={3 * px}
    >
      {text}
    </text>
  )
}
