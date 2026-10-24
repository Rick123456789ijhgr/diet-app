// 依 Python 的 param() 宣告自動產生的參數表單。只回報與預設值不同的欄位（覆寫）。
import { CircleHelp, RotateCcw } from 'lucide-react'
import { useId } from 'react'

import type { ConfigClass, ConfigField, ConfigOverride } from '@/api/client'
import { Badge, Button, DraftNumberInput, Hint, Slider, Switch } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { formatValue, setOverride, valueOf, type Value } from '@/lib/config'
import { groupText } from '@/lib/text'

/**
 * 由設定結構（schema）自動產生的參數表單，不手寫欄位。
 * - schema：後端提供的 ConfigClass（欄位名、型別、預設、範圍、步進、分組、說明）。
 * - overrides：目前的覆寫（只含與預設不同的欄位）；顯示值＝覆寫優先，否則預設（valueOf）。
 * - onChange：回傳新的覆寫物件；改回預設值的欄位由 setOverride 移除，請求只帶差異。
 * - invalidField／invalidMessage：前端不做範圍驗證，由後端驗證後回 INVALID_CONFIG 指出欄位，這裡負責標紅。
 */
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
  // 依 field.group 分組；Map 保留插入順序，所以分組與組內欄位都維持 schema 宣告的順序
  const groups = new Map<string, ConfigField[]>()
  for (const f of schema.fields) groups.set(f.group, [...(groups.get(f.group) ?? []), f])
  // 已修改的項數＝覆寫的鍵數（呼叫端若有本表單以外的欄位，應先濾掉再傳入，例如 BarcodePage 的 scalars()）
  const changed = Object.keys(overrides).length
  // 每個表單實例一個前綴：同頁兩個 ParamForm 有同名欄位時，欄位 id 才不會重複
  const idPrefix = useId()

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
      {/* 每組一個 fieldset＋legend，讓輔助技術知道欄位所屬的分組 */}
      {[...groups].map(([group, fields]) => (
        <fieldset key={group} className="space-y-3">
          <legend className="text-ink mb-1.5 text-xs font-semibold">{groupText(group)}</legend>
          {fields.map((f) => (
            <FieldRow
              key={f.name}
              id={`${idPrefix}-param-${f.name}`}
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

/**
 * 單一欄位列：標籤（含已修改圓點、說明提示、「待校準」徽章）＋單欄還原按鈕＋輸入元件。
 * bool 欄位用開關；數值欄位用數字框，若 schema 同時有 min 與 max 再加一條滑桿。
 */
function FieldRow({
  id,
  field,
  value,
  changed,
  error,
  onChange,
}: {
  /** 輸入元件的 id（由 ParamForm 依實例前綴＋欄位名產生，同頁不重複） */
  id: string
  field: ConfigField
  value: Value
  changed: boolean
  error?: string
  onChange: (v: Value) => void
}) {
  // id 讓 <label htmlFor> 對應到數字框或開關
  const label = (
    <div className="flex min-w-0 items-center gap-1.5">
      {changed && <span className="bg-primary size-1.5 shrink-0 rounded-full" aria-hidden />}
      <label htmlFor={id} className="truncate text-sm">
        {field.label}
      </label>
      {/* 觸發元素用按鈕包住圖示：SVG 本身無法以鍵盤聚焦，按鈕可以（聚焦時顯示提示） */}
      <Hint text={field.help}>
        <button
          type="button"
          aria-label={`${field.label}說明`}
          className="text-muted hover:text-ink focus-visible:ring-primary/40 shrink-0 rounded-full focus-visible:ring-2 focus-visible:outline-none"
        >
          <CircleHelp className="size-3.5" aria-hidden />
        </button>
      </Hint>
      {/* calibrate：此參數的預設值是暫定的，之後要以實驗資料校準 */}
      {field.calibrate && <Badge tone="accent">待校準</Badge>}
    </div>
  )
  // 單欄還原：只在已修改時出現；設回預設值後 setOverride 會移除該覆寫
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
  // 只有上下限都有時才能畫滑桿；數字框本身不限制範圍（可輸入超出滑桿的值，由後端驗證）
  const hasRange = field.min !== undefined && field.max !== undefined
  return (
    <div className={cn('space-y-1.5', error && 'bg-danger-soft -mx-2 rounded-lg px-2 py-1')}>
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
            // 有錯誤時才加 aria-invalid（沒有錯誤時不輸出屬性，而非 aria-invalid="false"）
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
          // 沒有指定步進時：int 為 1、float 為 0.01
          step={field.step ?? (field.type === 'int' ? 1 : 0.01)}
          // 值超出範圍（例如數字框輸入或匯入）時，滑桿把手停在端點，實際值仍以數字框為準
          value={[clamp(num, field.min!, field.max!)]}
          // Radix Slider 以陣列傳值（支援多把手），這裡只有一個把手
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
