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

function boolField(name: string, label: string, group: string, def = true) {
  return {
    name,
    type: 'bool' as const,
    default: def,
    label,
    label_en: name,
    help: '',
    calibrate: false,
    group,
  }
}

export const ladderSchema: ConfigClass = {
  name: 'LadderConfig',
  doc: '條碼逐步升級的參數。',
  defaults: {
    rungs: ['raw', 'gray', 'binarize'],
    scales: [2, 0.5],
    accept_formats: ['EAN13', 'EAN8', 'UPCA'],
    verify_ean13: true,
  },
  fields: [boolField('verify_ean13', '驗證 EAN-13 檢查碼', 'verify')],
}

export const zxingSchema: ConfigClass = {
  name: 'ZxingConfig',
  doc: '解碼器。',
  defaults: { try_rotate: true },
  fields: [boolField('try_rotate', '嘗試 90° 旋轉', 'zxing')],
}

export const labelSchema: ConfigClass = {
  name: 'LabelConfig',
  doc: '營養標示。',
  defaults: { enable_rectify: true, enable_glare: true, glare_max_ratio: 0.1 },
  fields: [
    boolField('enable_rectify', '定位與透視校正', 'label_steps'),
    boolField('enable_glare', '光斑處理', 'label_steps'),
    {
      name: 'glare_max_ratio',
      type: 'float',
      default: 0.1,
      label: '光斑比例上限',
      label_en: 'Glare max ratio',
      help: '',
      calibrate: true,
      group: 'glare',
      min: 0,
      max: 1,
      step: 0.01,
    },
  ],
}

export const foodSchema: ConfigClass = {
  name: 'FoodConfig',
  doc: '食物照片。',
  defaults: { enable_crop: true, enable_plate: false, vlm_max_side: 1024, vlm_jpeg_quality: 85 },
  fields: [
    boolField('enable_crop', '切出各道菜', 'food_steps'),
    boolField('enable_plate', '盤緣橢圓', 'food_steps', false),
    {
      name: 'vlm_jpeg_quality',
      type: 'int',
      default: 85,
      label: 'VLM JPEG 品質',
      label_en: 'VLM JPEG quality',
      help: '',
      calibrate: false,
      group: 'vlm',
      min: 10,
      max: 100,
      step: 1,
    },
  ],
}

export const schemas: ConfigSchemas = {
  classes: [qualitySchema, degradationSchema, ladderSchema, zxingSchema, labelSchema, foodSchema],
  enums: {
    PreprocessWarning: ['TOO_BLURRY'],
    Rung: ['raw', 'gray', 'binarize', 'sharpen'],
    CodeFormat: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'OTHER'],
  },
}

const base: ImageRef = {
  image_id: 'base',
  width: 1920,
  height: 1080,
  description: '合成標示（種子 0）',
}

const QUAD = [
  { x: 100, y: 100 },
  { x: 500, y: 110 },
  { x: 510, y: 700 },
  { x: 90, y: 690 },
]

/** 合成影像的真值（依場景）：營養標示的四角各偏 (3, 4)，即每角誤差 5 px */
function truthFor(scene: string): Record<string, unknown> | undefined {
  if (scene === 'nutrition') return { quad: QUAD.map((p) => ({ x: p.x + 3, y: p.y + 4 })) }
  if (scene === 'food') {
    return {
      plates: [{ cx: 200, cy: 200, major: 180, minor: 150, angle: 0 }],
      plate_boxes: [{ x: 110, y: 125, w: 180, h: 150 }],
    }
  }
  return undefined
}

const hit = (text: string, raw: string, format = 'EAN13') => ({
  format,
  text,
  raw: btoa(raw),
  corners: QUAD.slice(),
})

const attempt = (rung: string, hits: ReturnType<typeof hit>[] = []) => ({
  rung,
  params: {},
  elapsed_ms: 1.5,
  hits,
  rejected: [],
  skipped: false,
})

const artifact = (id: string, w = 400, h = 300) => ({ artifact_id: id, width: w, height: h })

/** 依請求記錄，讓測試檢查送出的內容 */
export const requests: { path: string; body: unknown }[] = []

