// 測試用的冷啟動與登入假後端（記憶體中的狀態）。由 server.ts 併入 handlers；各測試前呼叫 resetColdstart()。
// 只模擬前端需要的行為：登入、草稿、照片（條碼照片預填條碼）、If-Match、確認時的 409／422。
import { http, HttpResponse } from 'msw'

import type {
  Draft,
  ImageKind,
  NutritionIssue,
  Product,
  Submission,
  SubmissionImage,
  User,
} from '@/api/client'

export const TEST_USER: User = { id: 'u1', username: 'rick', display_name: '測試員' }
export const TEST_PASSWORD = 'secret'
export const DECODED_BARCODE = '4710088410108'

interface State {
  loggedIn: boolean
  /** true 時所有冷啟動路由與 me 回 503 DB_UNAVAILABLE */
  dbDown: boolean
  submissions: Map<string, Submission>
  products: Map<string, Product>
  seq: number
  clock: number
}

export const coldstart: State = {
  loggedIn: false,
  dbDown: false,
  submissions: new Map(),
  products: new Map(),
  seq: 0,
  clock: 0,
}

/** 冷啟動路由收到的寫入請求（測試檢查 If-Match 與內容用） */
export const coldstartRequests: {
  method: string
  path: string
  ifMatch: string | null
  body: unknown
}[] = []

/** 每次寫入都前進一秒，updated_at 才會不同 */
function now(): string {
  coldstart.clock += 1000
  return new Date(Date.UTC(2026, 9, 16, 1, 0, 0) + coldstart.clock).toISOString()
}

export function resetColdstart({ loggedIn = false } = {}) {
  coldstart.loggedIn = loggedIn
  coldstart.dbDown = false
  coldstart.submissions.clear()
  coldstart.products.clear()
  // 編號與時間不歸零：上一個測試卸載時送出的請求（例如離開頁面時的儲存）會找不到上傳而被忽略，
  // 不會寫進這個測試的狀態
  coldstartRequests.length = 0
}

export function addSubmission(patch: Partial<Submission> = {}): Submission {
  coldstart.seq += 1
  const t = now()
  const sub: Submission = {
    id: `s${coldstart.seq}`,
    status: 'draft',
    draft: {},
    images: [],
    created_by: TEST_USER,
    created_at: t,
    updated_at: t,
    ...patch,
  }
  coldstart.submissions.set(sub.id, sub)
  return sub
}

export function addProduct(patch: Partial<Product> = {}): Product {
  const p: Product = {
    id: `p${coldstart.products.size + 1}`,
    gtin: `0${DECODED_BARCODE}`,
    barcode: DECODED_BARCODE,
    name: '既有的綠茶',
    brand: '某品牌',
    net_content: 600,
    content_unit: 'ml',
    serving_size: 300,
    servings_per_package: 2,
    nutrition: {
      per_100: {
        energy_kcal: 20,
        sodium_mg: 5,
        confirmed_by: TEST_USER,
        confirmed_at: now(),
      },
    },
    images: [{ kind: 'front', submission_id: 'old', width: 800, height: 600 }],
    created_at: now(),
    ...patch,
  }
  coldstart.products.set(p.barcode, p)
  return p
}

const error = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ code, message: `模擬的 ${code}`, ...extra }, { status })

/** 登入與資料庫檢查；通過時回 undefined */
function guard(): Response | undefined {
  if (coldstart.dbDown) return error(503, 'DB_UNAVAILABLE')
  if (!coldstart.loggedIn) return error(401, 'UNAUTHORIZED')
  return undefined
}

function find(id: unknown) {
  return coldstart.submissions.get(String(id))
}

/** 寫入前的共同檢查：存在、尚未關閉、版本相符 */
function writable(request: Request, id: unknown): Submission | Response {
  const sub = find(id)
  if (!sub) return error(404, 'SUBMISSION_NOT_FOUND')
  if (sub.status !== 'draft') return error(409, 'SUBMISSION_CLOSED')
  const ifMatch = request.headers.get('If-Match')
  if (ifMatch !== null && ifMatch !== sub.updated_at) return error(412, 'PRECONDITION_FAILED')
  return sub
}

/** 記錄寫入請求；找不到上傳的請求（上一個測試留下的）不記錄 */
function log(request: Request, body?: unknown, id?: unknown) {
  if (id !== undefined && !find(id)) return
  coldstartRequests.push({
    method: request.method,
    path: new URL(request.url).pathname,
    ifMatch: request.headers.get('If-Match'),
    body,
  })
}

function update(sub: Submission, patch: Partial<Submission>): Submission {
  const next = { ...sub, ...patch, updated_at: now() }
  coldstart.submissions.set(sub.id, next)
  return next
}

