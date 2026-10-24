import { useRef } from 'react'

/** 回傳最近一次不是 undefined 的值；查詢失敗時仍可顯示上一次成功的結果（淡化）。 */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  // 用 ref 而不是 state：在繪製期間更新，不會多觸發一次重繪
  const last = useRef(value)
  if (value !== undefined) last.current = value
  return last.current
}
