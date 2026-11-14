// 找最佳流程的「處理流程方案」：內建方案由後端提供（GET /dev/best-flow/presets），
// 修改與自訂方案只存在這個瀏覽器（localStorage 的 wb.bestflow.presets）。
// 一個方案就是一組實驗組設定（arm：解碼器、zxing 選項、LadderConfig），執行時原樣送給後端驗證。
import type { ConfigClass, ConfigOverride, OverrideValue } from '@/api/client'

/** 實驗組設定（同 research/experiments/e1_barcode/configs/*.json）。 */
export interface ArmConfig {
  name: string
  description: string
  decoder: string
  zxing: Record<string, unknown>
  ladder: Record<string, unknown>
}

/** 一個方案。內建方案的 id 為後端的代碼；自訂方案為 custom_<n>。 */
export interface Preset {
  id: string
  name: string
  description: string
  arm: ArmConfig
}

/** 存在瀏覽器的內容：對內建方案的修改（以 id 為鍵）、自訂方案、上次選的方案。 */
export interface StoredPresets {
  edits: Record<string, Preset>
  custom: Preset[]
  selected?: string
}

/** 畫面上的一個方案：kind 區分內建與自訂；modified 為內建方案被改過（可還原）。 */
export interface PresetEntry {
  preset: Preset
  kind: 'builtin' | 'custom'
  modified: boolean
}

export const STORAGE_KEY = 'wb.bestflow.presets'
export const EMPTY: StoredPresets = { edits: {}, custom: [] }

/**
 * 疊加流程可選的步驟代碼；與 Python 的 preprocess.config.PIPELINE_STEPS 對應，縮放與旋轉帶參數
 * （multiscale:0.5、rotate:90，見 parse_pipeline_step），這裡列出常用的值。後端會再驗證，
 * 不合法時回 400 並指出欄位 arm。
 */
export const PIPELINE_STEPS = [
  'multiscale:0.5',
  'multiscale:0.25',
  'rotate:90',
  'rotate:45',
  'rotate:-45',
  'binarize',
  'otsu',
  'clahe',
  'sharpen',
  'denoise',
  'deskew',
] as const

/** 讀取瀏覽器中的方案；沒有、格式不對或無法存取 localStorage 時回傳空的。 */
export function loadStored(): StoredPresets {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const data = JSON.parse(raw) as Partial<StoredPresets>
    return {
      edits: isObject(data.edits) ? (data.edits as Record<string, Preset>) : {},
      custom: Array.isArray(data.custom) ? data.custom.filter(isPreset) : [],
      ...(typeof data.selected === 'string' ? { selected: data.selected } : {}),
    }
  } catch {
    return EMPTY
  }
}

/** 寫回瀏覽器；無法寫入（私密模式、空間不足）時忽略，畫面上的狀態仍然有效。 */
export function saveStored(stored: StoredPresets): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // 只影響下次開啟時還記不記得，不影響這次的執行
  }
}

/** 內建方案（套用修改）在前、自訂方案在後。後端已不再提供的內建方案的修改不顯示。 */
export function mergePresets(builtins: readonly Preset[], stored: StoredPresets): PresetEntry[] {
  return [
    ...builtins.map((b) => {
      const edit = stored.edits[b.id]
      const modified = edit !== undefined && !samePreset(edit, b)
      return { preset: modified ? edit : b, kind: 'builtin' as const, modified }
    }),
    ...stored.custom.map((preset) => ({ preset, kind: 'custom' as const, modified: false })),
  ]
}

/** 儲存一個方案的修改。內建方案改回與原本相同時移除修改；自訂方案原地取代。 */
export function savePreset(
  stored: StoredPresets,
  builtins: readonly Preset[],
  preset: Preset,
): StoredPresets {
  const builtin = builtins.find((b) => b.id === preset.id)
  if (builtin) {
    const edits = { ...stored.edits }
    if (samePreset(preset, builtin)) delete edits[preset.id]
    else edits[preset.id] = preset
    return { ...stored, edits }
  }
  return { ...stored, custom: stored.custom.map((c) => (c.id === preset.id ? preset : c)) }
}

/** 內建方案還原成後端提供的設定。 */
export function restorePreset(stored: StoredPresets, id: string): StoredPresets {
  const edits = { ...stored.edits }
  delete edits[id]
  return { ...stored, edits }
}

