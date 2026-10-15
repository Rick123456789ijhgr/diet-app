// 工具頁版面（柔和卡片風）：灰色畫布上的白色大圓角卡片。
//
//   ┌ 控制面板卡 ┐  大標題・說明                       右側操作
//   │            │  ┌ 主檢視卡（影像／圖表）────┐ ┌ 讀數卡 ┐
//   │            │  │                           │ ├ 讀數卡 ┤
//   └────────────┘  └───────────────────────────┘ └────────┘
//
// Workspace 負責控制面板與標題；主檢視與讀數欄由 Split 排出（通常放在 AnalysisFrame 內）。
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export const PANEL_WIDTH = 312
export const READOUT_WIDTH = 296

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
  /** 標題右側（計算中標示、模式切換等） */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 gap-3 pr-3 pb-3">
      <section
        aria-label="控制面板"
        className="bg-card shadow-card shrink-0 overflow-y-auto rounded-[20px]"
        style={{ width: PANEL_WIDTH }}
      >
        {panel}
      </section>
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title={title} description={description} aside={aside} />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

/** 頁面標題列：大標題・說明，右側放操作。工具頁由 Workspace 帶入；沒有控制面板的頁面直接使用。 */
export function PageHeader({
  title,
  description,
  aside,
}: {
  title: ReactNode
  description: string
  aside?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-end gap-4 px-1 pt-1 pb-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="text-muted mt-0.5 truncate text-[13px]" title={description}>
          {description}
        </p>
      </div>
      {aside}
    </div>
  )
}

/** 主檢視卡＋右側讀數欄（多張小卡）。readout 為空時主檢視佔滿。 */
export function Split({ main, readout }: { main: ReactNode; readout?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="bg-card shadow-card min-w-0 flex-1 overflow-hidden rounded-[20px]">
        <div className="h-full overflow-y-auto">{main}</div>
      </div>
      {readout && (
        <aside
          aria-label="讀數"
          className="flex shrink-0 flex-col gap-3 overflow-y-auto"
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-4 pb-3">{toolbar}</div>
      )}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          scroll ? 'overflow-y-auto px-5 pb-5' : 'px-3 pb-3',
        )}
      >
        {children}
      </div>
      {footer && <div className="text-muted shrink-0 px-5 pb-4 text-xs">{footer}</div>}
    </div>
  )
}

/** 內容區塊（主檢視裡）：標題列＋內容。 */
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
      <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** 讀數欄裡的一張卡。 */
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
    <section className="bg-card shadow-card shrink-0 rounded-[20px] p-4">
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold">{title}</h2>
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
