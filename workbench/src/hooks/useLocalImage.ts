// 載入伺服器本機的一張影像到暫存區（資料夾批次的單檔模式），取得 image_id 供檢視。
// 用於批次結果與 E1 失敗影像；路徑同樣經測試集鎖定。
import { useQuery } from '@tanstack/react-query'

import type { ImageRef } from '@/api/client'
import { BASE_KEY } from '@/hooks/useImagePipeline'
import { postSse } from '@/lib/sse'
import { RECREATE_INTERVAL_MS } from '@/queryClient'

// 批次 SSE 事件中這裡用得到的欄位（只取 type === 'row' 的那一筆）
interface BatchRow {
  type: string
  image_id?: string
  width?: number
  height?: number
  error?: string | null
}

/**
 * 依伺服器本機路徑取得暫存影像（ImageRef）；path 為 undefined 時不查詢。
 * 沒有專用路由，借用資料夾批次（limit: 1）讀一張影像，從 row 事件取出 image_id 與尺寸。
 * 回傳的 reload 給 <img onError> 用：暫存影像失效時重新載入。
 */
export function useLocalImage(path: string | undefined) {
  const query = useQuery({
    // 放在原圖的查詢鍵下：Python 重啟或暫存影像被淘汰時，隨 IMAGE_NOT_FOUND 的處理重新載入
    queryKey: [BASE_KEY, 'local', path],
    queryFn: async ({ signal }): Promise<ImageRef> => {
      let row: BatchRow | undefined
      // 串流結束（或 signal 取消）後 postSse 才返回；取消時丟 AbortError，React Query 會忽略
      await postSse<BatchRow>(
        '/workbench/v1/dev/batches',
        { folder: path, limit: 1 },
        (e) => {
          if (e.type === 'row') row = e
        },
        signal,
      )
      // 沒有 row 事件，或 row 帶著讀檔錯誤時，查詢視為失敗
      if (!row?.image_id) throw new Error(row?.error ?? '無法讀取影像')
      return {
        image_id: row.image_id,
        width: row.width ?? 0,
        height: row.height ?? 0,
        description: path!,
      }
    },
    enabled: !!path,
    // 同一路徑的影像內容視為不變；失效時靠 IMAGE_NOT_FOUND 或 reload 重新取得
    staleTime: Infinity,
  })
  // 影像載入失敗（暫存影像被淘汰、Python 重啟）時重新載入；
  // 間隔不足 RECREATE_INTERVAL_MS 就不重試，避免持續失敗時無限重新上傳
  const reload = () => {
    if (Date.now() - query.dataUpdatedAt >= RECREATE_INTERVAL_MS) void query.refetch()
  }
  return { ...query, reload }
}
