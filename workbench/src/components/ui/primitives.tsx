// 基本元件（以 Radix 為底，精密儀器風）。顏色只用主題變數，見 index.css。
import { Slider as RSlider, Switch as RSwitch, Tabs as RTabs, ToggleGroup, Tooltip } from 'radix-ui'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'outline' | 'ghost'

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
        'inline-flex items-center justify-center gap-1.5 rounded-[3px] font-medium transition-colors',
        'focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-3 text-[13px]',
        variant === 'primary' && 'bg-primary hover:bg-primary-ink text-white',
        variant === 'outline' && 'border-line-strong bg-card hover:bg-hover border',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('border-card-border bg-card rounded-[4px] border', className)} {...props} />
  )
}

type BadgeTone = 'primary' | 'accent' | 'ok' | 'warn' | 'danger' | 'muted'

/** 小標籤。accent 為「需要注意」（與 warn 相同），保留給既有呼叫端。 */
export function Badge({
  tone = 'muted',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[3px] border px-1.5 text-[11px] font-medium whitespace-nowrap',
        tone === 'primary' && 'border-primary/30 bg-primary-soft text-primary-ink',
        tone === 'ok' && 'border-ok/30 bg-ok-soft text-ok',
        (tone === 'warn' || tone === 'accent') && 'border-warn/30 bg-warn-soft text-warn',
        tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger',
        tone === 'muted' && 'border-card-border bg-sunken text-ink-2',
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
      <RSlider.Track className="bg-line-strong/60 relative h-[2px] grow">
        <RSlider.Range className="bg-primary absolute h-full" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={props['aria-label']}
        className="border-primary bg-card focus-visible:ring-primary/40 block h-3.5 w-2 rounded-[2px] border-2 focus-visible:ring-4 focus-visible:outline-none"
      />
    </RSlider.Root>
  )
}

export function Switch({ className, ...props }: ComponentProps<typeof RSwitch.Root>) {
  return (
    <RSwitch.Root
      className={cn(
        'data-[state=checked]:bg-primary bg-line-strong relative h-4 w-7 shrink-0 rounded-[3px] transition-colors',
        'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <RSwitch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-[2px] bg-white transition-transform data-[state=checked]:translate-x-[14px]" />
    </RSwitch.Root>
  )
}

export const Tabs = RTabs.Root

/** 分頁：底線式，像儀器面板上的頁籤。 */
export function TabsList({ className, ...props }: ComponentProps<typeof RTabs.List>) {
  return (
    <RTabs.List
      className={cn('border-card-border grid auto-cols-fr grid-flow-col border-b', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        'text-muted hover:text-ink -mb-px inline-flex h-9 items-center justify-center gap-1.5 border-b-2 border-transparent px-2 text-[13px] font-medium',
        'data-[state=active]:border-primary data-[state=active]:text-ink',
        'focus-visible:bg-hover focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = RTabs.Content

/** 單選的分段按鈕（例如檢視切換）；選中的一格以底部藍線標示。 */
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
      className={cn(
        'border-card-border bg-sunken divide-card-border inline-flex divide-x rounded-[3px] border',
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'text-muted hover:text-ink inline-flex h-7 flex-1 items-center justify-center gap-1.5 px-2.5 text-xs font-medium whitespace-nowrap first:rounded-l-[2px] last:rounded-r-[2px]',
            'data-[state=on]:bg-card data-[state=on]:text-ink data-[state=on]:shadow-[inset_0_-2px_0_var(--primary)]',
            'focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
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

export function Hint({ text, children }: { text: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="bg-ink text-canvas z-50 max-w-72 rounded-[3px] px-2.5 py-1.5 text-xs leading-relaxed"
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
        'border-card-border bg-sunken readout h-6 w-20 rounded-[3px] border px-1.5 text-right text-xs',
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
