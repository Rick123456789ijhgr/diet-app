// 以 SSE 執行長時間的工作（資料夾批次、E1 快速執行）：逐筆收事件、可取消。
// 事件先累積在 ref，每 100 ms 才更新一次畫面，避免幾千張的批次每張都整頁重繪。
import { useCallback, useEffect, useRef, useState } from 'react'

import { postSse } from '@/lib/sse'

export type StreamStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

const FLUSH_MS = 100

export function useStream<E>(path: string) {
  const [events, setEvents] = useState<E[]>([])
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState<unknown>(null)
  const abort = useRef<AbortController | null>(null)
  const buffer = useRef<E[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    timer.current = null
    setEvents(buffer.current.slice())
  }, [])

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
  }, [])

  // 離開頁面時取消，後端隨之停止
  useEffect(
    () => () => {
      cancel()
      if (timer.current) clearTimeout(timer.current)
    },
    [cancel],
  )

  const run = useCallback(
    async (body: unknown, onEvent?: (e: E) => void) => {
      cancel()
      const ctrl = new AbortController()
      abort.current = ctrl
      // 只有目前這一次執行能更新狀態；被取代的舊執行結束時不覆蓋新狀態
      const isCurrent = () => abort.current === ctrl
      buffer.current = []
      setEvents([])
      setError(null)
      setStatus('running')
      try {
        await postSse<E>(
          path,
          body,
          (e) => {
            if (!isCurrent()) return
            buffer.current.push(e)
            timer.current ??= setTimeout(flush, FLUSH_MS)
            onEvent?.(e)
          },
          ctrl.signal,
        )
        if (isCurrent()) {
          flush()
          setStatus('done')
        }
      } catch (err) {
        if (ctrl.signal.aborted) {
          // 使用者按「停止」：保留已收到的結果；被新的執行取代時什麼都不做
          if (abort.current === null) {
            flush()
            setStatus('cancelled')
          }
          return
        }
        if (!isCurrent()) return
        flush()
        setError(err)
        setStatus('error')
      }
    },
    [path, cancel, flush],
  )

  return { events, status, error, run, cancel }
}
