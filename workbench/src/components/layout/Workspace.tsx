// 工具頁版面：淺灰主區面板上的白色卡片（20px 圓角、無框）。
//
//   ┌ 控制面板卡 ┐  標題 ⓘ                              右側操作
//   │            │  ┌ 主檢視卡（影像／圖表）────┐ ┌ 讀數卡 ┐
//   │            │  │                           │ ├ 讀數卡 ┤
//   └────────────┘  └───────────────────────────┘ └────────┘
//
// Workspace 負責控制面板與標題；主檢視與讀數欄由 Split 排出（通常放在 AnalysisFrame 內）。
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { InfoTip } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'

// 左側控制面板與右側讀數欄的固定寬度（px）；中間主檢視吃掉剩餘寬度
export const PANEL_WIDTH = 316
export const READOUT_WIDTH = 312

/** 控制面板收起與否記在瀏覽器（每位使用者自己的偏好，所有工具頁共用）；讀不到時預設展開。 */
const PANEL_KEY = 'wb.panelCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(PANEL_KEY, v ? '1' : '0')
  } catch {
    // 私密視窗等情況無法儲存：只影響下次開啟時的預設
  }
}

/**
 * 工具頁的外層版面：左側控制面板卡（panel，由 PanelSections 的段落組成）＋右側「標題列＋內容」。
 * 控制面板自行捲動（overflow-y-auto），內容區撐滿剩餘高度，整頁不捲動。
 * - title／description：頁面標題；說明不直接顯示，放在標題旁的 ⓘ 提示裡。
 * - 標題左側的按鈕可收起控制面板，讓主檢視變寬；收起時面板只是隱藏（保留輸入中的內容）。
 */
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
  const panelId = useId()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = () => {
    writeCollapsed(!collapsed)
    setCollapsed(!collapsed)
  }
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    // min-h-0：flex 子項預設 min-height 為內容高度，不設的話內容會把版面撐高、內部捲動失效
    <div className="flex h-full min-h-0 gap-3 p-4">
      {/* 具名的 section（aria-label）成為地標，螢幕閱讀器可直接跳到控制面板 */}
      <section
        id={panelId}
        aria-label="控制面板"
        hidden={collapsed}
        className="bg-card shadow-card rounded-card shrink-0 overflow-y-auto"
        style={{ width: PANEL_WIDTH }}
      >
        {panel}
      </section>
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          title={title}
          description={description}
          aside={aside}
          leading={
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!collapsed}
              aria-controls={panelId}
              aria-label={collapsed ? '展開控制面板' : '收起控制面板'}
              title={collapsed ? '展開控制面板' : '收起控制面板'}
              className="text-muted hover:bg-card hover:text-ink focus-visible:ring-primary/40 grid size-9 shrink-0 place-items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
            >
              <Icon className="size-[18px]" aria-hidden />
            </button>
          }
        />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

/** 頁面標題列：標題＋說明圖示（ⓘ），右側放操作。工具頁由 Workspace 帶入；沒有控制面板的頁面直接使用。 */
export function PageHeader({
  title,
  description,
  aside,
  leading,
}: {
  title: ReactNode
  description: string
  aside?: ReactNode
  /** 標題左側（例如收起控制面板的按鈕） */
  leading?: ReactNode
}) {
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-2 pb-4">
      {leading}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <h1 className="truncate text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
        {description && <InfoTip text={description} label="頁面說明" side="bottom" />}
      </div>
      {aside}
    </div>
  )
}

/**
 * 主檢視卡＋右側讀數欄（多張小卡）。readout 為空時主檢視佔滿。
 * 主檢視與讀數欄各自垂直捲動；主檢視外層 overflow-hidden 讓內容不超出圓角。
 */
export function Split({ main, readout }: { main: ReactNode; readout?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="bg-card shadow-card rounded-card min-w-0 flex-1 overflow-hidden">
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
 * scroll 為 false 時內容區不捲動，讓 ImageViewer（fill）以 flex-1 撐滿剩餘高度。footer 固定在底部。
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-4 pb-2">{toolbar}</div>
      )}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          scroll ? 'overflow-y-auto px-5 pt-2 pb-5' : 'px-3 pt-1 pb-3',
        )}
      >
        {children}
      </div>
      {footer && <div className="text-muted shrink-0 px-5 pb-3 text-xs">{footer}</div>}
    </div>
  )
}

/** 內容區塊（主檢視裡）：標題列＋內容。 */
export function Section({
  title,
  hint,
  children,
  aside,
  className,
}: {
  title: string
  /** 區塊說明，放在標題旁的 ⓘ 提示裡 */
  hint?: ReactNode
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-5', className)}>
      <div className="mb-2 flex min-h-7 items-center gap-1.5">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {hint && <InfoTip text={hint} />}
        {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

/** 讀數欄裡的一張卡。 */
export function ReadoutBlock({
  title,
  hint,
  children,
  aside,
}: {
  title?: string
  /** 說明，放在標題旁的 ⓘ 提示裡 */
  hint?: ReactNode
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className="bg-card shadow-card rounded-card shrink-0 p-4">
      {title && (
        <div className="mb-2.5 flex items-center gap-1.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {hint && <InfoTip text={hint} />}
          {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** 空狀態／載入中的置中提示（可附圖示），例如尚未選檔、載入中。 */
export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="text-muted flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm [&_svg]:opacity-70">
      {icon}
      {children}
    </div>
  )
}
