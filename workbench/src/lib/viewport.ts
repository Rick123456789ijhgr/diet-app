// 影像檢視器的縮放與平移（純函式，方便測試）。
//
// 座標換算：螢幕（容器）座標 = 影像座標 × scale + (x, y)；反過來 影像座標 = (螢幕座標 − (x, y)) / scale。
// 疊圖的 SVG 用影像座標，再整體套用同一個轉換，所以縮放平移時框線與影像不會錯位。

/** 檢視狀態：縮放倍率與影像左上角在容器中的位置。 */
export interface View {
  scale: number // 影像像素 → 螢幕像素
  x: number // 影像左上角在容器中的位置
  y: number
}

/** 縮放倍率的下限與上限（避免縮到看不見或放大到浮點誤差明顯）。 */
export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 32

/** 置中並完整放進容器（不放大超過原尺寸）。 */
export function fitView(cw: number, ch: number, iw: number, ih: number): View {
  // 容器尚未量到尺寸（0）或影像還沒載入時，先給 1:1 的預設值，避免除以 0
  if (cw <= 0 || ch <= 0 || iw <= 0 || ih <= 0) return { scale: 1, x: 0, y: 0 }
  const scale = Math.min(cw / iw, ch / ih, 1)
  return { scale, x: (cw - iw * scale) / 2, y: (ch - ih * scale) / 2 }
}

/** 以容器中的點 (px, py) 為中心縮放 factor 倍，該點對應的影像位置不變。 */
export function zoomAt(view: View, px: number, py: number, factor: number): View {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor))
  // 用夾限後的實際倍率 k 調整位移：(px − x) 是游標到影像左上角的螢幕距離，縮放後按比例變為 k 倍
  const k = scale / view.scale
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }
}

/** 容器座標 → 影像像素座標（取整）。 */
export function toImage(view: View, px: number, py: number): { x: number; y: number } {
  // 用 floor 而非 round：像素 (i, j) 涵蓋 [i, i+1) 的範圍；結果可能落在影像外（負值或超過寬高），由呼叫端判斷
  return { x: Math.floor((px - view.x) / view.scale), y: Math.floor((py - view.y) / view.scale) }
}
