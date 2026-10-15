// 條碼逐步升級的序列參數：嘗試順序、多尺度倍率、採用格式（LadderConfig 中不以 param() 宣告的欄位）。
import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from 'lucide-react'

import type { ConfigClass, ConfigOverride } from '@/api/client'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { sequenceOf, setSequence } from '@/lib/config'
import { rungText } from '@/lib/text'

const SCALE_OPTIONS = [0.25, 0.5, 0.75, 1.5, 2, 3, 4]

export function LadderControls({
  schema,
  overrides,
  onChange,
  rungs: allRungs,
  formats: allFormats,
  showFormats,
}: {
  schema: ConfigClass
  overrides: ConfigOverride
  onChange: (o: ConfigOverride) => void
  /** 可用的階（enums.Rung） */
  rungs: string[]
  /** 可用的格式（enums.CodeFormat，不含 OTHER） */
  formats: string[]
  /** 電子發票模式不受格式限制，不顯示 */
  showFormats: boolean
}) {
  const rungs = sequenceOf<string>(schema, overrides, 'rungs')
  const scales = sequenceOf<number>(schema, overrides, 'scales')
  const formats = sequenceOf<string>(schema, overrides, 'accept_formats')
  const set = (name: string, value: (string | number)[]) =>
    onChange(setSequence(schema, overrides, name, value))

  const move = (i: number, d: -1 | 1) => {
    const next = rungs.slice()
    ;[next[i], next[i + d]] = [next[i + d]!, next[i]!]
    set('rungs', next)
  }
  const unused = allRungs.filter((r) => !rungs.includes(r))
  const SEQUENCES = ['rungs', 'scales', 'accept_formats']
  const changed = SEQUENCES.some((k) => k in overrides)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs">
          {changed ? '順序、倍率或格式已修改' : '順序、倍率、格式為預設值'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!changed}
          onClick={() =>
            onChange(
              Object.fromEntries(Object.entries(overrides).filter(([k]) => !SEQUENCES.includes(k))),
            )
          }
        >
          <RotateCcw className="size-3.5" aria-hidden />
          還原順序與倍率
        </Button>
      </div>
      <fieldset>
        <legend className="text-ink-2 border-card-border mb-1.5 w-full border-b pb-1 text-[11px] font-semibold tracking-wider">
          嘗試順序
        </legend>
        <p className="text-muted mb-2 text-xs">
          依序嘗試，第一次成功即停止；最終順序由 E1 實驗決定。
        </p>
        <ol className="space-y-1">
          {rungs.map((r, i) => (
            <li
              key={r}
              className="border-card-border bg-card flex items-center gap-2 rounded-[3px] border px-2 py-1 text-[13px]"
            >
              <span className="text-muted tabular w-4 text-xs">{i + 1}</span>
              <span className="flex-1">{rungText(r)}</span>
              <IconButton
                label={`${rungText(r)}往前`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp className="size-3.5" />
              </IconButton>
              <IconButton
                label={`${rungText(r)}往後`}
                disabled={i === rungs.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="size-3.5" />
              </IconButton>
              <IconButton
                label={`移除${rungText(r)}`}
                disabled={rungs.length === 1}
                onClick={() =>
                  set(
                    'rungs',
                    rungs.filter((x) => x !== r),
                  )
                }
              >
                <X className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ol>
        {unused.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {unused.map((r) => (
              <Button key={r} size="sm" variant="ghost" onClick={() => set('rungs', [...rungs, r])}>
                <Plus className="size-3.5" aria-hidden />
                {rungText(r)}
              </Button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-ink-2 border-card-border mb-1.5 w-full border-b pb-1 text-[11px] font-semibold tracking-wider">
          多尺度倍率
        </legend>
        <p className="text-muted mb-2 text-xs">多尺度階依點選順序嘗試的縮放倍率。</p>
        <Chips
          options={[...new Set([...SCALE_OPTIONS, ...scales])].sort((a, b) => a - b)}
          selected={scales}
          format={(v) => `×${v}`}
          ordered
          onToggle={(v) =>
            set('scales', scales.includes(v) ? scales.filter((x) => x !== v) : [...scales, v])
          }
        />
      </fieldset>

      {showFormats && (
        <fieldset>
          <legend className="text-ink-2 border-card-border mb-1.5 w-full border-b pb-1 text-[11px] font-semibold tracking-wider">
            採用格式
          </legend>
          <p className="text-muted mb-2 text-xs">
            全部不選為全部採用；其他格式的結果不採用（例如斜拍 EAN-13 被誤讀成 UPC-E）。
          </p>
          <Chips
            options={allFormats}
            selected={formats}
            format={String}
            onToggle={(v) =>
              set(
                'accept_formats',
                formats.includes(v) ? formats.filter((x) => x !== v) : [...formats, v],
              )
            }
          />
        </fieldset>
      )}
    </div>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="text-muted hover:text-ink rounded p-0.5 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function Chips<T extends string | number>({
  options,
  selected,
  format,
  onToggle,
  ordered,
}: {
  options: T[]
  selected: T[]
  format: (v: T) => string
  onToggle: (v: T) => void
  /** 顯示點選順序（順序有意義時） */
  ordered?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button
            key={String(o)}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o)}
            className={cn(
              'readout rounded-[3px] border px-2 py-0.5 text-xs',
              on
                ? 'border-primary bg-primary-soft text-primary-ink'
                : 'border-card-border text-muted hover:bg-hover',
            )}
          >
            {format(o)}
            {ordered && on && selected.length > 1 && (
              <span className="ml-1 opacity-60">{selected.indexOf(o) + 1}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
