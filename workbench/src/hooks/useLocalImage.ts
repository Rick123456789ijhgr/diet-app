// 載入伺服器本機的一張影像到暫存區（資料夾批次的單檔模式），取得 image_id 供檢視。
// 用於批次結果與 E1 失敗影像；路徑同樣經測試集鎖定。
import { useQuery } from '@tanstack/react-query'

import type { ImageRef } from '@/api/client'
import { BASE_KEY } from '@/hooks/useImagePipeline'
import { postSse } from '@/lib/sse'

interface BatchRow {
  type: string
  image_id?: string
  width?: number
  height?: number
  error?: string | null
}

export function useLocalImage(path: string | undefined) {
  return useQuery({
    // 放在原圖的查詢鍵下：Python 重啟或暫存影像被淘汰時，隨 IMAGE_NOT_FOUND 的處理重新載入
    queryKey: [BASE_KEY, 'local', path],
    queryFn: async ({ signal }): Promise<ImageRef> => {
      let row: BatchRow | undefined
      await postSse<BatchRow>(
        '/workbench/v1/dev/batches',
        { folder: path, limit: 1 },
        (e) => {
          if (e.type === 'row') row = e
        },
        signal,
      )
      if (!row?.image_id) throw new Error(row?.error ?? '無法讀取影像')
      return {
        image_id: row.image_id,
        width: row.width ?? 0,
        height: row.height ?? 0,
        description: path!,
      }
    },
    enabled: !!path,
    staleTime: Infinity,
  })
}
