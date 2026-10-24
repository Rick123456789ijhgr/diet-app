// 數字輸入的解析（搭配 DraftNumberInput 的 parse）。

/**
 * 解析整數輸入並夾在 [lo, hi]；空白或不是數字時回傳 undefined（DraftNumberInput 不提交、可暫時清空）。
 * 打字中的值會先以夾過的值提交，輸入框在失焦時才顯示夾過的值（DraftNumberInput 編輯中不覆蓋草稿）。
 */
export function parseClampedInt(text: string, lo: number, hi: number): number | undefined {
  if (text.trim() === '') return undefined
  const v = Math.round(Number(text))
  if (!Number.isFinite(v)) return undefined
  return Math.min(hi, Math.max(lo, v))
}

/** 進度條寬度（0–100）；total 為 0 或不合法時回傳 floor，避免 done / 0 得到 NaN。 */
export function progressPercent(done: number, total: number, floor = 5): number {
  if (!(total > 0)) return floor
  return Math.min(100, Math.max(0, (done / total) * 100))
}
