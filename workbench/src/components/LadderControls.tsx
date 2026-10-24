// 條碼逐步升級的序列參數：嘗試順序、多尺度倍率、採用格式（LadderConfig 中不以 param() 宣告的欄位）。
import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from 'lucide-react'

import type { ConfigClass, ConfigOverride } from '@/api/client'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { sequenceOf, setSequence } from '@/lib/config'
import { rungText } from '@/lib/text'

// 多尺度倍率的候選值；目前設定中若有不在此列的倍率（例如匯入的設定），會另外併入選項顯示
const SCALE_OPTIONS = [0.25, 0.5, 0.75, 1.5, 2, 3, 4]

/**
 * 條碼逐步升級（ladder）的序列欄位編輯器。這些欄位是陣列、不是單一數值，
 * ParamForm 無法自動產生表單，所以在這裡手寫。
 * - schema／overrides：LadderConfig 的結構與目前的覆寫；顯示值為「覆寫優先，否則預設」。
 * - onChange：回傳新的覆寫物件；與預設值相同的欄位由 setSequence 移除，請求只帶差異。
 * - rungs／formats：可選的全部階與格式（來自後端 enums）。
 */
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

  // 把第 i 階與相鄰一階（d = -1 往前、+1 往後）交換；邊界由按鈕的 disabled 擋住，不會越界
  const move = (i: number, d: -1 | 1) => {
    const next = rungs.slice()
    ;[next[i], next[i + d]] = [next[i + d]!, next[i]!]
    set('rungs', next)
  }
  // 尚未加入序列的階，顯示為下方的「＋」按鈕
  const unused = allRungs.filter((r) => !rungs.includes(r))
  // 本元件負責的三個序列欄位；有任一出現在覆寫中即視為「已修改」
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
          // 只移除這三個序列欄位（順序、倍率、格式）的覆寫，ParamForm 管理的其他數值參數保持不變；
          // 按鈕文字與實際行為一致，含採用格式（發票模式不顯示格式，但同樣還原）
          onClick={() =>
            onChange(
              Object.fromEntries(Object.entries(overrides).filter(([k]) => !SEQUENCES.includes(k))),
            )
          }
        >
          <RotateCcw className="size-3.5" aria-hidden />
          還原順序、倍率與格式
        </Button>
      </div>
      <fieldset>
        <legend className="text-ink mb-1.5 text-xs font-semibold">嘗試順序</legend>
        <p className="text-muted mb-2 text-xs">
          依序嘗試，第一次成功即停止；最終順序由 E1 實驗決定。
        </p>
        <ol className="space-y-1">
          {/* 以階名為 key（序列內不重複），重新排序時 React 能正確搬移列而不是重建 */}
          {rungs.map((r, i) => (
            <li
              key={r}
              className="border-card-border bg-card flex items-center gap-2 rounded-lg border px-2 py-1 text-[13px]"
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
                // 至少保留一階，否則逐步升級沒有任何嘗試
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
        <legend className="text-ink mb-1.5 text-xs font-semibold">多尺度倍率</legend>
        <p className="text-muted mb-2 text-xs">多尺度階依點選順序嘗試的縮放倍率。</p>
        {/* 選項＝候選值 ∪ 目前已選（去重後由小到大）；已選的順序即嘗試順序，點選時加到最後、再點一次移除 */}
        <Chips
          options={[...new Set([...SCALE_OPTIONS, ...scales])].sort((a, b) => a - b)}
          selected={scales}
          format={(v) => `×${v}`}
          ordered
          // 至少保留一個倍率：全部取消會送出空陣列，多尺度階就沒有任何倍率可試
          minSelected={1}
          onToggle={(v) =>
            set('scales', scales.includes(v) ? scales.filter((x) => x !== v) : [...scales, v])
          }
        />
      </fieldset>

      {showFormats && (
        <fieldset>
          <legend className="text-ink mb-1.5 text-xs font-semibold">採用格式</legend>
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

/** 只有圖示的小按鈕；label 作為 aria-label，因為按鈕內沒有可讀文字。 */
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

/**
 * 多選膠囊按鈕組。每個選項是切換按鈕（aria-pressed 讓輔助技術知道選取狀態）；
 * ordered 時在已選項旁標出它在 selected 中的順位（只選一個時不標）。
 */
function Chips<T extends string | number>({
  options,
  selected,
  format,
  onToggle,
  ordered,
  minSelected = 0,
}: {
  options: T[]
  selected: T[]
  format: (v: T) => string
  onToggle: (v: T) => void
  /** 顯示點選順序（順序有意義時） */
  ordered?: boolean
  /** 至少要保留的選取數；已達下限時，已選的項目不能再取消 */
  minSelected?: number
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o)
        // 已達下限的已選項目停用（未選的項目仍可加入）
        const locked = on && selected.length <= minSelected
        return (
          <button
            key={String(o)}
            type="button"
            aria-pressed={on}
            disabled={locked}
            title={locked ? `至少保留 ${minSelected} 個` : undefined}
            onClick={() => onToggle(o)}
            className={cn(
              'readout rounded-lg border px-2 py-0.5 text-xs disabled:cursor-not-allowed',
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
