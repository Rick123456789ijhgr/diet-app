// 基本元件（以 Radix 為底，柔和卡片風）。顏色只用主題變數，見 index.css。
import { Slider as RSlider, Switch as RSwitch, Tabs as RTabs, ToggleGroup, Tooltip } from 'radix-ui'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'outline' | 'ghost'

/**
 * 按鈕：膠囊形；primary 為黑底（深色模式反白）。
 * 預設 type="button"，避免放在 <form> 內時被當成送出鈕；呼叫端仍可用 props 覆寫（{...props} 在後）。
 * 焦點只在鍵盤操作時顯示外框（focus-visible）；disabled 時同時關閉滑鼠事件。
 */
export function Button({
  variant = 'outline',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors',
        'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-4 text-[13px]',
        variant === 'primary' && 'bg-ink text-on-ink hover:opacity-85',
        variant === 'outline' && 'bg-sunken text-ink hover:bg-hover',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        className,
      )}
      {...props}
    />
  )
}

/** 白色大圓角卡片（20px）。 */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('bg-card shadow-card rounded-[20px]', className)} {...props} />
}

type BadgeTone = 'primary' | 'accent' | 'ok' | 'warn' | 'danger' | 'muted'

/** 小標籤（膠囊形）。accent 為「需要注意」（與 warn 相同），保留給既有呼叫端。 */
export function Badge({
  tone = 'muted',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap',
        tone === 'primary' && 'bg-primary-soft text-primary-ink',
        tone === 'ok' && 'bg-ok-soft text-ok',
        (tone === 'warn' || tone === 'accent') && 'bg-warn-soft text-warn',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'muted' && 'bg-sunken text-ink-2',
        className,
      )}
      {...props}
    />
  )
}

/**
 * 單把手滑桿（Radix Slider）。value／onValueChange 是陣列（Radix 支援多把手），這裡只畫一個 Thumb。
 * aria-label 要另外傳給 Thumb：Radix 中真正可聚焦、帶 role="slider" 的是 Thumb，不是 Root。
 * touch-none 讓觸控拖曳不會捲動頁面。
 */
export function Slider({
  className,
  ...props
}: ComponentProps<typeof RSlider.Root> & { 'aria-label'?: string }) {
  return (
    <RSlider.Root
      className={cn('relative flex h-4 w-full touch-none items-center select-none', className)}
      {...props}
    >
      <RSlider.Track className="bg-hover relative h-1.5 grow overflow-hidden rounded-full">
        <RSlider.Range className="bg-primary absolute h-full rounded-full" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={props['aria-label']}
        className="border-primary bg-card focus-visible:ring-primary/30 block size-4 rounded-full border-[3px] focus-visible:ring-4 focus-visible:outline-none"
      />
    </RSlider.Root>
  )
}

