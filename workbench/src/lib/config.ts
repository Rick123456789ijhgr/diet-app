// 設定值的覆寫、匯出與匯入。格式與 Python 的 dietai.devtools.configs 相容。
import type { ConfigClass, ConfigField, ConfigOverride } from '@/api/client'

export type Value = number | boolean

/** 目前值：有覆寫用覆寫，否則用預設值。 */
export function valueOf(field: ConfigField, overrides: ConfigOverride): Value {
  return overrides[field.name] ?? field.default
}

/** 設定一個欄位；等於預設值時移除覆寫（請求只帶與預設值不同的欄位）。 */
export function setOverride(
  overrides: ConfigOverride,
  field: ConfigField,
  value: Value,
): ConfigOverride {
  const next = { ...overrides }
  if (value === field.default) delete next[field.name]
  else next[field.name] = value
  return next
}

/** 全部表單欄位的目前值，依宣告順序。 */
export function fullValues(schema: ConfigClass, overrides: ConfigOverride): Record<string, Value> {
  return Object.fromEntries(schema.fields.map((f) => [f.name, valueOf(f, overrides)]))
}

/** 匯出成 Python config_to_json 的格式：{"class": ..., "values": {...}}。 */
export function exportJson(schema: ConfigClass, overrides: ConfigOverride): string {
  const values = { ...schema.defaults, ...fullValues(schema, overrides) }
  return JSON.stringify({ class: schema.name, values }, null, 2)
}

function pyValue(field: ConfigField, value: Value): string {
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (field.type === 'float' && Number.isInteger(value)) return `${value}.0`
  return String(value)
}

/** 只列出與預設值不同欄位的 Python 建構式，例如 QualityConfig(blur_min=150.0)。 */
export function pythonCtor(schema: ConfigClass, overrides: ConfigOverride): string {
  const args = schema.fields
    .filter((f) => f.name in overrides)
    .map((f) => `${f.name}=${pyValue(f, overrides[f.name] as Value)}`)
  return `${schema.name}(${args.join(', ')})`
}

export class ConfigImportError extends Error {}

/**
 * 讀取匯出的 JSON（或只有欄位值的扁平 JSON），回傳覆寫。
 * 未知欄位、型別不符或類別不符時丟 ConfigImportError；序列欄位（例如 rungs）略過。
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
  if ('values' in values) {
    if (values.class !== undefined && values.class !== schema.name) {
      throw new ConfigImportError(
        `設定類別不符：檔案為 ${String(values.class)}，需要 ${schema.name}`,
      )
    }
    values = values.values as Record<string, unknown>
  }
  const fields = new Map(schema.fields.map((f) => [f.name, f]))
  let overrides: ConfigOverride = {}
  for (const [name, value] of Object.entries(values)) {
    const field = fields.get(name)
    if (!field) {
      if (name in schema.defaults) continue
      throw new ConfigImportError(`${schema.name} 沒有欄位 ${name}`)
    }
    const ok =
      field.type === 'bool'
        ? typeof value === 'boolean'
        : typeof value === 'number' && (field.type === 'float' || Number.isInteger(value))
    if (!ok) {
      throw new ConfigImportError(`${name} 必須是 ${field.type}，收到 ${JSON.stringify(value)}`)
    }
    overrides = setOverride(overrides, field, value as Value)
  }
  return overrides
}

/** 依 step 決定顯示的小數位數。 */
export function formatValue(field: ConfigField, value: Value): string {
  if (typeof value === 'boolean') return value ? '開' : '關'
  if (field.type === 'int') return String(value)
  const step = field.step ?? 0.01
  const decimals = Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))))
  return value.toFixed(decimals)
}