const REQUIRED = ['barcode', 'name', 'content_unit'] as const
const NUTRIENTS = [
  'energy_kcal',
  'protein_g',
  'fat_g',
  'saturated_fat_g',
  'trans_fat_g',
  'carbohydrate_g',
  'sugar_g',
  'sodium_mg',
] as const

/** 假的完整性檢查：基本欄位、每 100 的八項、營養標示照片 */
function missingOf(sub: Submission): string[] {
  const d = sub.draft
  const out: string[] = REQUIRED.filter((k) => d[k] === undefined)
  for (const k of NUTRIENTS) {
    if (d.nutrition?.per_100?.[k] === undefined) out.push(`nutrition.per_100.${k}`)
  }
  if (!sub.images.some((i) => i.kind === 'label')) out.push('images.label')
  return out
}

/** 假的一致性檢查：只檢查糖是否大於碳水（真正的規則在 Go） */
function issuesOf(d: Draft): NutritionIssue[] {
  const out: NutritionIssue[] = []
  for (const basis of ['per_serving', 'per_100'] as const) {
    const n = d.nutrition?.[basis]
    if (
      n?.sugar_g !== undefined &&
      n.carbohydrate_g !== undefined &&
      n.sugar_g > n.carbohydrate_g
    ) {
      out.push({
        code: 'SUGAR_EXCEEDS_CARBOHYDRATE',
        basis,
        nutrient: 'sugar_g',
        expected: n.carbohydrate_g,
        actual: n.sugar_g,
        message: 'sugar_g > carbohydrate_g',
      })
    }
  }
  return out
}

function facts(n: Draft['nutrition'], basis: 'per_serving' | 'per_100') {
  const v = n?.[basis]
  return v ? { ...v, confirmed_by: TEST_USER, confirmed_at: now() } : undefined
}

// 1×1 的 PNG
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
)