/** 以某個方案為底新增自訂方案（名稱加「（副本）」），回傳新內容與新方案的 id。 */
export function addCustom(
  stored: StoredPresets,
  base: Preset,
  name = `${base.name}（副本）`,
): { stored: StoredPresets; id: string } {
  const used = new Set(stored.custom.map((c) => c.id))
  let n = stored.custom.length + 1
  while (used.has(`custom_${n}`)) n++
  const id = `custom_${n}`
  const preset: Preset = { ...clone(base), id, name, arm: { ...clone(base.arm), name: id } }
  return { stored: { ...stored, custom: [...stored.custom, preset], selected: id }, id }
}

/** 刪除自訂方案；正在選的被刪掉時改選第一個內建方案（由呼叫端處理 undefined）。 */
export function removeCustom(stored: StoredPresets, id: string): StoredPresets {
  const next: StoredPresets = { ...stored, custom: stored.custom.filter((c) => c.id !== id) }
  if (next.selected === id) delete next.selected
  return next
}

/** 送給後端的設定：arm 的名稱一律為方案 id（英數字，會寫進 methods.csv），說明取方案的說明。 */
export function armOf(preset: Preset): ArmConfig {
  return { ...preset.arm, name: preset.id, description: preset.description }
}

/**
 * 方案會執行的方法代碼（同 Python evaluation.arm_methods：多尺度依倍率、疊加流程依步驟展開），
 * 只用來在畫面上列出方法與計數，實際執行的方法以後端為準。
 */
export function methodsOf(ladder: Record<string, unknown>): string[] {
  const rungs = (ladder.rungs as string[] | undefined) ?? []
  const scales = (ladder.scales as number[] | undefined) ?? []
  const angles = (ladder.angles as number[] | undefined) ?? []
  const pipelines = (ladder.pipelines as string[][] | undefined) ?? []
  return rungs.flatMap((r) => {
    if (r === 'multiscale') return scales.map((s) => `multiscale@${s}`)
    if (r === 'rotate') return angles.map((a) => `rotate@${a}`)
    if (r === 'pipeline') return pipelines.map((p) => `pipeline@${p.join('+')}`)
    return [r]
  })
}

/**
 * 前端先擋下明顯不能執行的設定（後端仍會完整驗證）；回傳中文的問題清單，空陣列表示可以執行。
 */
export function presetProblems(preset: Preset): string[] {
  const out: string[] = []
  const ladder = preset.arm.ladder
  const rungs = (ladder.rungs as string[] | undefined) ?? []
  if (!preset.name.trim()) out.push('方案名稱不能空白')
  if (rungs.length === 0) out.push('至少要有一個方法')
  if (rungs.includes('multiscale') && ((ladder.scales as number[] | undefined) ?? []).length === 0)
    out.push('多尺度至少要有一個倍率')
  if (rungs.includes('rotate') && ((ladder.angles as number[] | undefined) ?? []).length === 0)
    out.push('旋轉至少要有一個角度')
  if (rungs.includes('pipeline')) {
    const pipelines = (ladder.pipelines as string[][] | undefined) ?? []
    if (pipelines.length === 0) out.push('疊加流程至少要有一條')
    if (pipelines.some((p) => p.length < 2)) out.push('每條疊加流程至少要有兩個步驟')
    const keys = pipelines.map((p) => p.join('+'))
    if (new Set(keys).size !== keys.length) out.push('疊加流程不能重複')
  }
  return out
}

/** 設定值 → 與結構預設值不同的欄位（給 ParamForm／LadderControls 編輯用的覆寫）。 */
export function overridesOf(schema: ConfigClass, values: Record<string, unknown>): ConfigOverride {
  const out: ConfigOverride = {}
  for (const [k, v] of Object.entries(values)) {
    if (JSON.stringify(v) !== JSON.stringify(schema.defaults[k])) out[k] = v as OverrideValue
  }
  return out
}

/** 覆寫 → 完整的設定值（結構預設值＋覆寫）。 */
export function valuesOf(schema: ConfigClass, overrides: ConfigOverride): Record<string, unknown> {
  return { ...schema.defaults, ...overrides }
}

export function samePreset(a: Preset, b: Preset): boolean {
  return stable(a) === stable(b)
}

// 鍵排序後序列化：鍵順序不同（例如後端與瀏覽器各自產生）不算不同；陣列依順序比較
function stable(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) =>
    isObject(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  )
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPreset(v: unknown): v is Preset {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    isObject(v.arm) &&
    isObject(v.arm.ladder) &&
    isObject(v.arm.zxing)
  )
}
