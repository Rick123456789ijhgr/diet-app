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
  // 種子 1 的標示在別處：拿舊結果和它比會得到很大的誤差
  if (scene === 'nutrition-seed1') return { quad: QUAD.map((p) => ({ x: p.x + 300, y: p.y })) }
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

/** 以 SSE 回應一串事件；error 不為空時最後送出 event: error。 */
function sse(events: unknown[], error?: { code: string; message: string }) {
  const body =
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') +
    (error ? `event: error\ndata: ${JSON.stringify(error)}\n\n` : '')
  return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

const batchRow = (
  index: number,
  file: string,
  passed: boolean,
  extra: Record<string, unknown> = {},
) => ({
  type: 'row',
  index,
  file,
  path: `D:/photos/${file}`,
  short_side: 600,
  blur_score: passed ? 900 : 40,
  mean_brightness: 150,
  dark_ratio: 0.01,
  bright_ratio: 0.02,
  resolution_ok: true,
  passed,
  warnings: passed ? [] : ['TOO_BLURRY'],
  error: null,
  ...extra,
})

export const e1Run = {
  name: '20261014-run',
  path: 'D:/runs/20261014-run',
  meta: {
    items: 4,
    include_test: false,
    duration_s: 1.5,
    git: { commit: 'abcdef1234', dirty: false },
  },
  arms: ['a0_raw', 'a6_full'],
  tags: ['condition'],
  overall: {
    a0_raw: [
      {
        arm: 'a0_raw',
        n: 4,
        correct: 2,
        rate: 0.5,
        ci_low: 0.15,
        ci_high: 0.85,
        misread: 1,
        missed: 1,
        false_positive: 0,
        errors: 0,
        median_ms: 2,
        mean_attempts: 1,
        p_value: 1,
      },
      {
        arm: 'a6_full',
        n: 4,
        correct: 4,
        rate: 1,
        ci_low: 0.51,
        ci_high: 1,
        misread: 0,
        missed: 0,
        false_positive: 0,
        errors: 0,
        median_ms: 9,
        mean_attempts: 3,
        p_value: 0.5,
      },
    ],
    a6_full: [],
  },
  by_tag: {
    condition: [
      { arm: 'a0_raw', condition: 'blur', n: 2, correct: 1, rate: 0.5, misread: 1 },
      { arm: 'a6_full', condition: 'blur', n: 2, correct: 2, rate: 1, misread: 0 },
    ],
  },
  rescues: [
    { arm: 'a0_raw', rung: 'raw', count: 2 },
    { arm: 'a6_full', rung: 'gray', count: 4 },
  ],
  failures: [
    {
      id: 'img-1',
      arm: 'a0_raw',
      outcome: 'misread',
      truth: '4710088410108',
      decoded: '4710088410115',
      success_rung: 'raw',
      error: '',
      image: 'D:/e1/img-1.png',
      condition: 'blur',
    },
  ],
  attempts: [{ id: 'img-1', arm: 'a0_raw', rung: 'raw', elapsed_ms: '1.2', hits: '1' }],
}

export const handlers = [
  http.post('*/workbench/v1/dev/sweeps', async ({ request }) => {
    const body = (await json(request)) as { target: string; params: Record<string, unknown> }
    const thumbs = [{ level: 0, image_id: 'thumb-0', width: 200, height: 120 }]
    if (body.target === 'barcode') {
      return HttpResponse.json({
        levels: [0, 45],
        rates: [
          { level: 0, method: 'raw', rate: 1 },
          { level: 45, method: 'raw', rate: 0 },
          { level: 0, method: 'ladder', rate: 1 },
          { level: 45, method: 'ladder', rate: 1 },
        ],
        rung_counts: [
          { level: 0, rung: 'raw', count: 2 },
          { level: 45, rung: 'deskew', count: 2 },
        ],
        overall: { raw: 0.5, ladder: 1 },
        first_failure: { raw: 45, ladder: null },
        rows: [],
        thumbs,
      })
    }
    return HttpResponse.json({
      levels: [0, 4, 8],
      rows: [0, 4, 8].map((level) => ({
        level,
        blur_score: 900 - level * 100,
        mean_brightness: 180,
        dark_ratio: 0,
        bright_ratio: 0,
        resolution_ok: true,
        passed: level < 8,
        warnings: level < 8 ? [] : ['TOO_BLURRY'],
      })),
      triggers: { LOW_RESOLUTION: null, TOO_BLURRY: 8, TOO_DARK: null, TOO_BRIGHT: null },
      thumbs,
    })
  }),
  http.post('*/workbench/v1/dev/batches', async ({ request }) => {
    const body = (await json(request)) as { folder: string }
    if (body.folder.includes('splits/test')) {
      return HttpResponse.json({ code: 'SPLIT_LOCKED', message: '測試集已鎖定' }, { status: 403 })
    }
    if (body.folder.endsWith('.png')) {
      // 單檔模式：載入影像供檢視
      return sse([
        { type: 'start', total: 1 },
        batchRow(0, 'a.png', true, { image_id: 'local-a', width: 640, height: 480 }),
        { type: 'summary', count: 1, ok: 1, failed: 0, pass_rate: 1, warning_counts: {} },
      ])
    }
    return sse([
      { type: 'start', total: 3, folder: body.folder },
      batchRow(0, 'a.png', true),
      batchRow(1, 'b.png', false),
      { type: 'row', index: 2, file: 'c.png', path: 'D:/photos/c.png', error: '無法解碼影像' },
      {
        type: 'summary',
        count: 3,
        ok: 2,
        failed: 1,
        pass_rate: 0.5,
        warning_counts: { LOW_RESOLUTION: 0, TOO_BLURRY: 1, TOO_DARK: 0, TOO_BRIGHT: 0 },
      },
    ])
  }),
  http.get('*/workbench/v1/dev/e1/runs', () =>
    HttpResponse.json({
      root: 'D:/runs',
      runs: [{ name: '20261014-run', path: 'D:/runs/20261014-run' }],
      arms: ['a0_raw', 'a6_full', 'm1_agree2'],
      default_arms: ['a0_raw', 'a6_full'],
    }),
  ),
  http.get('*/workbench/v1/dev/e1/runs/:id', () => HttpResponse.json(e1Run)),
  http.post('*/workbench/v1/dev/e1/runs', async ({ request }) => {
    const body = (await json(request)) as { arms: string[] }
    if (body.arms.includes('m1_agree2')) {
      return sse([{ type: 'start', total: 4 }], { code: 'INTERNAL', message: '模擬失敗' })
    }
    return sse([
      { type: 'start', total: 4 },
      { type: 'progress', done: 2, total: 4 },
      { type: 'progress', done: 4, total: 4 },
      { type: 'done', name: '20261014-run', path: 'D:/runs/20261014-run' },
    ])
  }),
  http.get('*/workbench/v1/dev/config-schemas', () => HttpResponse.json(schemas)),
  http.post('*/workbench/v1/dev/images/synthesize', async ({ request }) => {
    const body = (await json(request)) as { scene: string; params?: { seed?: number } }
    const seed = body.params?.seed ?? 0
    const scene = seed ? `${body.scene}-seed${seed}` : body.scene
    const truth = truthFor(scene)
    return HttpResponse.json(
      { ...base, image_id: `base-${scene}`, ...(truth && { truth }) },
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
    const body = (await json(request)) as { image_id: string; config?: Record<string, unknown> }
    if (body.image_id.includes('seed1')) {
      return HttpResponse.json({ code: 'INTERNAL', message: '模擬失敗' }, { status: 500 })
    }
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
