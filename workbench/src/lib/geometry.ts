// 與合成影像真值比較用的幾何（評測顯示，不是前處理計算）。
import type { Point } from '@/api/client'

/** 四角的中文名稱，順序與後端回傳的四角座標相同。 */
export const CORNER_NAMES = ['左上', '右上', '右下', '左下'] as const

/** 四角各自的誤差（像素），順序為左上、右上、右下、左下；任一方不是四個點時回傳 null。 */
export function quadErrors(found: Point[], truth: Point[] | undefined): number[] | null {
  if (!truth || found.length !== 4 || truth.length !== 4) return null
  // 逐點對應（不找最佳配對）：假設找到的四角與真值都已依同一順序排列
  return found.map((p, i) => Math.hypot(p.x - truth[i]!.x, p.y - truth[i]!.y))
}

/** 算術平均；空陣列會得到 NaN，呼叫端須先確認有值。 */
export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}
