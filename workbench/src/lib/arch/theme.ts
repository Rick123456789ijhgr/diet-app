// 架構圖的配色與字型：淺色畫布（編輯器加點點格子），元件為深藍方塊＋金色小標＋橘紅強調塊。
//
// 這裡刻意寫死色碼、不用 index.css 的主題變數：圖是「產出物」，匯出的 SVG／PNG 必須自帶顏色，
// 離開工作台（例如貼進簡報）也長得一樣，不隨工作台的深淺色模式改變。
export const ARCH = {
  /** 畫布底色（檢視與編輯器）；匯出時用 exportBg */
  canvas: '#f6f7f9',
  exportBg: '#ffffff',
  dot: '#c5ccd6',
  node: '#14243b',
  nodeStroke: '#0d1a2c',
  kicker: '#e8a33d',
  title: '#f3f5f8',
  accent: '#d9502f',
  accentText: '#ffffff',
  edge: '#3a4657',
  edgeLabel: '#3a4657',
  /** 編輯時的選取框、把手（不會匯出） */
  select: '#2563eb',
  /** 吸附時的對齊參考線 */
  guide: '#e11d74',
  font: "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', 'Heiti TC', sans-serif",
} as const
