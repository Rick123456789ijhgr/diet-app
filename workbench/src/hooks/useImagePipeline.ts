// 影像來源 → 暫存的原圖 → 套用模擬退化後的影像。
// 影像只上傳一次，之後的請求只帶 image_id（ADR 0003）；Python 重啟後由 main.tsx 的全域處理重新上傳。
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, overrideBody, unwrap, type ConfigOverride, type ImageRef } from '@/api/client'
import { useDebounced } from '@/hooks/useDebounced'

export interface SyntheticParams {
  height: number
  width: number
  seed: number
}

export type Source =
  { kind: 'synthetic'; scene: 'label'; params: SyntheticParams } | { kind: 'upload'; file: File }

export const DEFAULT_SYNTHETIC: SyntheticParams = { height: 1080, width: 1920, seed: 0 }

export const DEFAULT_SOURCE: Source = {
  kind: 'synthetic',
  scene: 'label',
  params: DEFAULT_SYNTHETIC,
}

/** 原圖的查詢鍵前綴；IMAGE_NOT_FOUND 時重新取得這組查詢。 */
export const BASE_KEY = 'base-image'

function sourceKey(s: Source): unknown[] {
  return s.kind === 'synthetic'
    ? [BASE_KEY, s.kind, s.scene, s.params]
    : [BASE_KEY, s.kind, s.file.name, s.file.size, s.file.lastModified]
}

async function createBase(s: Source, signal: AbortSignal): Promise<ImageRef> {
  if (s.kind === 'synthetic') {
    return unwrap(
      api.POST('/workbench/v1/dev/images/synthesize', {
        body: { scene: s.scene, params: { ...s.params } },
        signal,
      }),
    )
  }
  return unwrap(
    api.POST('/workbench/v1/dev/images', {
      body: { file: '', name: s.file.name },
      bodySerializer: () => {
        const form = new FormData()
        form.append('file', s.file)
        form.append('name', s.file.name)
        return form
      },
      signal,
    }),
  )
}

export function useImagePipeline() {
  const [source, setSource] = useState<Source>(DEFAULT_SOURCE)
  const [degradation, setDegradation] = useState<ConfigOverride>({})
  const debouncedSource = useDebounced(source, 300)
  const debouncedDegradation = useDebounced(degradation)

  const base = useQuery({
    queryKey: sourceKey(debouncedSource),
    queryFn: ({ signal }) => createBase(debouncedSource, signal),
    // 上傳模式尚未選檔時不送出
    enabled: debouncedSource.kind === 'synthetic' || debouncedSource.file.size > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  })

  const baseId = base.data?.image_id
  const degraded = useQuery({
    queryKey: ['degrade', baseId, debouncedDegradation],
    queryFn: ({ signal }) =>
      unwrap(
        api.POST('/workbench/v1/dev/images/{image_id}/degrade', {
          params: { path: { image_id: baseId! } },
          body: { degradation: overrideBody(debouncedDegradation) ?? {} },
          signal,
        }),
      ),
    enabled: !!baseId,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  })

  return {
    source,
    setSource,
    degradation,
    setDegradation,
    base,
    degraded,
    /** 目前要分析的影像（退化後；沒有退化時就是原圖） */
    image: degraded.data,
    /** 參數已改、結果還在路上 */
    pending:
      source !== debouncedSource ||
      degradation !== debouncedDegradation ||
      base.isFetching ||
      degraded.isFetching,
  }
}
