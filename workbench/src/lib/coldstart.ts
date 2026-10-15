// 冷啟動上傳的表單與草稿轉換、缺少欄位的對應（純函式）。
// 前端只負責保留與送出人工輸入；不計算、不換算、不檢查營養數值（一致性由後端以 422 回報）。
import type { ContentUnit, Draft, ImageKind, Nutrients } from '@/api/client'
import {
  BASIS_TEXT,
  DRAFT_FIELD_TEXT,
  imageKindText,
  NUTRIENT_UNIT_TEXT,
  nutrientText,
} from '@/lib/text'

export const IMAGE_KINDS: ImageKind[] = ['front', 'barcode', 'label']

export const NUTRIENT_KEYS = [
  'energy_kcal',
  'protein_g',
  'fat_g',
  'saturated_fat_g',
  'trans_fat_g',
  'carbohydrate_g',
  'sugar_g',
  'sodium_mg',
] as const satisfies readonly (keyof Nutrients)[]
export type NutrientKey = (typeof NUTRIENT_KEYS)[number]

export const BASES = ['per_serving', 'per_100'] as const
export type Basis = (typeof BASES)[number]

export type NutrientTexts = Record<NutrientKey, string>

/** 表單值：一律保留使用者輸入的原字串；空字串代表未填。 */
export interface FormValues {
  barcode: string
  name: string
  brand: string
  net_content: string
  content_unit: '' | ContentUnit
  serving_size: string
  servings_per_package: string
  per_serving: NutrientTexts
  per_100: NutrientTexts
}

const TEXT_FIELDS = ['barcode', 'name', 'brand'] as const
const NUMBER_FIELDS = ['net_content', 'serving_size', 'servings_per_package'] as const

function emptyNutrients(): NutrientTexts {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, ''])) as NutrientTexts
}

const show = (v: number | string | undefined) => (v === undefined ? '' : String(v))

/** 後端的草稿 → 表單值。 */
export function draftToForm(draft: Draft): FormValues {
  const nutrients = (n: Nutrients | undefined): NutrientTexts => {
    const out = emptyNutrients()
    for (const k of NUTRIENT_KEYS) out[k] = show(n?.[k])
    return out
  }
  return {
    barcode: draft.barcode ?? '',
    name: draft.name ?? '',
    brand: draft.brand ?? '',
    net_content: show(draft.net_content),
    content_unit: draft.content_unit ?? '',
    serving_size: show(draft.serving_size),
    servings_per_package: show(draft.servings_per_package),
    per_serving: nutrients(draft.nutrition?.per_serving),
    per_100: nutrients(draft.nutrition?.per_100),
  }
}

/** 把輸入字串轉成數字；空白回 undefined，無法辨識回 NaN。 */
export function parseNumber(text: string): number | undefined {
  const t = text.trim()
  if (t === '') return undefined
  // 只接受一般的十進位寫法（例如 12、0.5、.5），不接受 1e3、0x10 等
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return Number.NaN
  return Number(t)
}

/**
 * 表單值 → 要送出的草稿。空白欄位省略（不送 0），無法辨識的數字列在 invalid（以欄位路徑表示），
 * 有 invalid 時不應儲存。
 */
export function formToDraft(form: FormValues): { draft: Draft; invalid: string[] } {
  const draft: Draft = {}
  const invalid: string[] = []
  for (const k of TEXT_FIELDS) {
    const t = form[k].trim()
    if (t !== '') draft[k] = t
  }
  for (const k of NUMBER_FIELDS) {
    const v = parseNumber(form[k])
    if (v === undefined) continue
    if (Number.isNaN(v)) invalid.push(k)
    else draft[k] = v
  }
  if (form.content_unit) draft.content_unit = form.content_unit
  const nutrition: NonNullable<Draft['nutrition']> = {}
  for (const basis of BASES) {
    const n: Nutrients = {}
    for (const k of NUTRIENT_KEYS) {
      const v = parseNumber(form[basis][k])
      if (v === undefined) continue
      if (Number.isNaN(v)) invalid.push(`nutrition.${basis}.${k}`)
      else n[k] = v
    }
    if (Object.keys(n).length > 0) nutrition[basis] = n
  }
  if (Object.keys(nutrition).length > 0) draft.nutrition = nutrition
  return { draft, invalid }
}

/** 去掉空字串、空物件，並依鍵排序，讓兩份草稿可以比較是否相同。 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) {
      const c = canonical((v as Record<string, unknown>)[k])
      if (c === undefined || c === '') continue
      if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue
      out[k] = c
    }
    return out
  }
  return v
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

/** 表單欄位的路徑（與 ConfirmProblem.missing 相同的寫法）是否為空白。 */
export function fieldEmpty(form: FormValues, path: string): boolean {
  const parts = path.split('.')
  if (parts[0] === 'nutrition') {
    const basis = parts[1] as Basis | undefined
    if (basis !== 'per_serving' && basis !== 'per_100') return false
    const keys = parts[2] ? [parts[2] as NutrientKey] : NUTRIENT_KEYS
    return keys.some((k) => (form[basis][k] ?? '').trim() === '')
  }
  const v = (form as unknown as Record<string, unknown>)[path]
  return typeof v === 'string' && v.trim() === ''
}

/**
 * 欄位是否在後端回報的缺少清單中（含上層路徑，例如 missing 為 nutrition.per_100 時其下各項都算）。
 */
export function inMissing(missing: readonly string[], path: string): boolean {
  return missing.some((m) => path === m || path.startsWith(`${m}.`))
}

/** 「每 100」欄位依單位顯示公克或毫升。 */
export function per100Label(unit: '' | ContentUnit | undefined): string {
  if (unit === 'ml') return '每 100 毫升'
  if (unit === 'g') return '每 100 公克'
  return '每 100 公克或毫升'
}

export function basisLabel(basis: string, unit: '' | ContentUnit | undefined): string {
  return basis === 'per_100' ? per100Label(unit) : (BASIS_TEXT[basis] ?? basis)
}

export function nutrientLabel(key: string): string {
  const unit = NUTRIENT_UNIT_TEXT[key]
  return unit ? `${nutrientText(key)}（${unit}）` : nutrientText(key)
}

/** 缺少欄位路徑的中文名稱，例如 nutrition.per_100.sodium_mg → 營養標示（每 100 公克）：鈉。 */
export function fieldLabel(path: string, unit?: '' | ContentUnit): string {
  const parts = path.split('.')
  if (parts[0] === 'images') return parts[1] ? `${imageKindText(parts[1])}照片` : '照片'
  if (parts[0] === 'nutrition') {
    if (!parts[1]) return '營養標示'
    const basis = basisLabel(parts[1], unit)
    return parts[2] ? `營養標示（${basis}）：${nutrientText(parts[2])}` : `營養標示（${basis}）`
  }
  return DRAFT_FIELD_TEXT[path] ?? path
}
