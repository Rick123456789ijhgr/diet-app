// 架構圖的配色、預設樣式與字型。
//
// 這裡刻意寫死色碼、不用 index.css 的主題變數：圖是「產出物」，匯出的 SVG／PNG 必須自帶顏色，
// 離開工作台（例如貼進簡報）也長得一樣，不隨工作台的深淺色模式改變。
// 元件與連線的顏色可在編輯器逐一修改（存在文件裡）；這裡只是新元件的預設值與色票。
import type { EdgeStyle, NodeStyle } from './model'

export const ARCH = {
  /** 畫布底色（檢視與編輯器）；匯出時用 exportBg */
  canvas: '#f6f7f9',
  exportBg: '#ffffff',
  dot: '#b9c1cc',
  /** 編輯時的選取框、定位點（不會匯出） */
  select: '#2563eb',
  /** 對齊參考線 */
  guide: '#e11d74',
  font: "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', 'Heiti TC', sans-serif",
} as const

/** 新元件的預設樣式（深藍方塊、金色小標、橘紅強調塊，同參考簡報）。 */
export const DEFAULT_NODE_STYLE: NodeStyle = {
  shape: 'rect',
  fill: '#14243b',
  stroke: '#0d1a2c',
  strokeWidth: 1,
  radius: 0,
  textColor: '#f3f5f8',
  kickerColor: '#e8a33d',
  accentFill: '#d9502f',
  accentText: '#ffffff',
  titleSize: 30,
  kickerSize: 20,
  align: 'left',
}

/** 新連線的預設樣式。 */
export const DEFAULT_EDGE_STYLE: EdgeStyle = {
  color: '#3a4657',
  width: 3,
  dash: 'solid',
  arrow: 'end',
  shape: 'orthogonal',
  labelSize: 16,
  labelColor: 'auto',
  labelBg: 'auto',
  labelBold: false,
  labelPos: 50,
}

/** 色票（顏色欄位的快速選項）。'none' 表示透明（只用在底色與框線）。 */
export const SWATCHES = [
  '#14243b',
  '#1e3a8a',
  '#2563eb',
  '#0f766e',
  '#15803d',
  '#e8a33d',
  '#d9502f',
  '#be123c',
  '#7c3aed',
  '#3a4657',
  '#94a3b8',
  '#e2e8f0',
  '#ffffff',
  '#111827',
] as const
