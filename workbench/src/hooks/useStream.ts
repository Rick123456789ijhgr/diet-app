// 以 SSE 執行長時間的工作（資料夾批次、E1 快速執行）：逐筆收事件、可取消。
import { useCallback, useEffect, useRef, useState } from 'react'

import { postSse } from '@/lib/sse'

export type StreamStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export function useStream<E>(path: string) {
  const [events, setEvents] = useState<E[]>([])
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState<unknown>(null)
  const abort = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
  }, [])

  // 離開頁面時取消，後端隨之停止
  useEffect(() => cancel, [cancel])

  const run = useCallback(
    async (body: unknown, onEvent?: (e: E) => void) => {
      cancel()
      const ctrl = new AbortController()
      abort.current = ctrl
      setEvents([])
      setError(null)
      setStatus('running')
      try {
        await postSse<E>(
          path,
          body,
          (e) => {
            setEvents((prev) => [...prev, e])
            onEvent?.(e)
          },
          ctrl.signal,
        )
        if (!ctrl.signal.aborted) setStatus('done')
      } catch (err) {
        if (ctrl.signal.aborted) {
          setStatus('cancelled')
          return
        }
        setError(err)
        setStatus('error')
      }
    },
    [path, cancel],
  )

  return { events, status, error, run, cancel }
}
