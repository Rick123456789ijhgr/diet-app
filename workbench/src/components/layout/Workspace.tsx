// 工具頁版面（精密儀器風）：
//
//   ┌ 控制面板 ┬ 頁首列（標題・說明・右側操作）──────────┐
//   │          ├ 主檢視（影像／圖表，自行捲動）┬ 讀數欄 ─┤
//   └──────────┴──────────────────────────────┴─────────┘
//
// Workspace 負責控制面板與頁首列；主檢視與讀數欄由 Split 排出（通常放在 AnalysisFrame 內）。
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export const PANEL_WIDTH = 304
export const READOUT_WIDTH = 288

export function Workspace({
  panel,
  title,
  description,
  aside,
  children,
}: {
  panel: ReactNode
  title: string
  description: string
  /** 頁首列右側（計算中標示、模式切換等） */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="控制面板"
        className="border-card-border bg-card shrink-0 overflow-y-auto border-r"
        style={{ width: PANEL_WIDTH }}
      >
        {panel}
      </section>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-card-border bg-card flex min-h-11 shrink-0 items-center gap-4 border-b px-4 py-1.5">
          <div className="min-w-0 flex-1">
            <h1 className="text-[14px] leading-tight font-semibold">{title}</h1>
            <p className="text-muted truncate text-xs" title={description}>
              {description}
            </p>
          </div>
          {aside}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

/** 主檢視＋右側讀數欄。main 自行捲動；readout 為空時主檢視佔滿。 */
export function Split({ main, readout }: { main: ReactNode; readout?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">{main}</div>
      {readout && (
        <aside
          aria-label="讀數"
          className="border-card-border bg-card shrink-0 overflow-y-auto border-l"
          style={{ width: READOUT_WIDTH }}
        >
          {readout}
        </aside>
      )}
    </div>
  )
}

/**
 * 主檢視：上方工具列（檢視切換等）＋佔滿剩餘高度的內容（影像檢視器會撐滿）。
 * scroll 為 true 時內容區自行捲動（表格、圖表等）。
 */
export function MainView({
  toolbar,
  children,
  scroll,
  footer,
}: {
  toolbar?: ReactNode
  children: ReactNode
  scroll?: boolean
  footer?: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar && (
        <div className="border-card-border bg-sunken flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
          {toolbar}
        </div>
      )}
      <div className={cn('flex min-h-0 flex-1 flex-col', scroll && 'overflow-y-auto p-4')}>
        {children}
      </div>
      {footer && (
        <div className="border-card-border text-muted shrink-0 border-t px-3 py-1.5 text-xs">
          {footer}
        </div>
      )}
    </div>
  )
}

/** 內容區塊（主檢視或讀數欄裡）：細線標題列＋內容。 */
export function Section({
  title,
  children,
  aside,
  className,
}: {
  title: string
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-5', className)}>
      <div className="border-card-border mb-2 flex min-h-6 items-center justify-between gap-2 border-b pb-1">
        <h2 className="text-ink-2 text-[11px] font-semibold tracking-wider">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** 讀數欄裡的一個區塊：上方細線分隔、內距一致。 */
export function ReadoutBlock({
  title,
  children,
  aside,
}: {
  title?: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className="border-card-border border-b px-3 py-3 last:border-b-0">
      {title && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-muted text-[11px] font-semibold tracking-wider">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="text-muted flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
      {icon}
      {children}
    </div>
  )
}
