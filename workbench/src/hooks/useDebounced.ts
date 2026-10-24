import { useEffect, useState } from 'react'

/** 值停止變動 delay 毫秒後才更新（拖動滑桿時不必每一格都送請求）。 */
export function useDebounced<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    // 每次值改變都重設計時器：只有最後一次變動後靜止滿 delay 才會寫入
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  // 以參考相等比較（Object.is）：物件值須保持穩定參考，否則每次重繪都會重新計時
  return debounced
}
