// 測試用的假後端（MSW）。回應格式依 openapi/workbench.yaml 的型別撰寫。
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { ConfigClass, ConfigSchemas, ImageRef, QualityResult } from '@/api/client'

export const qualitySchema: ConfigClass = {
  name: 'QualityConfig',
  doc: '共通品質檢查的參數。',
  defaults: { blur_min: 100, dark_level: 30 },
  fields: [
    {
      name: 'blur_short_side',
      type: 'int',
      default: 480,
      label: '模糊計算短邊',
      label_en: 'Blur short side',
      help: '縮放到此短邊再計算。',
      calibrate: false,
      group: 'blur',
      min: 64,
      max: 2160,
      step: 16,
    },
    {
      name: 'blur_min',
      type: 'float',
      default: 100,
      label: '模糊下限',
      label_en: 'Blur min',
      help: '低於此值視為過於模糊。',
      calibrate: true,
      group: 'blur',
      min: 0,
      max: 2000,
      step: 5,
    },
    {
      name: 'min_short_side',
      type: 'int',
      default: 480,
      label: '最小短邊',
      label_en: 'Min short side',
      help: '短邊低於此值時警告。',
      calibrate: true,
      group: 'resolution',
      min: 1,
      max: 4320,
      step: 1,
    },
    ...(['dark_level', 'bright_level'] as const).map((name, i) => ({
      name,
      type: 'int' as const,
      default: i === 0 ? 30 : 225,
      label: i === 0 ? '過暗灰階' : '過亮灰階',
      label_en: name,
      help: '',
      calibrate: true,
      group: 'exposure',
      min: 0,
      max: 255,
      step: 1,
    })),
    ...(['dark_ratio_max', 'bright_ratio_max'] as const).map((name, i) => ({
      name,
      type: 'float' as const,
      default: 0.5,
      label: i === 0 ? '過暗比例上限' : '過亮比例上限',
      label_en: name,
      help: '',
      calibrate: true,
      group: 'exposure',
      min: 0,
      max: 1,
      step: 0.01,
    })),
  ],
}

export const degradationSchema: ConfigClass = {
  name: 'Degradation',
  doc: '一組退化參數。',
  defaults: { blur_sigma: 0 },
  fields: [
    {
      name: 'blur_sigma',
      type: 'float',
      default: 0,
      label: '模糊 σ',
      label_en: 'Blur',
      help: '高斯模糊的標準差。',
      calibrate: false,
      group: 'optics',
      min: 0,
      max: 20,
      step: 0.5,
    },
  ],
}

export const schemas: ConfigSchemas = {
  classes: [qualitySchema, degradationSchema],
  enums: { PreprocessWarning: ['TOO_BLURRY'] },
}

const base: ImageRef = {
  image_id: 'base',
  width: 1920,
  height: 1080,
  description: '合成標示（種子 0）',
}

/** 依請求記錄，讓測試檢查送出的內容 */
export const requests: { path: string; body: unknown }[] = []

/** 模糊下限高於 1000 或影像經過模糊時判定為過於模糊 */
function qualityFor(imageId: string, config: Record<string, number> | undefined): QualityResult {
  const blurry = imageId !== 'base' || (config?.blur_min ?? 100) > 1000
  return {
    passed: !blurry,
    blur_score: blurry ? 5 : 900,
    mean_brightness: 183,
    dark_ratio: 0.05,
    bright_ratio: 0,
    resolution_ok: true,
    warnings: blurry ? ['TOO_BLURRY'] : [],
    steps: [{ name: 'blur_score', elapsed_ms: 5.2, params: { blur_min: config?.blur_min ?? 100 } }],
  }
}

const json = async (request: Request) => {
  const body = await request.json()
  requests.push({ path: new URL(request.url).pathname, body })
  return body as Record<string, unknown>
}

export const handlers = [
  http.get('*/workbench/v1/dev/config-schemas', () => HttpResponse.json(schemas)),
  http.post('*/workbench/v1/dev/images/synthesize', async ({ request }) => {
    await json(request)
    return HttpResponse.json(base, { status: 201 })
  }),
  http.post('*/workbench/v1/dev/images/:id/degrade', async ({ request, params }) => {
    const body = (await json(request)) as { degradation: Record<string, number> }
    const id = Object.keys(body.degradation).length ? `${String(params.id)}-deg` : String(params.id)
    return HttpResponse.json({ ...base, image_id: id }, { status: 201 })
  }),
  http.post('*/workbench/v1/dev/quality', async ({ request }) => {
    const body = (await json(request)) as {
      image_id: string
      config?: Record<string, number>
    }
    if (body.config?.blur_min !== undefined && body.config.blur_min < 0) {
      return HttpResponse.json(
        { code: 'INVALID_CONFIG', message: 'blur_min 不得為負', field: 'blur_min' },
        { status: 400 },
      )
    }
    return HttpResponse.json(qualityFor(body.image_id, body.config))
  }),
  http.post('*/workbench/v1/dev/views', async ({ request }) => {
    const body = (await json(request)) as { view: string }
    if (body.view === 'histogram') {
      return HttpResponse.json({ data: { counts: Array.from({ length: 256 }, (_, i) => i) } })
    }
    return HttpResponse.json({ image: { ...base, image_id: `view-${body.view}` } })
  }),
]

export const server = setupServer(...handlers)
