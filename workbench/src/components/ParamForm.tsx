// 依 Python 的 param() 宣告自動產生的參數表單。只回報與預設值不同的欄位（覆寫）。
import { CircleHelp, RotateCcw } from 'lucide-react'
import type { ConfigClass, ConfigField, ConfigOverride } from '@/api/client'
import { Badge, Button, DraftNumberInput, Hint, Slider, Switch } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { formatValue, setOverride, valueOf, type Value } from '@/lib/config'
import { groupText } from '@/lib/text'

export function ParamForm({
  schema,
  overrides,
  onChange,
  invalidField,
  invalidMessage,
}: {
  schema: ConfigClass
  overrides: ConfigOverride
  onChange: (next: ConfigOverride) => void
  /** 後端回報不合法的欄位（INVALID_CONFIG），標成紅色 */
  invalidField?: string
  invalidMessage?: string
}) {
  const groups = new Map<string, ConfigField[]>()
  for (const f of schema.fields) groups.set(f.group, [...(groups.get(f.group) ?? []), f])
  const changed = Object.keys(overrides).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs">
          {changed > 0 ? `已修改 ${changed} 項` : '全部為預設值'}
        </span>
        <Button size="sm" variant="ghost" disabled={changed === 0} onClick={() => onChange({})}>
          <RotateCcw className="size-3.5" aria-hidden />
          全部還原
        </Button>
      </div>
      {[...groups].map(([group, fields]) => (
        <fieldset key={group} className="space-y-3">
          <legend className="text-ink-2 border-card-border mb-1.5 w-full border-b pb-1 text-[11px] font-semibold tracking-wider">
            {groupText(group)}
          </legend>
          {fields.map((f) => (
            <FieldRow
              key={f.name}
              field={f}
              value={valueOf(f, overrides)}
              changed={f.name in overrides}
              error={f.name === invalidField ? (invalidMessage ?? '不合法') : undefined}
              onChange={(v) => onChange(setOverride(overrides, f, v))}
            />
          ))}
        </fieldset>
      ))}
    </div>
  )
}

function FieldRow({
  field,
  value,
  changed,
  error,
  onChange,
}: {
  field: ConfigField
  value: Value
  changed: boolean
  error?: string
  onChange: (v: Value) => void
}) {
  const id = `param-${field.name}`
  const label = (
    <div className="flex min-w-0 items-center gap-1.5">
      {changed && <span className="bg-primary size-1.5 shrink-0 rounded-full" aria-hidden />}
      <label htmlFor={id} className="truncate text-sm">
        {field.label}
      </label>
      <Hint text={field.help}>
        <CircleHelp className="text-muted size-3.5 shrink-0" aria-label={`${field.label}說明`} />
      </Hint>
      {field.calibrate && <Badge tone="accent">待校準</Badge>}
    </div>
  )
  const reset = changed && (
    <button
      type="button"
      onClick={() => onChange(field.default)}
      className="text-muted hover:text-ink"
      aria-label={`還原${field.label}`}
    >
      <RotateCcw className="size-3.5" />
    </button>
  )

  if (field.type === 'bool') {
    return (
      <div className="flex items-center justify-between gap-2">
        {label}
        <div className="flex items-center gap-2">
          {reset}
          <Switch id={id} checked={value as boolean} onCheckedChange={onChange} />
        </div>
      </div>
    )
  }

  const num = value as number
  const hasRange = field.min !== undefined && field.max !== undefined
  return (
    <div className={cn('space-y-1.5', error && 'bg-danger-soft -mx-2 rounded-[3px] px-2 py-1')}>
      <div className="flex items-center justify-between gap-2">
        {label}
        <div className="flex items-center gap-2">
          {reset}
          <DraftNumberInput
            id={id}
            value={num}
            step={field.step ?? undefined}
            format={(v) => formatValue(field, v)}
            onCommit={(v) => onChange(normalize(field, v))}
            aria-invalid={error ? true : undefined}
            className={cn(error && 'border-danger')}
          />
        </div>
      </div>
      {hasRange && (
        <Slider
          aria-label={field.label}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === 'int' ? 1 : 0.01)}
          value={[clamp(num, field.min!, field.max!)]}
          onValueChange={([v]) => v !== undefined && onChange(normalize(field, v))}
        />
      )}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  )
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

/** int 欄位取整；浮點數消除滑桿步進造成的 0.30000000000000004。 */
function normalize(field: ConfigField, v: number): number {
  if (field.type === 'int') return Math.round(v)
  return Number(v.toPrecision(12))
}
