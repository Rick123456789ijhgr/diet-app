import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type ConfigClass } from '@/api/client'

/** 參數表單結構（Python 的 param() 宣告）；整個工作階段只取一次。 */
export function useConfigSchemas() {
  return useQuery({
    queryKey: ['config-schemas'],
    queryFn: ({ signal }) => unwrap(api.GET('/workbench/v1/dev/config-schemas', { signal })),
    staleTime: Infinity,
  })
}

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
