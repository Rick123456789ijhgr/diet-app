// 影像檢視器的縮放與平移（純函式，方便測試）。

export interface View {
  scale: number // 影像像素 → 螢幕像素
  x: number // 影像左上角在容器中的位置
  y: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 32

/** 置中並完整放進容器（不放大超過原尺寸）。 */
export function fitView(cw: number, ch: number, iw: number, ih: number): View {
  if (cw <= 0 || ch <= 0 || iw <= 0 || ih <= 0) return { scale: 1, x: 0, y: 0 }
  const scale = Math.min(cw / iw, ch / ih, 1)
  return { scale, x: (cw - iw * scale) / 2, y: (ch - ih * scale) / 2 }
}

/** 以容器中的點 (px, py) 為中心縮放 factor 倍，該點對應的影像位置不變。 */
export function zoomAt(view: View, px: number, py: number, factor: number): View {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor))
  const k = scale / view.scale
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }
}

/** 容器座標 → 影像像素座標（取整）。 */
export function toImage(view: View, px: number, py: number): { x: number; y: number } {
  return { x: Math.floor((px - view.x) / view.scale), y: Math.floor((py - view.y) / view.scale) }
}