/** 開關（Radix Switch，role="switch"）。開啟時 Radix 設定 data-state=checked，樣式據此切換底色與圓鈕位置。 */
export function Switch({ className, ...props }: ComponentProps<typeof RSwitch.Root>) {
  return (
    <RSwitch.Root
      className={cn(
        'data-[state=checked]:bg-primary bg-line-strong relative h-5 w-9 shrink-0 rounded-full transition-colors',
        'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  )
}

// Tabs 根元件與內容直接沿用 Radix（鍵盤左右鍵切換、aria 關聯都由 Radix 處理），只為 List／Trigger 套樣式
export const Tabs = RTabs.Root

/** 分頁：灰色膠囊軌道，選中的一格為白色膠囊。 */
export function TabsList({ className, ...props }: ComponentProps<typeof RTabs.List>) {
  return (
    // grid-flow-col＋auto-cols-fr：分頁數不固定，每個分頁自動等寬
    <RTabs.List
      className={cn('bg-sunken grid auto-cols-fr grid-flow-col gap-1 rounded-full p-1', className)}
      {...props}
    />
  )
}

/** 單一分頁按鈕；選中時 Radix 設定 data-state=active，樣式據此變成白色膠囊。 */
export function TabsTrigger({ className, ...props }: ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        'text-muted hover:text-ink inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-medium transition-colors',
        'data-[state=active]:bg-card data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_3px_rgb(0_0_0/0.08)]',
        'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = RTabs.Content

/**
 * 單選的分段按鈕（例如檢視切換）：灰色膠囊軌道，選中的一格為白色膠囊。
 * 以 Radix ToggleGroup（type="single"）實作，鍵盤可用方向鍵切換；label 作為整組的 aria-label。
 * options[].value 同時作為 key，須唯一。
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
  className?: string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // 再點一次已選的項目時 Radix 會回傳空字串（取消選取）；忽略它，確保永遠有一項被選取
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className={cn('bg-sunken inline-flex gap-0.5 rounded-full p-1', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'text-muted hover:text-ink inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors',
            'data-[state=on]:bg-card data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_3px_rgb(0_0_0/0.08)]',
            'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none',
            '[&_svg]:size-3.5',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

// Radix Tooltip 需要上層有 Provider（在 App 根部包一次），Hint 才能運作
export const TooltipProvider = Tooltip.Provider

/**
 * 懸停／聚焦時顯示的說明提示（Radix Tooltip，延遲 300ms）。
 * Trigger 用 asChild：不額外包一層元素，直接把事件與 aria 屬性掛到 children 上，
 * 因此 children 必須是單一、能接收 ref 與事件的元素。內容經 Portal 渲染到 body，不會被捲動容器裁切。
 */
export function Hint({
  text,
  children,
  side = 'top',
}: {
  text: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="bg-ink text-on-ink z-50 max-w-72 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
        >
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** 原生數字輸入框的外觀包裝；aria-invalid="true" 時顯示紅框（由 aria 屬性驅動樣式，狀態與無障礙一致）。 */
export function NumberInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="number"
      className={cn(
        'bg-sunken tabular h-7 w-20 rounded-lg border border-transparent px-2 text-right text-xs',
        'focus-visible:border-primary focus-visible:bg-card focus-visible:outline-none',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  )
}

/**
 * 數字輸入：打字時保留原字串，可以暫時清空；合法時才回報，離開欄位後恢復成目前值。
 * 採「草稿字串＋已提交數值」雙軌：text 是輸入框顯示的字串，value 是外部的實際值。
 * 若直接以 value 受控，打到一半的「1.」「-」或清空會立刻被格式化回去，無法輸入。
 * - format：數值 → 顯示字串（例如固定小數位）。
 * - parse：字串 → 數值；回傳 undefined 或非有限數（NaN、Infinity）都視為不合法、不回報。
 * - onCommit：每次輸入合法就立即回報（不等 blur），配合即時調參。
 */
export function DraftNumberInput({
  value,
  format = String,
  parse = Number,
  onCommit,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange'> & {
  value: number
  format?: (v: number) => string
  /** 回傳 undefined 表示不合法、不回報 */
  parse?: (text: string) => number | undefined
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(format(value))
  const [editing, setEditing] = useState(false)
  // 不在編輯時，外部值改變（例如還原、匯入、拖滑桿）就同步顯示字串；編輯中不覆蓋使用者正在打的字。
  // editing 列入依賴：blur（editing 變 false）時也會觸發，把不合法或未格式化的草稿恢復成目前值。
  // 注意：呼叫端常傳內聯的 format 函式，每次渲染都是新參照，此 effect 會在每次渲染後執行；
  // 因 setText 相同字串時 React 會略過重繪，結果正確，只是多做一點工。
  useEffect(() => {
    if (!editing) setText(format(value))
  }, [value, format, editing])
  return (
    <NumberInput
      {...props}
      value={text}
      // 包裝 onFocus／onBlur 以追蹤編輯狀態，同時保留呼叫端傳入的同名處理器
      onFocus={(e) => {
        setEditing(true)
        props.onFocus?.(e)
      }}
      onBlur={(e) => {
        setEditing(false)
        props.onBlur?.(e)
      }}
      onChange={(e) => {
        setText(e.target.value)
        // 空字串不回報（Number('') 會變成 0，不是使用者的意思）
        if (e.target.value.trim() === '') return
        const v = parse(e.target.value)
        if (v !== undefined && Number.isFinite(v)) onCommit(v)
      }}
    />
  )
}
