// 診斷檢視（RenderView）：影像型回傳 image，資料型回傳 data；只在該檢視開啟時查詢。
import { useQuery } from '@tanstack/react-query'

import { api, overrideBody, unwrap } from '@/api/client'
import type { components } from '@/api/gen/workbench'
import { useDebounced } from '@/hooks/useDebounced'

export type ViewName = components['schemas']['RenderViewRequest']['view']

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
            config: debounced ? overrideBody(debounced) : undefined,
          },
          signal,
        }),
      ),
    // 等防抖跟上目前的設定才送出，避免先用舊設定請求一次（config 須為穩定的物件）
    enabled: !!imageId && enabled && debounced === config,
    // 只在同一種檢視之間沿用舊結果，避免換檢視時閃出別種影像
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === view ? prev : undefined),
  })
}
