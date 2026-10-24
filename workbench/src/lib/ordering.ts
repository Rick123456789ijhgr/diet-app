// 顯示順序（只影響畫圖與表格的排列，不改數值）。

/** 解碼階梯由簡到繁的固定順序，讓「成功階」堆疊長條的顏色與圖例順序在各頁一致。 */
export const RUNG_ORDER = ['raw', 'gray', 'binarize', 'sharpen', 'denoise', 'deskew', 'multiscale']

/**
 * 依 RUNG_ORDER 排列出現過的階；不在 RUNG_ORDER 的新階不略過，依出現順序接在最後
 * （後端新增階時圖表仍完整，只是順序待補）。
 */
export function orderRungs(present: Iterable<string>): string[] {
  const seen = [...new Set(present)]
  return [
    ...RUNG_ORDER.filter((r) => seen.includes(r)),
    ...seen.filter((r) => !RUNG_ORDER.includes(r)),
  ]
}

/** 可轉成有限數字的字串（空白字串不算，與 Python 的 float() 一致）。 */
function asNumber(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 標籤值的自然排序：數字依數值、排在文字之前（"2" < "10" < "clean"）；
 * 與 Python dietai.evaluation.barcode._natural 相同的規則。回傳新陣列。
 */
export function naturalSort(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const [x, y] = [asNumber(a), asNumber(b)]
    if (x !== undefined && y !== undefined) return x - y
    if (x !== undefined) return -1
    if (y !== undefined) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })
}
