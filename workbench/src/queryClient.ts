import { QueryCache, QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { BASE_KEY } from '@/hooks/useImagePipeline'

/**
 * Python 重啟後暫存影像會消失（IMAGE_NOT_FOUND）：重新建立原圖，之後的查詢會帶新的 image_id 自動重跑。
 * 4xx 錯誤（參數不合法等）不重試；連線類錯誤重試一次。
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'IMAGE_NOT_FOUND') {
          void client.invalidateQueries({ queryKey: [BASE_KEY] })
        }
      },
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      },
    },
  })
  return client
}
