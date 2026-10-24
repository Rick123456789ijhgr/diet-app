import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type ConfigClass } from '@/api/client'

/** 參數表單結構（Python 的 param() 宣告）；整個工作階段只取一次。 */
export function useConfigSchemas() {
  return useQuery({
    queryKey: ['config-schemas'],
    queryFn: ({ signal }) => unwrap(api.GET('/workbench/v1/dev/config-schemas', { signal })),
    // 結構只在 Python 程式改動並重啟時才會變，視為永不過期；要看新欄位請重新整理頁面
    staleTime: Infinity,
  })
}

/**
 * 取出單一設定類別（例如 'QualityConfig'）的結構，供 ParamForm 產生表單。
 * 所有呼叫共用 useConfigSchemas 的同一份快取，不會重複請求。
 * 找不到該類別時 schema 為 undefined（與載入中相同），呼叫端以 isLoading 區分。
 */
export function useConfigClass(name: string): {
  schema?: ConfigClass
  error: unknown
  isLoading: boolean
} {
  const q = useConfigSchemas()
  return {
    schema: q.data?.classes.find((c) => c.name === name),
    error: q.error,
    isLoading: q.isLoading,
  }
}
