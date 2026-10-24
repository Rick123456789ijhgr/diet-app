// 設定值的覆寫、匯出與匯入。格式與 Python 的 dietai.devtools.configs 相容。
// 覆寫只含與預設值不同的欄位：表單欄位（param() 宣告的數字、布林）與序列欄位（例如 rungs）。
import type { ConfigClass, ConfigField, ConfigOverride, OverrideValue } from '@/api/client'

/** 表單欄位的值（param() 只宣告數字與布林）。 */
export type Value = number | boolean

/** 表單欄位的目前值：有覆寫用覆寫，否則用預設值。 */
export function valueOf(field: ConfigField, overrides: ConfigOverride): Value {
  return (overrides[field.name] as Value | undefined) ?? field.default
}

/** 設定一個表單欄位；等於預設值時移除覆寫（請求只帶與預設值不同的欄位）。 */
export function setOverride(
  overrides: ConfigOverride,
  field: ConfigField,
  value: Value,
): ConfigOverride {
  return setValue(overrides, field.name, value, field.default)
}

/** 序列欄位（例如 rungs）的目前值。 */
export function sequenceOf<T extends string | number>(
  schema: ConfigClass,
  overrides: ConfigOverride,
  name: string,
): T[] {
  // 回傳複本：呼叫端可以直接排序或增刪，不會改到覆寫或 schema.defaults
  return ((overrides[name] ?? schema.defaults[name] ?? []) as T[]).slice()
}

/** 設定一個序列欄位；與預設值相同時移除覆寫。 */
export function setSequence(
  schema: ConfigClass,
  overrides: ConfigOverride,
  name: string,
  value: (string | number)[],
): ConfigOverride {
  return setValue(overrides, name, value, schema.defaults[name])
}

// 不可變更新：一律回傳新物件，React state 與查詢鍵才會偵測到變更
function setValue(
  overrides: ConfigOverride,
  name: string,
  value: OverrideValue,
  fallback: unknown,
): ConfigOverride {
  const next = { ...overrides }
  if (sameValue(value, fallback)) delete next[name]
  else next[name] = value
  return next
}

// 以 JSON 字串比較，陣列（序列欄位）才能依內容判斷相等；順序不同視為不同
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 匯出成 Python config_to_json 的格式：{"class": ..., "values": {...}}，含全部欄位。 */
export function exportJson(schema: ConfigClass, overrides: ConfigOverride): string {
  return JSON.stringify(
    { class: schema.name, values: { ...schema.defaults, ...overrides } },
    null,
    2,
  )
}

// 單一值轉成 Python 字面值；float 欄位的整數補上 .0，貼回 Python 時型別與 dataclass 宣告一致
function pyScalar(value: string | number | boolean, float: boolean): string {
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  // 先跳脫反斜線再跳脫單引號，產生的 Python 字串字面值才合法
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (float && Number.isInteger(value)) return `${value}.0`
  return String(value)
}

function pyValue(schema: ConfigClass, name: string, value: OverrideValue): string {
  const field = schema.fields.find((f) => f.name === name)
  if (Array.isArray(value)) {
    // 序列欄位在 Python 端為 tuple；數字序列（例如 scales）為浮點數
    // 只有一個元素時要寫成 (x,)，否則 Python 會當成加括號的純量
    const items = value.map((v) => pyScalar(v, true))
    return items.length === 1 ? `(${items[0]},)` : `(${items.join(', ')})`
  }
  return pyScalar(value, field?.type === 'float')
}

/** 只列出與預設值不同欄位的 Python 建構式，例如 QualityConfig(blur_min=150.0)；依宣告順序。 */
export function pythonCtor(schema: ConfigClass, overrides: ConfigOverride): string {
  // 依宣告順序：defaults 含全部欄位；保險起見再補上表單欄位
  const names = [...new Set([...Object.keys(schema.defaults), ...schema.fields.map((f) => f.name)])]
  const args = names
    .filter((name) => name in overrides)
    .map((name) => `${name}=${pyValue(schema, name, overrides[name]!)}`)
  return `${schema.name}(${args.join(', ')})`
}

/** 匯入設定失敗；訊息為中文，可直接顯示給使用者。 */
export class ConfigImportError extends Error {}

/**
 * 讀取匯出的 JSON（或只有欄位值的扁平 JSON），回傳覆寫。
 * 未知欄位、型別不符或類別不符時丟 ConfigImportError。序列欄位只檢查是陣列，內容交給後端驗證。
 */
export function importJson(schema: ConfigClass, text: string): ConfigOverride {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ConfigImportError('不是合法的 JSON')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ConfigImportError('設定 JSON 必須是物件')
  }
  let values = data as Record<string, unknown>
  // 有 values 鍵就當成 exportJson 的格式；沒有 class 時不檢查類別
  if ('values' in values) {
    if (values.class !== undefined && values.class !== schema.name) {
      throw new ConfigImportError(
        `設定類別不符：檔案為 ${String(values.class)}，需要 ${schema.name}`,
      )
    }
    const inner = values.values
    // values 為 null、陣列或純量時 Object.entries 會丟 TypeError；改丟中文錯誤
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) {
      throw new ConfigImportError('values 必須是物件')
    }
    values = inner as Record<string, unknown>
  }
  const fields = new Map(schema.fields.map((f) => [f.name, f]))
  let overrides: ConfigOverride = {}
  for (const [name, value] of Object.entries(values)) {
    const field = fields.get(name)
    if (field) {
      // int 欄位拒絕小數；float 欄位接受整數（JSON 的 150 與 150.0 無法區分）
      const ok =
        field.type === 'bool'
          ? typeof value === 'boolean'
          : typeof value === 'number' && (field.type === 'float' || Number.isInteger(value))
      if (!ok) {
        throw new ConfigImportError(`${name} 必須是 ${field.type}，收到 ${JSON.stringify(value)}`)
      }
      // 經 setOverride 寫入：與預設值相同的欄位自動略過，匯入完整匯出檔後只留下真正的修改
      overrides = setOverride(overrides, field, value as Value)
    } else if (Array.isArray(schema.defaults[name])) {
      // 不是表單欄位、但預設值是陣列：視為序列欄位
      if (!Array.isArray(value)) throw new ConfigImportError(`${name} 必須是陣列`)
      overrides = setSequence(schema, overrides, name, value as (string | number)[])
    } else {
      throw new ConfigImportError(`${schema.name} 沒有欄位 ${name}`)
    }
  }
  return overrides
}

/** 依 step 決定顯示的小數位數。 */
export function formatValue(field: ConfigField, value: Value): string {
  if (typeof value === 'boolean') return value ? '開' : '關'
  if (field.type === 'int') return String(value)
  // 例如 step 0.05 → 2 位、0.5 → 1 位、1 → 0 位；最多 4 位
  const step = field.step ?? 0.01
  const decimals = Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))))
  return value.toFixed(decimals)
}

/** 修改的項目數（表單欄位與序列欄位都算）。 */
export function changedCount(overrides: ConfigOverride): number {
  return Object.keys(overrides).length
}
