// 模擬退化面板：只列出已加入的退化，其餘收成「加入」按鈕；另可一次套用常見情境。
import { CircleHelp, Plus, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'

import type { ConfigClass, ConfigField, ConfigOverride } from '@/api/client'
import { Button, DraftNumberInput, Hint, Slider } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { formatValue, setOverride, valueOf } from '@/lib/config'
import {
  activeFields,
  DEPENDENT,
  GEOMETRY,
  PRESETS,
  primaryFields,
  removeDegradation,
  SEED,
  startValue,
} from '@/lib/degradations'

/**
 * 模擬退化（`Degradation`）的精簡面板。
 * - 已加入的退化各佔一列（數字框＋滑桿＋移除）；依附欄位（手震方向）跟在主欄位下方。
 * - 未加入的退化列成「＋名稱」按鈕，點了以 `startValue` 加入。
 * - 加入後拖回預設值仍保留在列表（pinned），按 × 才移除；請求仍只帶與預設不同的欄位。
 * - invalidField／invalidMessage：後端回 INVALID_CONFIG 時標紅該欄。
 */
export function DegradationPicker({
  schema,
  overrides,
  onChange,
  invalidField,
  invalidMessage,
}: {
  schema: ConfigClass
  overrides: ConfigOverride
  onChange: (next: ConfigOverride) => void
  invalidField?: string
  invalidMessage?: string
}) {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set())
  const active = activeFields(schema, overrides, pinned)
  const activeNames = new Set(active.map((f) => f.name))
  const available = primaryFields(schema).filter((f) => !activeNames.has(f.name))
  const byName = new Map(schema.fields.map((f) => [f.name, f]))
  const seed = byName.get(SEED)
  const geometryChanged = active.some((f) => GEOMETRY.has(f.name))

  const set = (field: ConfigField, v: number) => onChange(setOverride(overrides, field, v))
  const add = (field: ConfigField) => {
    setPinned(new Set(pinned).add(field.name))
    set(field, startValue(field))
  }
  const remove = (name: string) => {
    const next = new Set(pinned)
    next.delete(name)
    setPinned(next)
    onChange(removeDegradation(overrides, name))
  }
  const clear = () => {
    setPinned(new Set())
    onChange({})
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">模擬退化</h3>
        <Hint text="依序套用：旋轉 → 曲面 → 縮小 → 模糊 → 亮度、對比 → 梯度 → 光斑 → 雜訊 → JPEG。">
          <button
            type="button"
            aria-label="模擬退化說明"
            className="text-muted hover:text-ink rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <CircleHelp className="size-3.5" aria-hidden />
          </button>
        </Hint>
        <span className="flex-1" />
        <select
          aria-label="常見情境"
          value=""
          onChange={(e) => {
            const preset = PRESETS.find((p) => p.name === e.target.value)
            if (!preset) return
            setPinned(new Set())
            onChange({ ...preset.values })
          }}
          className="border-card-border bg-sunken text-ink-2 h-7 rounded-full border px-2 text-xs"
        >
          <option value="">常見情境…</option>
          {PRESETS.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
        {active.length > 0 && (
          <Button size="sm" variant="ghost" onClick={clear}>
            清除
          </Button>
        )}
      </div>

      {active.length === 0 ? (
        <p className="text-muted text-xs">目前是原圖。從下方加入退化，或選一個常見情境。</p>
      ) : (
        <ul className="space-y-2" aria-label="已加入的退化">
          {active.map((f) => {
            const dependents = Object.entries(DEPENDENT)
              .filter(([, owner]) => owner === f.name)
              .map(([dep]) => byName.get(dep))
              .filter((d): d is ConfigField => !!d)
            return (
              <li key={f.name} className="bg-sunken space-y-2 rounded-xl px-3 py-2">
                <FieldControl
                  field={f}
                  value={valueOf(f, overrides) as number}
                  onChange={(v) => set(f, v)}
                  onRemove={() => remove(f.name)}
                  error={f.name === invalidField ? (invalidMessage ?? '不合法') : undefined}
                />
                {dependents.map((d) => (
                  <FieldControl
                    key={d.name}
                    field={d}
                    value={valueOf(d, overrides) as number}
                    onChange={(v) => set(d, v)}
                    error={d.name === invalidField ? (invalidMessage ?? '不合法') : undefined}
                  />
                ))}
              </li>
            )
          })}
        </ul>
      )}

      {geometryChanged && (
        <p className="text-warn flex gap-1.5 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          旋轉、曲面、縮小會改變幾何，合成影像的真值（四角、盤子位置）不再適用。
        </p>
      )}

      {available.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="加入退化">
          {available.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => add(f)}
              aria-label={`加入${f.label}`}
              className="border-card-border text-ink-2 hover:bg-hover hover:text-ink inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Plus className="size-3" aria-hidden />
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* 種子只影響隨機的退化（雜訊、光斑）；有退化時才顯示 */}
      {seed && active.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">{seed.label}</span>
          <DraftNumberInput
            aria-label={seed.label}
            value={valueOf(seed, overrides) as number}
            parse={(t) => Math.round(Number(t))}
            onCommit={(v) => set(seed, v)}
          />
        </div>
      )}
    </div>
  )
}

/** 一個退化欄位：名稱、數字框、（主欄位才有的）移除鈕，下方滑桿。 */
function FieldControl({
  field,
  value,
  onChange,
  onRemove,
  error,
}: {
  field: ConfigField
  value: number
  onChange: (v: number) => void
  onRemove?: () => void
  error?: string
}) {
  const hasRange = field.min !== undefined && field.max !== undefined
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Hint text={field.help}>
          <span
            className={cn('min-w-0 flex-1 truncate text-sm', !onRemove && 'text-ink-2 text-xs')}
          >
            {field.label}
          </span>
        </Hint>
        <DraftNumberInput
          aria-label={field.label}
          value={value}
          step={field.step}
          format={(v) => formatValue(field, v)}
          onCommit={(v) =>
            onChange(field.type === 'int' ? Math.round(v) : Number(v.toPrecision(12)))
          }
          aria-invalid={error ? true : undefined}
          className="bg-card"
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`移除${field.label}`}
            className="text-muted hover:text-ink rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {hasRange && (
        <Slider
          aria-label={field.label}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === 'int' ? 1 : 0.01)}
          value={[Math.min(field.max!, Math.max(field.min!, value))]}
          onValueChange={([v]) =>
            v !== undefined &&
            onChange(field.type === 'int' ? Math.round(v) : Number(v.toPrecision(12)))
          }
        />
      )}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  )
}
