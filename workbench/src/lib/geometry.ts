// 與合成影像真值比較用的幾何（評測顯示，不是前處理計算）。
import type { Point } from '@/api/client'

export const CORNER_NAMES = ['左上', '右上', '右下', '左下'] as const

/** 四角各自的誤差（像素），順序為左上、右上、右下、左下；任一方不是四個點時回傳 null。 */
export function quadErrors(found: Point[], truth: Point[] | undefined): number[] | null {
  if (!truth || found.length !== 4 || truth.length !== 4) return null
  return found.map((p, i) => Math.hypot(p.x - truth[i]!.x, p.y - truth[i]!.y))
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}
