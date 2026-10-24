import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { ME_KEY } from '@/hooks/useAuth'
import { BASE_KEY } from '@/hooks/useImagePipeline'

/** 重新建立原圖的最短間隔：避免某個請求一直帶錯 image_id 時無限重新上傳 */
export const RECREATE_INTERVAL_MS = 5000

/**
 * Python 重啟後暫存影像會消失（IMAGE_NOT_FOUND）：重新建立原圖，之後的查詢會帶新的 image_id 自動重跑。
 * 冷啟動的請求回 401（登入過期）時讓 me 失效，頁面改顯示登入表單。
 * 4xx 錯誤（參數不合法等）與 DB_UNAVAILABLE（沒有設定資料庫）不重試；連線類錯誤重試一次。
 */
export function createQueryClient(): QueryClient {
  // 上次觸發重新建立原圖的時間；放在閉包內，每個 QueryClient（例如每個測試）各自計時
  let lastRecreate = -Infinity
  // 查詢與 mutation 共用：任何冷啟動請求遇到登入過期都要回到登入表單
  const onUnauthorized = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHORIZED') {
      void client.invalidateQueries({ queryKey: ME_KEY })
    }
  }
  const client: QueryClient = new QueryClient({
    mutationCache: new MutationCache({ onError: onUnauthorized }),
    queryCache: new QueryCache({
      onError: (error) => {
        onUnauthorized(error)
        if (!(error instanceof ApiError && error.code === 'IMAGE_NOT_FOUND')) return
        // 多個查詢可能同時因同一張失效的影像出錯；節流後只重新建立一次
        const now = Date.now()
        if (now - lastRecreate < RECREATE_INTERVAL_MS) return
        lastRecreate = now
        // 以前綴比對：所有原圖查詢（合成、上傳、useLocalImage）都失效；使用中的會立即重抓，
        // 拿到新的 image_id 後，依賴它的退化與分析查詢因查詢鍵改變而自動重跑
        void client.invalidateQueries({ queryKey: [BASE_KEY] })
      },
    }),
    defaultOptions: {
      queries: {
        // 切回視窗時不自動重抓：結果只隨參數改變，重抓只會白白重算
        refetchOnWindowFocus: false,
        // count 為已失敗次數（從 0 起算），count < 1 即最多重試一次；
        // 4xx 是請求本身的問題，重試結果也一樣，不浪費時間
        retry: (count, error) =>
          !(
            error instanceof ApiError &&
            ((error.status >= 400 && error.status < 500) || error.code === 'DB_UNAVAILABLE')
          ) && count < 1,
      },
    },
  })
  return client
}
