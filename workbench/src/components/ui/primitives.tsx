// 基本元件（shadcn/ui 風格，以 Radix 為底）。顏色只用主題變數，見 index.css。
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
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-primary text-white hover:opacity-90',
        variant === 'outline' && 'border-card-border bg-card hover:bg-hover border',
        variant === 'ghost' && 'text-muted hover:bg-hover hover:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('border-card-border bg-card shadow-card rounded-xl border', className)}
      {...props}
    />
  )
}

type BadgeTone = 'primary' | 'accent' | 'danger' | 'muted'

export function Badge({
  tone = 'muted',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone === 'primary' && 'bg-primary-soft text-primary',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'muted' && 'bg-hover text-muted',
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
      className={cn('relative flex h-5 w-full touch-none items-center select-none', className)}
      {...props}
    >
      <RSlider.Track className="bg-hover relative h-1.5 grow overflow-hidden rounded-full">
        <RSlider.Range className="bg-primary absolute h-full" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={props['aria-label']}
        className="border-primary bg-card focus-visible:ring-primary/40 block size-4 rounded-full border-2 shadow focus-visible:ring-4 focus-visible:outline-none"
      />
    </RSlider.Root>
  )
}

export function Switch({ className, ...props }: ComponentProps<typeof RSwitch.Root>) {
  return (
    <RSwitch.Root
      className={cn(
        'data-[state=checked]:bg-primary bg-card-border relative h-5 w-9 shrink-0 rounded-full transition-colors',
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

export function TabsList({ className, ...props }: ComponentProps<typeof RTabs.List>) {
  return (
    <RTabs.List
      className={cn('bg-hover grid auto-cols-fr grid-flow-col gap-1 rounded-lg p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        'text-muted inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium',
        'data-[state=active]:bg-card data-[state=active]:text-ink data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = RTabs.Content

/** 單選的分段按鈕（例如檢視切換）。 */
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
      className={cn('bg-hover inline-flex gap-1 rounded-lg p-1', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'text-muted inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap',
            'data-[state=on]:bg-card data-[state=on]:text-ink data-[state=on]:shadow-sm',
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
          className="bg-ink text-canvas z-50 max-w-72 rounded-md px-2.5 py-1.5 text-xs leading-relaxed shadow-lg"
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
        'border-card-border bg-card tabular h-7 w-20 rounded-md border px-2 text-right text-sm',
        'focus-visible:border-primary focus-visible:outline-none',
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
