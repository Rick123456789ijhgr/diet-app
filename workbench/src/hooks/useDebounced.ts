import { useEffect, useState } from 'react'

/** 值停止變動 delay 毫秒後才更新（拖動滑桿時不必每一格都送請求）。 */
export function useDebounced<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
