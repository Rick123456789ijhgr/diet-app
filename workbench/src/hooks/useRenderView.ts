// 診斷檢視（RenderView）：影像型回傳 image，資料型回傳 data；只在該檢視開啟時查詢。
import { useQuery } from '@tanstack/react-query'

import { api, overrideBody, unwrap } from '@/api/client'
import type { components } from '@/api/gen/workbench'
import { useDebounced } from '@/hooks/useDebounced'

/** 診斷檢視的名稱（例如邊緣響應、遮罩），取自 OpenAPI 產生的列舉。 */
export type ViewName = components['schemas']['RenderViewRequest']['view']

/**
 * 取得某張暫存影像的診斷檢視。
 * 與 useAnalysis 相同：參數防抖後才進查詢鍵，查詢鍵改變時以 signal 取消舊請求。
 * config 為 null 時不帶參數（後端用預設值）；enabled 由頁面依「檢視是否開啟」決定。
 */
export function useRenderView(
  imageId: string | undefined,
  view: ViewName,
  /** 檢視的參數；ladder_variant 為 {ladder: {...}, index: n} */
  config: Record<string, unknown> | null,
  enabled: boolean,
) {
  const debounced = useDebounced(config)
  return useQuery({
    queryKey: ['view', imageId, view, debounced],
    queryFn: ({ signal }) =>
      unwrap(
        api.POST('/workbench/v1/dev/views', {
          body: {
            image_id: imageId!,
            view,
            // 空物件也轉成 undefined：沒有覆寫時不送 config
            config: debounced ? overrideBody(debounced) : undefined,
          },
          signal,
        }),
      ),
    // 等防抖跟上目前的設定才送出，避免先用舊設定請求一次（config 須為穩定的物件）
    enabled: !!imageId && enabled && debounced === config,
    // 只在同一種檢視之間沿用舊結果，避免換檢視時閃出別種影像
    // （queryKey[2] 即上面查詢鍵中的 view）
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === view ? prev : undefined),
  })
}
