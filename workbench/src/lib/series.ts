// 圖表系列的整理（只影響畫圖，不改數值）。

/** 合併後「其他」系列的鍵；用不會與後端鍵（階名、實驗組名）撞名的字串。 */
export const OTHER_KEY = '__other__'

/**
 * 系列數超過色盤數量時，保留前 limit - 1 個鍵，其餘加總成一個「其他」（OTHER_KEY）。
 * 色盤依序取用、不循環（workbench/CLAUDE.md），所以不能讓第 9 個系列與第 1 個同色；
 * 合併而非丟出錯誤：畫面仍可使用，總數也不變。未超過時原樣回傳。
 */
export function foldSeries<R extends { values: Record<string, number> }>(
  keys: string[],
  rows: R[],
  limit: number,
): { keys: string[]; rows: R[] } {
  if (keys.length <= limit) return { keys, rows }
  const kept = keys.slice(0, limit - 1)
  const folded = keys.slice(limit - 1)
  return {
    keys: [...kept, OTHER_KEY],
    rows: rows.map((r) => {
      const values: Record<string, number> = {}
      for (const k of kept) if (k in r.values) values[k] = r.values[k]!
      values[OTHER_KEY] = folded.reduce((a, k) => a + (r.values[k] ?? 0), 0)
      return { ...r, values }
    }),
  }
}
