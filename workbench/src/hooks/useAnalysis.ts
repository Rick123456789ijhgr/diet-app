// 各工具頁共用的分析查詢：參數防抖、取消舊請求、量往返時間、出錯時保留上一次成功的結果。
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { ApiError, type ConfigOverride } from '@/api/client'
import { useDebounced } from '@/hooks/useDebounced'
import { useLastDefined } from '@/hooks/useLastDefined'

/**
 * 一次分析的結果，連同量到的往返時間與「算出它的輸入」一起保存。
 * 結果與 imageId、config 綁在一起，畫面才不會把舊結果疊到新影像或新門檻上（見 workbench/CLAUDE.md）。
 */
export interface Timed<T, C = unknown> {
  data: T
  /** 前端量到的往返時間（含 React → Go → Python），用來對照 ADR 0003 的延遲目標 */
  roundTripMs: number
  /** 這個結果是哪一張影像算出來的（顯示時要配同一張影像） */
  imageId: string
  /** 算出這個結果的參數（顯示門檻時要用它，而不是畫面上最新的參數） */
  config: C
}

/**
 * 工具頁的即時調參查詢。
 *
 * - 參數經 useDebounced（150 ms）後才進查詢鍵，拖動滑桿時不會每一格都送請求。
 * - 查詢鍵改變時 React Query 會以 signal 取消舊請求；run 必須把 signal 傳給 fetch 才有效。
 * - placeholderData: keepPreviousData 讓新結果回來前沿用舊結果（畫面以 stale 淡化）。
 * - 出錯時用 useLastDefined 保留上一次成功的結果，並另外取出 INVALID_CONFIG 供表單標示欄位。
 *
 * 注意：config 必須是穩定的物件參考（例如放在 state 裡），否則 debounced === config 永遠不成立，查詢不會送出。
 */
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
    // React Query 以內容雜湊查詢鍵：同一組影像與參數會直接命中快取，不重送
    queryKey: [name, imageId, debounced, extraKey],
    queryFn: async ({ signal }): Promise<Timed<T, C>> => {
      const start = performance.now()
      // enabled 已保證 imageId 存在，這裡可放心用非空斷言
      const data = await run(imageId!, debounced, signal)
      return { data, roundTripMs: performance.now() - start, imageId: imageId!, config: debounced }
    },
    // 等防抖跟上目前的參數才送出（config 須為穩定的物件），避免帶著舊參數或舊 image_id 先請求一次
    enabled: !!imageId && enabled && debounced === config,
    placeholderData: keepPreviousData,
  })
  const shown = useLastDefined(query.data)
  // 參數不合法另外回傳，讓參數面板能指出是哪個欄位（ApiError.field）；其他錯誤由頁面的狀態卡顯示
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
    /** 畫面上的結果不代表目前的參數（防抖中、計算中或出錯），顯示時淡化 */
    stale: config !== debounced || query.isFetching || !!query.error,
  }
}

/** useAnalysis 的回傳型別，供元件以 props 接收。 */
export type Analysis<T> = ReturnType<typeof useAnalysis<T, unknown>>
