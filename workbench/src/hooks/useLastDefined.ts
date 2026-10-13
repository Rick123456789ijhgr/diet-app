import { useRef } from 'react'

/** 回傳最近一次不是 undefined 的值；查詢失敗時仍可顯示上一次成功的結果（淡化）。 */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  const last = useRef(value)
  if (value !== undefined) last.current = value
  return last.current
}
