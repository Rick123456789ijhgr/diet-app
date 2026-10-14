// 各工具頁共用的分析查詢：參數防抖、取消舊請求、量往返時間、出錯時保留上一次成功的結果。
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { ApiError, type ConfigOverride } from '@/api/client'
import { useDebounced } from '@/hooks/useDebounced'
import { useLastDefined } from '@/hooks/useLastDefined'

export interface Timed<T> {
  data: T
  roundTripMs: number
  /** 這個結果是哪一張影像算出來的（顯示時要配同一張影像） */
  imageId: string
}

export function useAnalysis<T, C = ConfigOverride>({
  name,
  imageId,
  config,
  run,
  extraKey,
  enabled = true,
}: {
  /** 查詢鍵的名稱，例如 'quality' */
  name: string
  imageId: string | undefined
  /** 參數（只帶覆寫）；條碼頁為 {ladder, zxing} 這類組合 */
  config: C
  run: (imageId: string, config: C, signal: AbortSignal) => Promise<T>
  /** 其他會影響結果的值（例如條碼頁的 zxing 設定） */
  extraKey?: unknown
  enabled?: boolean
}) {
  const debounced = useDebounced(config)
  const query = useQuery({
    queryKey: [name, imageId, debounced, extraKey],
    queryFn: async ({ signal }): Promise<Timed<T>> => {
      const start = performance.now()
      const data = await run(imageId!, debounced, signal)
      return { data, roundTripMs: performance.now() - start, imageId: imageId! }
    },
    enabled: !!imageId && enabled,
    placeholderData: keepPreviousData,
  })
  const shown = useLastDefined(query.data)
  const configError =
    query.error instanceof ApiError && query.error.code === 'INVALID_CONFIG'
      ? query.error
      : undefined
  return {
    query,
    /** 要顯示的結果：最新成功的一次（出錯或計算中時沿用上一次，畫面淡化） */
    shown,
    configError,
    /** 參數已改、結果還在路上 */
    busy: config !== debounced || query.isFetching,
    stale: config !== debounced || query.isFetching || !!query.error,
  }
}

export type Analysis<T> = ReturnType<typeof useAnalysis<T, unknown>>