export const coldstartHandlers = [
  http.post('*/workbench/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { username: string; password: string }
    if (coldstart.dbDown) return error(503, 'DB_UNAVAILABLE')
    if (body.username !== TEST_USER.username || body.password !== TEST_PASSWORD) {
      return error(401, 'INVALID_CREDENTIALS')
    }
    coldstart.loggedIn = true
    return HttpResponse.json(TEST_USER)
  }),
  http.post('*/workbench/v1/auth/logout', () => {
    if (!coldstart.loggedIn) return error(401, 'UNAUTHORIZED')
    coldstart.loggedIn = false
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('*/workbench/v1/auth/me', () => guard() ?? HttpResponse.json(TEST_USER)),

  http.get('*/workbench/v1/coldstart/submissions', ({ request }) => {
    const denied = guard()
    if (denied) return denied
    const status = new URL(request.url).searchParams.get('status')
    const items = [...coldstart.submissions.values()]
      .filter((s) => !status || s.status === status)
      .reverse()
      .map((s) => ({
        id: s.id,
        status: s.status,
        barcode: s.draft.barcode,
        name: s.draft.name,
        images: s.images.map((i) => i.kind),
        created_by: s.created_by,
        updated_at: s.updated_at,
      }))
    return HttpResponse.json({ items })
  }),
  http.post('*/workbench/v1/coldstart/submissions', async ({ request }) => {
    const denied = guard()
    if (denied) return denied
    log(request)
    return HttpResponse.json(addSubmission(), { status: 201 })
  }),
  http.get('*/workbench/v1/coldstart/submissions/:id', ({ params }) => {
    const denied = guard()
    if (denied) return denied
    const sub = find(params.id)
    return sub ? HttpResponse.json(sub) : error(404, 'SUBMISSION_NOT_FOUND')
  }),
  http.get('*/workbench/v1/coldstart/submissions/:id/images/:kind', () => {
    return new HttpResponse(PNG, { headers: { 'Content-Type': 'image/png' } })
  }),
  http.put('*/workbench/v1/coldstart/submissions/:id/images/:kind', async ({ request, params }) => {
    const denied = guard()
    if (denied) return denied
    // 測試環境（jsdom）的 FormData 無法帶真正的檔案內容，這裡只檢查有沒有 file 欄位
    const form = await request.formData()
    log(request, { file: form.has('file') }, params.id)
    const sub = find(params.id)
    if (!sub) return error(404, 'SUBMISSION_NOT_FOUND')
    if (sub.status !== 'draft') return error(409, 'SUBMISSION_CLOSED')
    if (!form.has('file')) return error(400, 'UNSUPPORTED_IMAGE')
    const kind = params.kind as ImageKind
    const image: SubmissionImage = {
      kind,
      width: 800,
      height: 600,
      content_type: 'image/png',
      uploaded_at: now(),
      preprocess: {
        quality_passed: kind !== 'front',
        warnings: kind === 'front' ? ['TOO_BLURRY'] : [],
        ...(kind === 'barcode' ? { barcodes: [{ format: 'EAN13', text: DECODED_BARCODE }] } : {}),
        ...(kind === 'label'
          ? {
              label_quad: [
                { x: 100, y: 80 },
                { x: 700, y: 80 },
                { x: 700, y: 520 },
                { x: 100, y: 520 },
              ],
            }
          : {}),
      },
    }
    const draft =
      kind === 'barcode' && !sub.draft.barcode
        ? { ...sub.draft, barcode: DECODED_BARCODE }
        : sub.draft
    const images = [...sub.images.filter((i) => i.kind !== kind), image]
    return HttpResponse.json(update(sub, { draft, images }))
  }),
  http.put('*/workbench/v1/coldstart/submissions/:id/draft', async ({ request, params }) => {
    const denied = guard()
    if (denied) return denied
    const body = (await request.json()) as Draft
    log(request, body, params.id)
    const sub = writable(request, params.id)
    if (sub instanceof Response) return sub
    return HttpResponse.json(update(sub, { draft: body }))
  }),
  http.post('*/workbench/v1/coldstart/submissions/:id/confirm', async ({ request, params }) => {
    const denied = guard()
    if (denied) return denied
    const body = (await request.json()) as {
      mode: 'create' | 'add_images' | 'revise_nutrition'
      product_id?: string
      accept_warnings?: boolean
    }
    log(request, body, params.id)
    const sub = writable(request, params.id)
    if (sub instanceof Response) return sub
    const d = sub.draft
    let product: Product
    if (body.mode === 'add_images') {
      const existing = [...coldstart.products.values()].find((p) => p.id === body.product_id)
      if (!existing) return error(404, 'PRODUCT_NOT_FOUND')
      product = {
        ...existing,
        images: [...existing.images, ...sub.images.map((i) => ({ ...i, submission_id: sub.id }))],
      }
    } else {
      const missing = missingOf(sub)
      if (missing.length > 0)
        return HttpResponse.json(
          { code: 'DRAFT_INCOMPLETE', message: '欄位不完整', missing },
          { status: 422 },
        )
      const issues = issuesOf(d)
      if (issues.length > 0 && !body.accept_warnings) {
        return HttpResponse.json(
          { code: 'NUTRITION_INCONSISTENT', message: '數值不一致', issues },
          { status: 422 },
        )
      }
      const existing = coldstart.products.get(d.barcode!)
      if (body.mode === 'create' && existing) {
        return error(409, 'BARCODE_EXISTS', { product: existing })
      }
      product = {
        id: existing?.id ?? `p${coldstart.products.size + 1}`,
        gtin: d.barcode!.padStart(14, '0'),
        barcode: d.barcode!,
        name: d.name!,
        brand: d.brand,
        net_content: d.net_content,
        content_unit: d.content_unit!,
        serving_size: d.serving_size,
        servings_per_package: d.servings_per_package,
        nutrition: {
          per_serving: facts(d.nutrition, 'per_serving'),
          per_100: facts(d.nutrition, 'per_100'),
        },
        images: sub.images.map((i) => ({
          kind: i.kind,
          submission_id: sub.id,
          width: i.width,
          height: i.height,
        })),
        created_at: existing?.created_at ?? now(),
      }
    }
    coldstart.products.set(product.barcode, product)
    const next = update(sub, {
      status: 'confirmed',
      product_id: product.id,
      confirmed_by: TEST_USER,
      confirmed_at: now(),
    })
    return HttpResponse.json({ submission: next, product })
  }),
  http.post('*/workbench/v1/coldstart/submissions/:id/reject', async ({ request, params }) => {
    const denied = guard()
    if (denied) return denied
    const body = (await request.json()) as { reason: string }
    log(request, body, params.id)
    const sub = writable(request, params.id)
    if (sub instanceof Response) return sub
    return HttpResponse.json(update(sub, { status: 'rejected', reject_reason: body.reason }))
  }),
  http.get('*/workbench/v1/coldstart/products/:barcode', ({ params }) => {
    const denied = guard()
    if (denied) return denied
    const barcode = String(params.barcode)
    if (!/^\d{8,14}$/.test(barcode)) return error(400, 'INVALID_BARCODE')
    const p = coldstart.products.get(barcode)
    return p ? HttpResponse.json(p) : error(404, 'PRODUCT_NOT_FOUND')
  }),
]
