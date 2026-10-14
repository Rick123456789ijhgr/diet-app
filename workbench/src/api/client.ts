// 呼叫 Go 主伺服器（/workbench/v1）。型別由 openapi/workbench.yaml 產生（src/api/gen，不手改）。
import createClient from 'openapi-fetch'

import type { components, paths } from './gen/workbench'

export type Schemas = components['schemas']
export type ImageRef = Schemas['ImageRef']
export type ConfigClass = Schemas['ConfigClass']
export type ConfigField = Schemas['ConfigField']
export type ConfigSchemas = Schemas['ConfigSchemas']
export type QualityResult = Schemas['QualityResult']
export type RenderViewResult = Schemas['RenderViewResult']
export type Step = Schemas['Step']
export type DecodeHit = Schemas['DecodeHit']
export type RungAttempt = Schemas['RungAttempt']
export type BarcodeResult = Schemas['BarcodeResult']
export type InvoiceQrResult = Schemas['InvoiceQrResult']
export type LabelResult = Schemas['LabelResult']
export type FoodResult = Schemas['FoodResult']
export type Point = Schemas['Point']
export type Box = Schemas['Box']
export type Ellipse = Schemas['Ellipse']
/** 設定覆寫的值：表單欄位為數字或布林；序列欄位（例如 LadderConfig.rungs）為陣列 */
export type OverrideValue = number | boolean | string | (string | number)[]
export type ConfigOverride = Record<string, OverrideValue>

// 用絕對網址：瀏覽器與測試環境（jsdom）都能用；開發時由 Vite 代理轉給 Go。
// fetch 在呼叫時才取用，測試中的 MSW 才攔截得到。
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? '',
  fetch: (request) => globalThis.fetch(request),
})

/** 後端回傳的錯誤；code 為英文代碼（見 lib/text.ts 的中文對照），field 為出錯的欄位。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field?: string

  constructor(status: number, code: string, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response }

/** 取出 openapi-fetch 的結果；失敗時丟 ApiError。 */
export async function unwrap<T>(promise: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>
  try {
    result = await promise
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK', err instanceof Error ? err.message : String(err))
  }
  const { data, error, response } = result
  if (response.ok && data !== undefined) return data
  const body = (error ?? {}) as Partial<Schemas['Error']>
  throw new ApiError(
    response.status,
    body.code ?? (response.status >= 500 ? 'API_UNAVAILABLE' : 'HTTP_ERROR'),
    body.message ?? response.statusText,
    body.field,
  )
}

/** 暫存影像或診斷影像的網址（內容不變，瀏覽器可快取）。 */
export function artifactUrl(id: string): string {
  return `/workbench/v1/dev/artifacts/${encodeURIComponent(id)}`
}

/** 沒有覆寫時送 undefined，後端視為全部用預設值。 */
export function overrideBody<T extends Record<string, unknown>>(o: T): T | undefined {
  return Object.keys(o).length > 0 ? o : undefined
}
