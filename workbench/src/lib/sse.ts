// 讀取 Server-Sent Events（POST 請求；瀏覽器的 EventSource 只支援 GET）。
// 回應不是 200 時丟 ApiError（例如測試集鎖定 403）；串流中途的 event: error 也轉成 ApiError。
import { ApiError } from '@/api/client'

export interface SseEvent {
  event: string
  data: string
}

/** 把累積的文字切成完整事件，回傳（事件, 剩下未完成的文字）。 */
export function parseSse(buffer: string): [SseEvent[], string] {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: SseEvent[] = []
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length) events.push({ event, data: data.join('\n') })
  }
  return [events, rest]
}

/** 送出 POST 並逐筆回呼 JSON 事件；signal 取消時停止讀取。 */
export async function postSse<T>(
  path: string,
  body: unknown,
  onEvent: (data: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await globalThis.fetch(new URL(path, globalThis.location?.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK', err instanceof Error ? err.message : String(err))
  }
  if (!res.ok || !res.body) {
    const e = (await res.json().catch(() => ({}))) as {
      code?: string
      message?: string
      field?: string
    }
    throw new ApiError(
      res.status,
      e.code ?? (res.status >= 500 ? 'API_UNAVAILABLE' : 'HTTP_ERROR'),
      e.message ?? res.statusText,
      e.field,
    )
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    let events: SseEvent[]
    ;[events, buffer] = parseSse(buffer + value)
    for (const ev of events) {
      if (ev.event === 'error') {
        const e = JSON.parse(ev.data) as { code: string; message: string }
        throw new ApiError(500, e.code, e.message)
      }
      onEvent(JSON.parse(ev.data) as T)
    }
  }
}
