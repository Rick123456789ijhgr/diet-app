// 模擬退化面板的介面設定：加入一種退化時的起始值、常見情境、相依欄位。
// 這些只是方便操作的起點（等同使用者手動拖滑桿），不是前處理的計算結果；欄位結構仍由後端的 Degradation 提供。
import type { ConfigClass, ConfigField, ConfigOverride } from '@/api/client'

/** 不單獨列為一種退化的欄位：隨機種子；手震方向依附於手震長度。 */
export const SEED = 'seed'
/** 依附欄位 → 主欄位：主欄位加入時才顯示，移除主欄位時一併移除。 */
export const DEPENDENT: Record<string, string> = { motion_angle: 'motion_len' }

/** 加入一種退化時的起始值（看得出效果的中等程度）；沒列的欄位取範圍中點。 */
export const START: Record<string, number> = {
  rotate_deg: 10,
  curvature: 0.3,
  scale: 0.5,
  blur_sigma: 2,
  motion_len: 15,
  gain: 0.5,
  contrast: 0.5,
  gradient: 0.5,
  glare: 0.2,
  noise_std: 15,
  salt_pepper: 0.05,
  jpeg_quality: 30,
}

/** 會讓合成影像的真值（四角、盤子位置）失效的退化：改變了幾何。 */
export const GEOMETRY = new Set(['rotate_deg', 'curvature', 'scale'])

/** 常見拍攝情境：一次套用一組退化（取代目前的設定）。 */
export const PRESETS: { name: string; values: ConfigOverride }[] = [
  { name: '昏暗室內', values: { gain: 0.45, noise_std: 12 } },
  { name: '手震', values: { motion_len: 20, motion_angle: 30 } },
  { name: '斜拍反光', values: { rotate_deg: 12, glare: 0.25 } },
  { name: '對焦失敗', values: { blur_sigma: 3 } },
  { name: '截圖再壓縮', values: { scale: 0.4, jpeg_quality: 25 } },
  { name: '包裝曲面', values: { curvature: 0.4, gradient: 0.4 } },
]

/** 可單獨加入的退化欄位（排除種子與依附欄位），依 schema 宣告順序。 */
export function primaryFields(schema: ConfigClass): ConfigField[] {
  return schema.fields.filter((f) => f.name !== SEED && !(f.name in DEPENDENT))
}

/** 加入某種退化時的起始值：START 優先，否則取範圍中點（int 取整）；沒有範圍時用預設值。 */
export function startValue(field: ConfigField): number {
  const preset = START[field.name]
  if (preset !== undefined) return preset
  if (field.min === undefined || field.max === undefined) return field.default as number
  const mid = (field.min + field.max) / 2
  return field.type === 'int' ? Math.round(mid) : mid
}

/**
 * 面板上列出的退化：已覆寫的欄位，加上使用者加入但目前仍等於預設值的欄位（pinned）。
 * 依附欄位與種子不列；依 schema 宣告順序。
 */
export function activeFields(
  schema: ConfigClass,
  overrides: ConfigOverride,
  pinned: ReadonlySet<string>,
): ConfigField[] {
  // 依附欄位被覆寫時，主欄位也要列出來（例如只匯入手震方向）
  const owners = new Set(
    Object.keys(overrides)
      .map((k) => DEPENDENT[k])
      .filter(Boolean),
  )
  return primaryFields(schema).filter(
    (f) => f.name in overrides || pinned.has(f.name) || owners.has(f.name),
  )
}

/** 移除一種退化：連同依附欄位；最後一種移除時也清掉種子（只剩種子沒有意義）。 */
export function removeDegradation(overrides: ConfigOverride, name: string): ConfigOverride {
  const next = { ...overrides }
  delete next[name]
  for (const [dep, owner] of Object.entries(DEPENDENT)) if (owner === name) delete next[dep]
  if (Object.keys(next).every((k) => k === SEED)) delete next[SEED]
  return next
}
