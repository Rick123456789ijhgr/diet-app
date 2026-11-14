// 測試用的假後端（MSW）。回應格式依 openapi/workbench.yaml 的型別撰寫。
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { ConfigClass, ConfigSchemas, ImageRef, QualityResult } from '@/api/client'

import { coldstartHandlers } from './coldstart'

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
  defaults: { blur_sigma: 0, rotate_deg: 0, motion_len: 0, motion_angle: 0, seed: 0 },
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
    {
      name: 'rotate_deg',
      type: 'float',
      default: 0,
      label: '旋轉',
      label_en: 'Rotate',
      help: '旋轉角度。',
      calibrate: false,
      group: 'geometry',
      min: -90,
      max: 90,
      step: 1,
    },
    {
      name: 'motion_len',
      type: 'float',
      default: 0,
      label: '手震長度',
      label_en: 'Motion',
      help: '手震模糊的長度。',
      calibrate: false,
      group: 'optics',
      min: 0,
      max: 60,
      step: 1,
    },
    {
      name: 'motion_angle',
      type: 'float',
      default: 0,
      label: '手震方向',
      label_en: 'Motion angle',
      help: '手震的方向。',
      calibrate: false,
      group: 'optics',
      min: 0,
      max: 180,
      step: 5,
    },
    {
      name: 'seed',
      type: 'int',
      default: 0,
      label: '隨機種子',
      label_en: 'Seed',
      help: '雜訊與光斑的亂數種子。',
      calibrate: false,
      group: 'random',
      min: 0,
      max: 10000,
      step: 1,
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

// ── 圖片批次命名的假資料夾 ──
interface NamingBody {
  folder: string
  category?: string
  batch?: string
  start?: number
  width?: number
  no_code?: string
}
let namingApplied = false
/** 測試開始前重設假資料夾（尚未改名）。 */
export function resetNaming() {
  namingApplied = false
}
const NAMING_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
function namingError(b: NamingBody) {
  if (b.folder.includes('nope'))
    return HttpResponse.json(
      { code: 'PATH_NOT_FOUND', message: `找不到資料夾：${b.folder}` },
      { status: 404 },
    )
  for (const field of ['category', 'batch'] as const) {
    if (!NAMING_TOKEN.test(b[field] ?? '')) {
      return HttpResponse.json(
        {
          code: 'INVALID_PARAMS',
          message: `${field === 'category' ? '類別' : '批次'}只能用小寫英文字母、數字與連字號`,
          field,
        },
        { status: 400 },
      )
    }
  }
  return null
}
function namingPlan(b: NamingBody) {
  const seq = (n: number) => String((b.start || 1) + n - 1).padStart(b.width ?? 3, '0')
  const name = (n: number, code: string) => `${b.category}_${b.batch}_${seq(n)}_${code}.jpg`
  const items = namingApplied
    ? [
        {
          src: name(1, '4710088410108'),
          dst: name(1, '4710088410108'),
          status: 'same',
          code: '4710088410108',
          note: '',
        },
        {
          src: name(2, b.no_code ?? 'nocode'),
          dst: name(2, b.no_code ?? 'nocode'),
          status: 'same',
          code: '',
          note: '',
        },
      ]
    : [
        {
          src: '4710088410108.jpg',
          dst: name(1, '4710088410108'),
          status: 'rename',
          code: '4710088410108',
          note: '',
        },
        {
          src: '沒有條碼_IMG_1.jpg',
          dst: name(2, b.no_code ?? 'nocode'),
          status: 'rename',
          code: '',
          note: '',
        },
      ]
  items.push({
    src: 'IMG_5.jpg',
    dst: '',
    status: 'skip',
    code: null as unknown as string,
    note: '檔名看不出條碼',
  })
  const count = (s: string) => items.filter((i) => i.status === s).length
  return {
    folder: b.folder,
    items,
    counts: { rename: count('rename'), same: count('same'), skip: count('skip') },
    stem_lengths: [...new Set(items.filter((i) => i.dst).map((i) => i.dst.length - 4))].sort(),
    can_undo: namingApplied,
    categories: { f: '食物包裝', o: '其他物品（書、用品等）' },
  }
}
function namingResponse(b: NamingBody) {
  return namingError(b) ?? HttpResponse.json(namingPlan(b))
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

// 自適應頁：「每個方法都執行」的結果（dietai.devtools.adaptive.adaptive_run_json 的形狀）
const summary = (arm: string, correct: number, misread: number, extra = {}) => ({
  arm,
  n: 4,
  correct,
  rate: correct / 4,
  ci_low: 0.1,
  ci_high: 0.9,
  misread,
  missed: 4 - correct - misread,
  false_positive: 0,
  ...extra,
})
const adaptivePolicy = (name: string, source: string, threshold: number) => ({
  name,
  description: '測試用策略',
  source,
  start: ['raw'],
  fallback: ['multiscale@2'],
  max_attempts: 3,
  rules: [
    {
      feature: 'contrast',
      op: '<',
      threshold,
      methods: ['clahe', 'pipeline@clahe+binarize'],
      note: '對比低 → CLAHE',
      hits: 2,
      rate: 0.4,
    },
  ],
  overall: [summary('greedy', 3, 0), summary(name, 3, 1, { p_value: 1 })],
  timing: [
    { arm: 'greedy', n: 5, mean_ms: 12.5, total_s: 0.06, mean_attempts: 1.8 },
    { arm: name, n: 5, mean_ms: 15.25, total_s: 0.08, mean_attempts: 2 },
  ],
  plans: [
    { plan: 'raw', count: 3 },
    { plan: 'raw>clahe>pipeline@clahe+binarize', count: 2 },
  ],
  variants: [
    {
      id: 'v-low',
      truth: '4710088410108',
      outcome: 'misread',
      success_rung: 'clahe',
      plan: 'raw>clahe>pipeline@clahe+binarize',
      rules: '0',
      attempts: 2,
      elapsed_ms: 21.5,
      condition: 'contrast',
    },
  ],
  truncated: false,
})
const bin = (i: number, raw: number | null) => ({
  bin: i,
  low: i * 10,
  high: i * 10 + 10,
  n: 1,
  raw,
  clahe: 1,
  'multiscale@2': 0,
  'pipeline@clahe+binarize': 1,
})
export const adaptiveRun = {
  mode: 'methods',
  name: '20261103-methods',
  path: 'D:/runs/20261103-methods',
  meta: { items: 5, include_test: false, git: { commit: 'abcdef1234', dirty: false } },
  features_ready: true,
  feature_names: ['blur', 'contrast'],
  tags: ['condition'],
  command: 'python research/experiments/e1_barcode/adaptive.py D:/runs/20261103-methods',
  arms: [
    {
      arm: 'c0_all_methods',
      methods: ['raw', 'clahe', 'multiscale@2', 'pipeline@clahe+binarize'],
      baseline: { name: 'greedy', order: ['raw', 'multiscale@2'] },
      policies: [
        adaptivePolicy('r0_default', 'config', 90),
        adaptivePolicy('r0_default_tuned', 'run', 52),
        { ...adaptivePolicy('r9_bad', 'config', 1), error: '沒有方法 nope 的結果' },
      ],
      bins: { blur: [bin(0, 0), bin(1, 1)], contrast: [bin(0, 0), bin(1, 0.5)] },
    },
  ],
}

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

/** 找最佳流程的一次執行（dietai.devtools.best_flow.run_json 的形狀）。 */
const bestFlowImage = (
  id: string,
  status: 'auto' | 'review' | 'unknown',
  candidates: { code: string; methods: string[]; checksum_ok: boolean }[],
  applied: { truth: string; source: 'auto' | 'manual' } | null,
) => ({
  id,
  image: `D:/photos/${id}`,
  status,
  truth: status === 'auto' ? candidates[0]!.code : '',
  candidates,
  applied,
  error: '',
  thumb_id: `thumb-${id}`,
})

const bestSummary = (arm: string, correct: number, extra: Record<string, unknown> = {}) => ({
  arm,
  n: 2,
  correct,
  rate: correct / 2,
  ci_low: 0.1,
  ci_high: 0.99,
  misread: 0,
  missed: 2 - correct,
  negatives: 0,
  false_positive: 0,
  errors: 0,
  median_ms: 3.5,
  ...extra,
})

/** truths：圖片 id → 採用的真值（null 為未定）；依此產生真值表與結論。 */
export function bestFlowRun(truths: Record<string, string | null>) {
  const code = '4710088410108'
  const images = [
    bestFlowImage('a.jpg', 'auto', [{ code, methods: ['raw', 'gray'], checksum_ok: true }], {
      truth: code,
      source: 'auto',
    }),
    bestFlowImage(
      'b.jpg',
      'review',
      [
        { code, methods: ['otsu'], checksum_ok: true },
        { code: '4712612300015', methods: ['clahe'], checksum_ok: true },
      ],
      null,
    ),
    bestFlowImage('c.jpg', 'unknown', [], null),
  ].map((img) =>
    img.id in truths
      ? {
          ...img,
          applied: truths[img.id] === null ? null : { truth: truths[img.id]!, source: 'manual' },
        }
      : img,
  )
  const decided = images.filter((i) => i.applied)
  return {
    name: '20261105-bestflow',
    path: 'D:/runs/20261105-bestflow',
    meta: { created: '2026-11-05T00:00:00+08:00', source: 'upload', images: 3, min_methods: 2 },
    counts: {
      images: 3,
      decided: decided.length,
      undecided: 3 - decided.length,
      positives: decided.filter((i) => i.applied!.truth).length,
      negatives: decided.filter((i) => !i.applied!.truth).length,
      auto: 1,
      review: 1,
      unknown: 1,
    },
    images,
    result: {
      methods: [bestSummary('raw', 1), bestSummary('otsu', 2, { gained: 1, lost: 0, p_value: 1 })],
      greedy: {
        order: ['raw', 'otsu', 'pipeline@denoise+binarize'],
        stop: 'exhausted',
        excluded: 0,
        steps: [
          {
            method: 'raw',
            rescued: 1,
            new_misread: 0,
            new_false_positive: 0,
            correct: 1,
            positives: 2,
            misread: 0,
            false_positive: 0,
            rate: 0.5,
            mean_ms: 3,
          },
          {
            method: 'otsu',
            rescued: 1,
            new_misread: 0,
            new_false_positive: 0,
            correct: 2,
            positives: 2,
            misread: 0,
            false_positive: 0,
            rate: 1,
            mean_ms: 5,
          },
        ],
      },
      compare: {
        orders: { raw: ['raw'], greedy: ['raw', 'otsu'], all: ['raw', 'gray', 'otsu'] },
        summary: [
          bestSummary('raw', 1),
          bestSummary('greedy', 2, { lost: 0, gained: 1, p_value: 1 }),
          bestSummary('all', 2, { lost: 0, gained: 1, p_value: 1 }),
        ],
      },
      export: { class: 'LadderConfig', values: { rungs: ['raw', 'otsu'] }, exact: true },
      errors: 0,
    },
  }
}

/** 目前人工確認的真值（PUT 會修改）；測試開始前以 resetBestFlow 清空。 */
let bestFlowTruths: Record<string, string | null> = {}
/** 結果資料夾中是否已有找最佳流程的執行；false 時頁面顯示步驟說明。 */
let bestFlowListed = true
export function resetBestFlow(listed = true) {
  bestFlowTruths = {}
  bestFlowListed = listed
}

export const handlers = [
  ...coldstartHandlers,
  http.post('*/workbench/v1/dev/sweeps', async ({ request }) => {
    const body = (await json(request)) as { target: string; params: Record<string, unknown> }
    const thumbs = [{ level: 0, image_id: 'thumb-0', width: 200, height: 120 }]
    if (body.target === 'label') {
      return HttpResponse.json({
        axis: 'perspective',
        levels: [0, 0.3],
        tol: 0.03,
        rates: [
          {
            level: 0,
            rate: 1,
            off: 0,
            median_error: 0.004,
            warnings: { LABEL_NOT_LOCATED: 0, GLARE_RETAKE: 0 },
          },
          {
            level: 0.3,
            rate: 0.5,
            off: 0.25,
            median_error: 0.05,
            warnings: { LABEL_NOT_LOCATED: 0.25, GLARE_RETAKE: 0 },
          },
        ],
        overall: { correct: 0.75, off: 0.125, missed: 0.125 },
        first_failure: 0.3,
        quality_rates: [
          { level: 0, rate: 0 },
          { level: 0.3, rate: 0.5 },
        ],
        quality_triggers: {
          LOW_RESOLUTION: null,
          TOO_BLURRY: 0.3,
          TOO_DARK: null,
          TOO_BRIGHT: null,
        },
        alarms: { retake: 1, false_alarm: 1, missed_alarm: 1, ok: 5 },
        rows: [
          {
            level: 0.3,
            sample: 0,
            outcome: 'off',
            error: 0.125,
            method: 'hough',
            label_warnings: [],
            quality_passed: true,
            warnings: [],
          },
        ],
        thumbs,
      })
    }
    if (body.target === 'barcode') {
      return HttpResponse.json({
        levels: [0, 45],
        rates: [
          { level: 0, method: 'raw', rate: 1, misread: 0 },
          { level: 45, method: 'raw', rate: 0, misread: 0 },
          { level: 0, method: 'ladder', rate: 1, misread: 0 },
          { level: 45, method: 'ladder', rate: 0.75, misread: 0.25 },
        ],
        // 刻意不依階梯順序：前端要依 RUNG_ORDER 排列堆疊
        rung_counts: [
          { level: 45, rung: 'deskew', count: 2 },
          { level: 0, rung: 'raw', count: 2 },
        ],
        overall: { raw: 0.5, ladder: 0.875 },
        misread: { raw: 0, ladder: 0.125 },
        first_failure: { raw: 45, ladder: 45 },
        quality_rates: [
          { level: 0, rate: 1 },
          { level: 45, rate: 1 },
        ],
        quality_triggers: { LOW_RESOLUTION: null, TOO_BLURRY: null, TOO_DARK: null, TOO_BRIGHT: 0 },
        alarms: { retake: 1, false_alarm: 7, missed_alarm: 0, ok: 0 },
        rows: [
          {
            level: 45,
            sample: 0,
            truth: '4710088410108',
            raw: 'missed',
            ladder: 'misread',
            decoded: '4710088410115',
            success_rung: 'sharpen',
            attempts: 7,
            quality_passed: false,
            warnings: ['TOO_BRIGHT'],
          },
        ],
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
      best_flow_runs: bestFlowListed
        ? [{ name: '20261105-bestflow', path: 'D:/runs/20261105-bestflow' }]
        : [],
      method_runs: [
        { name: '20261103-methods', path: 'D:/runs/20261103-methods', features: true },
        { name: '20261102-raw', path: 'D:/runs/20261102-raw', features: false },
      ],
      arms: ['a0_raw', 'a6_full', 'm1_agree2'],
      default_arms: ['a0_raw', 'a6_full'],
      arm_descriptions: {
        a0_raw: '消融：原圖',
        a6_full: '消融：完整階梯',
        m1_agree2: '誤讀對策：兩次嘗試一致才採用',
      },
    }),
  ),
  http.get('*/workbench/v1/dev/e1/runs/:id', ({ params }) =>
    params.id === '20261103-methods'
      ? HttpResponse.json(adaptiveRun)
      : params.id === '20261102-raw'
        ? HttpResponse.json({
            ...adaptiveRun,
            name: '20261102-raw',
            features_ready: false,
            arms: [],
          })
        : HttpResponse.json(e1Run),
  ),
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
  http.post('*/workbench/v1/dev/best-flow/runs', async ({ request }) => {
    const body = (await json(request)) as { folder?: string }
    if (body.folder?.includes('splits/test')) {
      return HttpResponse.json({ code: 'SPLIT_LOCKED', message: '測試集已鎖定' }, { status: 403 })
    }
    bestFlowListed = true
    return sse([
      { type: 'start', total: 3 },
      { type: 'progress', done: 3, total: 3 },
      { type: 'done', name: '20261105-bestflow', path: 'D:/runs/20261105-bestflow' },
    ])
  }),
  http.get('*/workbench/v1/dev/best-flow/runs/:id', ({ request }) => {
    requests.push({ path: new URL(request.url).pathname, body: new URL(request.url).search })
    return HttpResponse.json(bestFlowRun(bestFlowTruths))
  }),
  http.put('*/workbench/v1/dev/best-flow/runs/:id/truth', async ({ request }) => {
    const body = (await json(request)) as { truths: Record<string, string | null> }
    for (const [id, v] of Object.entries(body.truths)) {
      if (v === null) delete bestFlowTruths[id]
      else bestFlowTruths[id] = v
    }
    return HttpResponse.json(bestFlowRun(bestFlowTruths))
  }),
  // 圖片批次命名：一個假資料夾（兩張條碼檔名、一張看不出條碼），改名後狀態變成「不變」
  http.post('*/workbench/v1/dev/image-naming/preview', async ({ request }) =>
    namingResponse((await json(request)) as unknown as NamingBody),
  ),
  http.post('*/workbench/v1/dev/image-naming/apply', async ({ request }) => {
    const body = (await json(request)) as unknown as NamingBody
    const bad = namingError(body)
    if (bad) return bad
    const renamed = namingApplied ? 0 : 2
    namingApplied = true
    return HttpResponse.json({ renamed, ...namingPlan(body) })
  }),
  http.post('*/workbench/v1/dev/image-naming/undo', async ({ request }) => {
    await json(request)
    const restored = namingApplied ? 2 : 0
    namingApplied = false
    return HttpResponse.json({ restored, problems: [] })
  }),
  http.post('*/workbench/v1/dev/images', ({ request }) => {
    // jsdom 的 File 經 undici 送出時，MSW 讀取 multipart 內容會卡住；只記錄呼叫，依順序編號
    const n = requests.filter((r) => r.path.endsWith('/dev/images')).length + 1
    requests.push({ path: new URL(request.url).pathname, body: n })
    return HttpResponse.json({ ...base, image_id: `upload-${n}` }, { status: 201 })
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
