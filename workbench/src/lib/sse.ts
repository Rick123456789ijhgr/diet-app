// 讀取 Server-Sent Events（POST 請求；瀏覽器的 EventSource 只支援 GET）。
// 回應不是 200 時丟 ApiError（例如測試集鎖定 403）；串流中途的 event: error 也轉成 ApiError。
// 不做自動重連（EventSource 會，這裡不會）：長時間工作中斷後要由使用者重新執行。
import { ApiError } from '@/api/client'

/** 一筆 SSE 事件：event 名稱（未指定時為 'message'）與 data 原始文字。 */
export interface SseEvent {
  event: string
  data: string
}

/**
 * 把累積的文字切成完整事件，回傳（事件, 剩下未完成的文字）。
 * 網路分塊可能在事件中間切開，所以最後一段（還沒遇到空行）留到下一次與新資料接起來再解析。
 * 只處理 event: 與 data: 欄位；註解行（: 開頭）、id:、retry: 忽略；沒有 data 的事件丟棄。
 */
export function parseSse(buffer: string): [SseEvent[], string] {
  // 事件之間以空行分隔；先統一換行字元，CRLF 才不會讓 '\n\n' 對不上
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: SseEvent[] = []
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      // 依 SSE 規格只去掉冒號後的一個空白；多行 data 以換行接起來
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length) events.push({ event, data: data.join('\n') })
  }
  return [events, rest]
}

/**
 * 送出 POST 並逐筆回呼 JSON 事件；signal 取消時停止讀取。
 *
 * - 串流正常結束時 resolve；HTTP 錯誤、網路錯誤、串流中途的 event: error 都丟 ApiError。
 * - signal 取消時原樣丟出 AbortError（不包成 ApiError），呼叫端（React Query、useStream）才能分辨是取消而非失敗。
 * - 每筆 data 以 JSON.parse 解析後交給 onEvent；onEvent 丟出的例外會中止讀取並關閉連線。
 */
export async function postSse<T>(
  path: string,
  body: unknown,
  onEvent: (data: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    // 用絕對網址並在呼叫時才取 globalThis.fetch：與 api/client.ts 相同，測試中的 MSW 才攔截得到
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
    // 串流開始前的錯誤是一般 JSON 錯誤回應；讀不到 JSON（例如代理回的 HTML）時退回 HTTP 狀態
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
  // TextDecoderStream 會正確處理被分塊切開的 UTF-8 多位元組字元（中文路徑、訊息）
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      // signal 取消時 read() 會以 AbortError 拒絕，跳出迴圈進入 finally
      const { value, done } = await reader.read()
      // 串流結束時 buffer 中若還有沒以空行結尾的殘段，依 SSE 規格捨棄
      if (done) break
      let events: SseEvent[]
      ;[events, buffer] = parseSse(buffer + value)
      for (const ev of events) {
        if (ev.event === 'error') {
          // 串流已開始，HTTP 狀態固定是 200；錯誤內容與 HTTP 錯誤回應相同（含 field）
          const e = JSON.parse(ev.data) as { code: string; message: string; field?: string }
          throw new ApiError(500, e.code, e.message, e.field)
        }
        onEvent(JSON.parse(ev.data) as T)
      }
    }
  } finally {
    // 任何原因提早結束（錯誤、例外、取消）都關閉連線，後端隨之停止
    await reader.cancel().catch(() => {})
  }
}
