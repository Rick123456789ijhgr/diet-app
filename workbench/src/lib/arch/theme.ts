// 架構圖畫板的配色與字型（深藍簡報風：深藍底、深藍方塊、金色小標、橘紅強調塊、白色箭頭）。
//
// 這裡刻意寫死色碼、不用 index.css 的主題變數：畫板是「產出物」，匯出的 SVG／PNG 必須自帶顏色，
// 離開工作台（例如貼進簡報）也長得一樣，不隨工作台的深淺色模式改變。
export const SLIDE = {
  bg: '#0b1729',
  /** 右下角的藍色光暈 */
  glow: '#2f6fb5',
  node: '#14243b',
  nodeStroke: '#1e3352',
  kicker: '#e8a33d',
  title: '#f3f5f8',
  accent: '#d9502f',
  accentText: '#ffffff',
  edge: '#ffffff',
  edgeLabelBg: '#0b1729',
  edgeLabel: '#c9d2de',
  header: '#c9d2de',
  rule: 'rgb(255 255 255 / 0.18)',
  badgeBg: '#ffffff',
  badgeText: '#0b1729',
  /** 編輯時的選取框、連線把手（不會匯出） */
  select: '#7fb2ff',
  font: "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', 'Heiti TC', sans-serif",
} as const
