// 控制面板的段落：固定顯示的一段（PanelSection）與可收合的一段（Disclosure）。
// 模組一各頁的左欄一律由上而下排這兩種段落，不用分頁（見 workbench/CLAUDE.md）。
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

/** 控制面板的一段（有標題時顯示小標）。 */
export function PanelSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 px-4 py-4">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {children}
    </section>
  )
}

/** 可收合的一段（受控）：標題列是按鈕（aria-expanded）；內容收合時不渲染。 */
export function Disclosure({
  open,
  onOpenChange,
  icon: Icon,
  title,
  badge,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  icon: LucideIcon
  title: string
  badge?: ReactNode
  children: ReactNode
}) {
  const contentId = useId()
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => onOpenChange(!open)}
        className="hover:bg-hover focus-visible:ring-primary/40 flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      >
        <Icon className="text-muted size-4" aria-hidden />
        <span className="flex-1">{title}</span>
        {badge}
        <ChevronDown
          className={cn('text-muted size-4 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && (
        <div id={contentId} className="px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  )
}

/** 控制面板外框：段落之間以細線分隔。 */
export function PanelStack({ children }: { children: ReactNode }) {
  return <div className="divide-card-border divide-y">{children}</div>
}

/**
 * 同一頁的多種模式切換時保留各模式的狀態：去過的模式保持掛載，只把不在前景的隱藏。
 * active 為 false 時以 display:none 隱藏（螢幕閱讀器與 getByRole 都會略過）；
 * 用 inline style 而非 class，測試環境（jsdom，不載入 Tailwind）也看得到隱藏。
 */
export function KeepAlive({ active, children }: { active: boolean; children: ReactNode }) {
  return <div style={{ display: active ? 'contents' : 'none' }}>{children}</div>
}