/** 模糊下限高於 1000 或影像經過模糊時判定為過於模糊 */
function qualityFor(imageId: string, config: Record<string, number> | undefined): QualityResult {
  const blurry = imageId.endsWith('-deg') || (config?.blur_min ?? 100) > 1000
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
    const body = (await json(request)) as { scene: string }
    const truth = truthFor(body.scene)
    return HttpResponse.json(
      { ...base, image_id: `base-${body.scene}`, ...(truth && { truth }) },
      { status: 201 },
    )
  }),
  http.post('*/workbench/v1/dev/images/:id/degrade', async ({ request, params }) => {
    const body = (await json(request)) as { degradation: Record<string, number> }
    const id = Object.keys(body.degradation).length ? `${String(params.id)}-deg` : String(params.id)
    const truth = truthFor(String(params.id).replace('base-', ''))
    return HttpResponse.json({ ...base, image_id: id, ...(truth && { truth }) }, { status: 201 })
  }),
  http.post('*/workbench/v1/dev/barcode', async ({ request }) => {
    const body = (await json(request)) as { ladder?: { rungs?: string[] } }
    const rungs = body.ladder?.rungs ?? ['raw', 'gray', 'binarize']
    // 只用原圖解不出來；第二階成功
    if (rungs.length === 1) {
      return HttpResponse.json({
        success: false,
        success_index: -1,
        hits: [],
        attempts: [attempt(rungs[0]!)],
        warnings: ['BARCODE_NOT_FOUND'],
        steps: [],
      })
    }
    const h = hit('4710088410108', '4710088410108')
    return HttpResponse.json({
      success: true,
      success_rung: rungs[1],
      success_index: 1,
      hits: [h],
      attempts: [attempt(rungs[0]!), attempt(rungs[1]!, [h])],
      warnings: [],
      steps: [],
    })
  }),
  http.post('*/workbench/v1/dev/invoice-qr', async ({ request }) => {
    await json(request)
    return HttpResponse.json({
      left: hit('AB12', 'AB12', 'QR_CODE'),
      attempts: [attempt('raw')],
      warnings: ['INVOICE_QR_PARTIAL'],
      steps: [],
    })
  }),
  http.post('*/workbench/v1/dev/label', async ({ request }) => {
    const body = (await json(request)) as { config?: Record<string, unknown> }
    const glareOn = body.config?.enable_glare !== false
    return HttpResponse.json({
      image: artifact('label-out', 492, 832),
      quad: QUAD,
      quad_method: 'contour',
      glare_ratio: glareOn ? 0.02 : -1,
      warnings: [],
      steps: [],
    })
  }),
  http.post('*/workbench/v1/dev/food', async ({ request }) => {
    const body = (await json(request)) as { config?: Record<string, unknown> }
    const plates = body.config?.enable_plate === true
    return HttpResponse.json({
      whole: { image: artifact('whole', 960, 720), num_bytes: 51200, scale: 1 },
      dishes_enabled: true,
      dishes: [
        { x: 100, y: 120, w: 200, h: 160 },
        { x: 400, y: 300, w: 180, h: 150 },
      ],
      crops: [
        { image: artifact('crop0', 200, 160), num_bytes: 10240, scale: 1 },
        { image: artifact('crop1', 180, 150), num_bytes: 9216, scale: 1 },
      ],
      plates_enabled: plates,
      plates: plates ? [{ cx: 205, cy: 198, major: 176, minor: 148, angle: 3 }] : [],
      warnings: [],
      steps: [],
    })
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
    const body = (await json(request)) as { view: string; config?: Record<string, unknown> }
    if (body.view === 'ladder_variant') {
      return HttpResponse.json({
        image: { ...base, image_id: `variant-${String(body.config?.index)}` },
        data: { rung: 'gray', params: {}, skipped: false },
      })
    }
    if (body.view === 'glare_mask' && body.config?.enable_glare === false) {
      return HttpResponse.json({ data: { enabled: false } })
    }
    if (body.view === 'histogram') {
      return HttpResponse.json({ data: { counts: Array.from({ length: 256 }, (_, i) => i) } })
    }
    return HttpResponse.json({ image: { ...base, image_id: `view-${body.view}` } })
  }),
]

export const server = setupServer(...handlers)
