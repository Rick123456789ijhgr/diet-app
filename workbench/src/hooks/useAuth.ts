// 登入狀態：GET /auth/me 401 視為未登入（null）；登入、登出後讓 me 失效。
// 工作階段放在 HttpOnly Cookie（wb_session），前端碰不到，由瀏覽器自動帶。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type User } from '@/api/client'

export const ME_KEY = ['auth', 'me'] as const
/** 冷啟動相關查詢的共同前綴；登出時清掉 */
export const COLDSTART_KEY = 'coldstart'

async function fetchMe(signal: AbortSignal): Promise<User | null> {
  try {
    return await unwrap(api.GET('/workbench/v1/auth/me', { signal }))
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      unwrap(api.POST('/workbench/v1/auth/login', { body })),
    onSuccess: (user) => {
      client.setQueryData(ME_KEY, user)
      void client.invalidateQueries({ queryKey: ME_KEY })
    },
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { response } = await api.POST('/workbench/v1/auth/logout')
      // 401 表示早已登出，視同成功
      if (!response.ok && response.status !== 401) {
        throw new ApiError(response.status, 'HTTP_ERROR', response.statusText)
      }
    },
    onSuccess: () => {
      client.setQueryData(ME_KEY, null)
      client.removeQueries({ queryKey: [COLDSTART_KEY] })
      void client.invalidateQueries({ queryKey: ME_KEY })
    },
  })
}
