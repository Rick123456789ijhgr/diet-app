// 工具頁版面：左控制面板＋右結果，兩欄佔滿一個畫面高、各自捲動。
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export const PANEL_WIDTH = 380

export function Workspace({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="控制面板"
        className="border-card-border bg-card shrink-0 overflow-y-auto border-r p-4"
        style={{ width: PANEL_WIDTH }}
      >
        {panel}
      </section>
      <section aria-label="結果" className="min-w-0 flex-1 overflow-y-auto p-5">
        {children}
      </section>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  aside,
}: {
  title: string
  description: string
  aside?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-muted mt-0.5 text-sm">{description}</p>
      </div>
      {aside}
    </div>
  )
}

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
    <div className={cn('mb-5', className)}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-muted text-xs font-semibold tracking-wide">{title}</h2>
        {aside}
      </div>
      {children}
    </div>
  )
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="text-muted flex h-64 flex-col items-center justify-center gap-2 text-sm">
      {icon}
      {children}
    </div>
  )
}
