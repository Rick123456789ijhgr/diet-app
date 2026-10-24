// 以 SSE 執行長時間的工作（資料夾批次、E1 快速執行）：逐筆收事件、可取消。
// 事件先累積在 ref，每 100 ms 才更新一次畫面，避免幾千張的批次每張都整頁重繪。
import { useCallback, useEffect, useRef, useState } from 'react'

import { postSse } from '@/lib/sse'

/** 串流工作的狀態：尚未執行、執行中、完成、出錯、使用者取消。 */
export type StreamStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

const FLUSH_MS = 100

/**
 * 以 POST + SSE 執行 path 指定的長時間工作。
 * run(body) 開始一次執行（若前一次還在跑會先取消）；cancel() 停止並保留已收到的事件。
 * 元件卸載時自動取消，連線關閉後後端隨之停止。
 * 沒有自動重連：中斷即視為該次執行結束（error 或 cancelled），要重跑請再呼叫 run。
 */
export function useStream<E>(path: string) {
  const [events, setEvents] = useState<E[]>([])
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState<unknown>(null)
  // 目前這次執行的 AbortController；null 代表沒有執行中的工作，或已被使用者取消
  const abort = useRef<AbortController | null>(null)
  // 尚未反映到畫面的事件累積處（完整清單，flush 時整份複製到 state）
  const buffer = useRef<E[]>([])
  // 已排定的 flush；非 null 時不再另排，確保每個 FLUSH_MS 視窗最多更新一次畫面
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 複製一份新陣列給 state，React 才會偵測到變更並重繪
  const flush = useCallback(() => {
    timer.current = null
    setEvents(buffer.current.slice())
  }, [])

  // 先清成 null 再讓 run 的 catch 判斷：abort.current === null 代表「使用者取消」而非「被新執行取代」
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
            // onEvent 每筆即時呼叫（不經節流），供頁面做逐筆的副作用
            onEvent?.(e)
          },
          ctrl.signal,
        )
        // 正常結束：立即把最後一批事件寫上畫面，不等計時器
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
        // 網路或後端錯誤（含串流中途的 event: error）：保留已收到的事件並顯示錯誤
        flush()
        setError(err)
        setStatus('error')
      }
    },
    [path, cancel, flush],
  )

  return { events, status, error, run, cancel }
}
