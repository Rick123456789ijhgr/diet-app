// 基本元件（以 Radix 為底，柔和卡片風）。顏色只用主題變數，見 index.css。
import { Slider as RSlider, Switch as RSwitch, Tabs as RTabs, ToggleGroup, Tooltip } from 'radix-ui'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'outline' | 'ghost'

/** 按鈕：膠囊形；primary 為黑底（深色模式反白）。 */
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

export const Tabs = RTabs.Root

/** 分頁：灰色膠囊軌道，選中的一格為白色膠囊。 */
export function TabsList({ className, ...props }: ComponentProps<typeof RTabs.List>) {
  return (
    <RTabs.List
      className={cn('bg-sunken grid auto-cols-fr grid-flow-col gap-1 rounded-full p-1', className)}
      {...props}
    />
  )
}

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

/** 單選的分段按鈕（例如檢視切換）：灰色膠囊軌道，選中的一格為白色膠囊。 */
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

export const TooltipProvider = Tooltip.Provider

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

/** 數字輸入：打字時保留原字串，可以暫時清空；合法時才回報，離開欄位後恢復成目前值。 */
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
  useEffect(() => {
    if (!editing) setText(format(value))
  }, [value, format, editing])
  return (
    <NumberInput
      {...props}
      value={text}
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
        if (e.target.value.trim() === '') return
        const v = parse(e.target.value)
        if (v !== undefined && Number.isFinite(v)) onCommit(v)
      }}
    />
  )
}
