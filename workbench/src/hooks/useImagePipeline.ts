// 影像來源 → 暫存的原圖 → 套用模擬退化後的影像。
// 影像只上傳一次，之後的請求只帶 image_id（ADR 0003）；Python 重啟後由 queryClient 的全域處理重新上傳。
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, overrideBody, unwrap, type ConfigOverride, type ImageRef } from '@/api/client'
import { useDebounced } from '@/hooks/useDebounced'
import { SCENES, type SceneId, type SceneParams } from '@/lib/scenes'

/** 影像來源：後端合成的場景（含場景參數），或使用者上傳的檔案。 */
export type Source =
  { kind: 'synthetic'; scene: SceneId; params: SceneParams } | { kind: 'upload'; file: File }

/** 以場景預設值建立合成來源；複製 defaults，避免表單修改到共用的 SCENES 常數。 */
export function syntheticSource(scene: SceneId): Source {
  return { kind: 'synthetic', scene, params: { ...SCENES[scene].defaults } }
}

/** 原圖的查詢鍵前綴；IMAGE_NOT_FOUND 時重新取得這組查詢。 */
export const BASE_KEY = 'base-image'

// 查詢鍵只放能代表來源內容的值：上傳檔以名稱、大小、修改時間辨識（File 物件本身無法序列化成查詢鍵）
function sourceKey(s: Source): unknown[] {
  return s.kind === 'synthetic'
    ? [BASE_KEY, s.kind, s.scene, s.params]
    : [BASE_KEY, s.kind, s.file.name, s.file.size, s.file.lastModified]
}

// 在後端建立暫存原圖並取得 image_id：合成走 JSON，上傳走 multipart
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
      // body 只為滿足產生的型別；實際送出的內容由 bodySerializer 改成 FormData（瀏覽器自動帶 boundary）
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

/**
 * 工具頁的影像管線：來源 → 原圖（base）→ 套用模擬退化的影像（degraded）。
 * 兩段都以查詢快取，staleTime: Infinity：同一來源與退化參數不會重複上傳或重算。
 * 頁面分析一律用回傳的 image（退化後的影像）。
 *
 * scene 為「合成」來源產生的場景；切換場景（例如條碼↔發票）時呼叫 setSource(syntheticSource(...))。
 */
export function useImagePipeline(scene: SceneId) {
  const [source, setSource] = useState<Source>(() => syntheticSource(scene))
  const [degradation, setDegradation] = useState<ConfigOverride>({})
  // 來源的防抖較長（300 ms）：改合成參數（例如尺寸、種子）要重新產生並上傳整張影像，成本較高
  const debouncedSource = useDebounced(source, 300)
  const debouncedDegradation = useDebounced(degradation)
  // 切到上傳模式但尚未選檔時，ImageSourcePanel 以空的 File 表示；用未防抖的 source，讓畫面立即反應
  const noFile = source.kind === 'upload' && source.file.size === 0

  const base = useQuery({
    queryKey: sourceKey(debouncedSource),
    queryFn: ({ signal }) => createBase(debouncedSource, signal),
    // 上傳模式尚未選檔時不送出
    enabled: debouncedSource.kind === 'synthetic' || debouncedSource.file.size > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  })

  const baseId = base.data?.image_id
  // 退化以原圖的 image_id 為鍵：原圖重新建立（例如 Python 重啟後）時 baseId 改變，退化影像自動重算
  const degraded = useQuery({
    queryKey: ['degrade', baseId, debouncedDegradation],
    queryFn: ({ signal }) =>
      unwrap(
        api.POST('/workbench/v1/dev/images/{image_id}/degrade', {
          params: { path: { image_id: baseId! } },
          // 沒有任何退化時送空物件（不省略欄位），結果即原圖
          body: { degradation: overrideBody(debouncedDegradation) ?? {} },
          signal,
        }),
      ),
    enabled: !!baseId && !noFile,
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
    /** 上傳模式還沒選檔 */
    noFile,
    /** 目前要分析的影像（退化後；沒有退化時就是原圖）；未選檔時為 undefined */
    image: noFile ? undefined : degraded.data,
    /** 參數已改、結果還在路上 */
    pending:
      source !== debouncedSource ||
      degradation !== debouncedDegradation ||
      base.isFetching ||
      degraded.isFetching,
  }
}

/** useImagePipeline 的回傳型別，供影像來源面板等元件以 props 接收。 */
export type ImagePipeline = ReturnType<typeof useImagePipeline>
