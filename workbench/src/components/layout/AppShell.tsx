// 外框（森林綠儀表板）：白色外框裡三塊淺灰大圓角面板——
//   左側欄（標誌、模組導覽、深綠服務狀態卡）、頂列（目前模組的頁面分頁、深淺色切換、登入者）、主區（頁面）。
import { useQuery } from '@tanstack/react-query'
import {
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

import { api, ApiError, unwrap } from '@/api/client'
import { Button, Hint } from '@/components/ui/primitives'
import { useLogout, useMe } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'
import { errorText } from '@/lib/text'
import { HOME, locate, MODULES, modulePath, toolPath, type Module } from '@/nav'

/** 側欄收合與否記在瀏覽器（每位使用者自己的偏好）；讀不到時預設展開。 */
const SIDEBAR_KEY = 'wb.sidebarCollapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

/** 研究模組（模組一到五）與其他（冷啟動、通用工具）分兩組列在側欄 */
const RESEARCH = MODULES.filter((m) => m.id.startsWith('m'))
const OTHERS = MODULES.filter((m) => !m.id.startsWith('m'))

/**
 * 整個工作台的外框（路由的版面元件）：子路由頁面經 <Outlet /> 渲染在 <main> 內。
 * 目前的模組與工具頁由網址推得（locate），用來標示側欄與頂列分頁的選中狀態。
 */
export function AppShell() {
  const { module, tool } = locate(useLocation().pathname)
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)
  const toggleSidebar = () => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? '0' : '1')
    } catch {
      // 無法儲存時只影響下次開啟時的預設
    }
    setCollapsed(!collapsed)
  }
  return (
    <div className="bg-canvas flex h-full gap-3 p-3">
      <Sidebar activeId={module.id} collapsed={collapsed} onToggle={toggleSidebar} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="bg-panel flex h-16 shrink-0 items-center gap-3 rounded-[var(--radius-panel)] px-3">
          {/* 目前模組的頁面分頁；沒有工具頁的模組（例如總覽）顯示模組名稱。頁面多時可橫向捲動 */}
          {module.tools.length > 0 ? (
            <nav
              aria-label="頁面"
              className="bg-card flex min-w-0 gap-0.5 overflow-x-auto rounded-full p-1"
            >
              {module.tools.map((t) => (
                <NavLink
                  key={t.slug}
                  to={toolPath(module, t)}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm transition-colors',
                    t.slug === tool?.slug
                      ? 'bg-primary text-on-primary font-semibold'
                      : 'text-ink-2 hover:bg-hover hover:text-ink',
                    // 尚未完成的頁面淡化（仍可點進去）；正在看的那頁不淡化
                    !t.ready && t.slug !== tool?.slug && 'opacity-50',
                  )}
                >
                  <t.icon className="size-4" aria-hidden />
                  {t.name}
                </NavLink>
              ))}
            </nav>
          ) : (
            <div className="flex items-center gap-2.5 pl-2">
              <module.icon className="text-primary size-5" aria-hidden />
              <span className="text-[15px] font-semibold">{module.name}</span>
            </div>
          )}
          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu />
        </header>
        <main className="bg-panel min-h-0 flex-1 overflow-hidden rounded-[var(--radius-panel)]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** 左側欄：標誌、模組導覽（兩組）、底部深綠服務狀態卡。收合時只留圖示，名稱以右側提示顯示。 */
function Sidebar({
  activeId,
  collapsed,
  onToggle,
}: {
  activeId: string
  collapsed: boolean
  onToggle: () => void
}) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <aside
      aria-label="模組"
      className={cn(
        'bg-panel flex shrink-0 flex-col rounded-[var(--radius-panel)] py-5 transition-[width]',
        collapsed ? 'w-[76px] items-center' : 'w-[232px]',
      )}
    >
      <div className={cn('flex items-center gap-2.5', collapsed ? 'flex-col' : 'px-5')}>
        <Link to="/" aria-label="開發工作台總覽" className="flex min-w-0 items-center gap-2.5">
          {/* 裝飾性標誌：alt="" 讓螢幕閱讀器略過，連結名稱由 aria-label 提供 */}
          <img src="/icon.svg" alt="" className="size-9 shrink-0" />
          {!collapsed && <span className="truncate text-[17px] font-bold">開發工作台</span>}
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? '展開側欄' : '收合側欄'}
          title={collapsed ? '展開側欄' : '收合側欄'}
          className={cn(
            'text-muted hover:text-ink hover:bg-hover focus-visible:ring-primary/40 grid size-8 shrink-0 place-items-center rounded-full focus-visible:ring-2 focus-visible:outline-none',
            !collapsed && 'ml-auto',
          )}
        >
          <ToggleIcon className="size-[18px]" aria-hidden />
        </button>
      </div>
      <nav aria-label="模組清單" className="mt-6 flex w-full flex-col gap-5 overflow-y-auto">
        <NavGroup
          title="研究模組"
          modules={[HOME, ...RESEARCH]}
          activeId={activeId}
          collapsed={collapsed}
        />
        <NavGroup title="其他" modules={OTHERS} activeId={activeId} collapsed={collapsed} />
      </nav>
      <div className="flex-1" />
      <ServiceStatus collapsed={collapsed} />
    </aside>
  )
}

/** 側欄的一組導覽：小標＋項目。選中的項目文字加粗、圖示為主色，左緣有主色指示條。 */
function NavGroup({
  title,
  modules,
  activeId,
  collapsed,
}: {
  title: string
  modules: Module[]
  activeId: string
  collapsed: boolean
}) {
  return (
    <div>
      {!collapsed && <div className="text-muted mb-1.5 px-6 text-xs">{title}</div>}
      <ul className="flex flex-col gap-0.5">
        {/* 總覽（HOME）的 id 為空字串，key 改用 'home' */}
        {modules.map((m) => {
          const active = m.id === activeId
          // 尚無工作台頁面的模組淡化（仍可點進去看說明）
          const planned = m.id !== '' && m.tools.length === 0
          const link = (
            <NavLink
              to={modulePath(m)}
              aria-label={m.name}
              className={cn(
                'relative flex h-10 items-center gap-3 text-sm transition-colors',
                collapsed ? 'mx-auto w-10 justify-center rounded-full' : 'px-6',
                // 左緣指示條：貼齊側欄左邊
                active &&
                  !collapsed &&
                  "before:bg-primary before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-r-full before:content-['']",
                active
                  ? cn('text-ink font-semibold', collapsed && 'bg-primary-soft')
                  : 'text-muted hover:text-ink',
                planned && !active && 'opacity-60',
              )}
            >
              <m.icon
                className={cn('size-[19px] shrink-0', active && 'text-primary')}
                aria-hidden
              />
              {!collapsed && <span className="truncate">{m.name}</span>}
            </NavLink>
          )
          return (
            <li key={m.id || 'home'}>
              {collapsed ? (
                <Hint text={m.id ? `${m.short}・${m.name}` : m.name} side="right">
                  {link}
                </Hint>
              ) : (
                link
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 服務狀態（側欄底部的深綠卡）：定期經 Go 向 Python 取設定結構，顯示整條鏈路是否正常；可手動重新檢查。 */
function ServiceStatus({ collapsed }: { collapsed: boolean }) {
  // 以取設定結構當作健康檢查：這支路由必須經過 Go 再呼叫 Python，成功即代表整條鏈路正常。
  // 每 15 秒重查；不重試，讓中斷狀態立即反映在畫面上。查詢結果只用來判斷成功與否（回傳時間戳）。
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/workbench/v1/dev/config-schemas', { signal })).then(() => Date.now()),
    refetchInterval: 15_000,
    retry: false,
  })
  const err = health.error
  // pending 只出現在第一次查詢完成前；之後即使重查中，也沿用上一次的成功／失敗狀態
  const state = health.isPending ? 'pending' : err ? 'down' : 'up'
  const label = state === 'up' ? '服務正常' : state === 'down' ? '服務中斷' : '連線中…'
  const detail =
    state === 'up'
      ? '瀏覽器 → Go → Python 都正常；本機開發模式，測試集已鎖定。'
      : state === 'down'
        ? `無法連線：${err instanceof ApiError ? errorText(err.code) : '請確認服務已啟動'}`
        : '連線中…'
  const dot = (
    <span
      className={cn(
        'size-2.5 shrink-0 rounded-full ring-2 ring-white/25',
        state === 'up' ? 'bg-ok-mark' : state === 'down' ? 'bg-danger-mark' : 'bg-white/50',
      )}
      aria-hidden
    />
  )
  // role="status"：狀態變化時螢幕閱讀器會朗讀；aria-label 用完整說明取代較短的可見文字。
  // 色點只是輔助（aria-hidden），狀態一定同時以文字呈現
  if (collapsed) {
    return (
      <Hint text={detail} side="right">
        <span
          role="status"
          aria-label={detail}
          className="deep-card mx-auto grid size-11 place-items-center rounded-2xl"
        >
          {dot}
        </span>
      </Hint>
    )
  }
  return (
    <div className="deep-card mx-3 rounded-[20px] p-4">
      <div role="status" aria-label={detail} className="flex items-center gap-2">
        {dot}
        <span className="text-[15px] font-semibold">{label}</span>
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/75">
        <ShieldCheck className="size-3.5" aria-hidden />
        測試集已鎖定
      </p>
      <button
        type="button"
        onClick={() => void health.refetch()}
        disabled={health.isFetching}
        className="bg-primary mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full text-xs font-medium text-white transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none disabled:opacity-60"
      >
        <RefreshCw className={cn('size-3.5', health.isFetching && 'animate-spin')} aria-hidden />
        重新檢查
      </button>
    </div>
  )
}

/** 目前登入者與登出；未登入時不顯示（開發工具頁不需要登入）。 */
function UserMenu() {
  const me = useMe()
  const logout = useLogout()
  // 查詢中或未登入時都沒有 data，一律不顯示
  if (!me.data) return null
  return (
    <div className="flex shrink-0 items-center gap-2.5 pl-1">
      <span className="bg-primary-soft text-primary-ink grid size-10 place-items-center rounded-full">
        <UserRound className="size-5" aria-hidden />
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold" title={me.data.username}>
          {me.data.display_name}
        </div>
        <div className="text-muted text-xs">{me.data.username}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <LogOut aria-hidden />
        登出
      </Button>
    </div>
  )
}

/** 深淺色切換：頂列的白色圓鈕，按一下切換；圖示顯示切換後的主題。 */
function ThemeToggle() {
  // 初始值讀 <html> 上的 dark class（index.html 的內嵌腳本在載入時已依 localStorage 套用），確保按鈕狀態與實際主題一致
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  // 切換主題：改 <html> 的 class（index.css 的主題變數據此切換）並記住選擇，下次開啟沿用
  const set = (next: boolean) => {
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('wb.theme', next ? 'dark' : 'light')
    } catch {
      // 無法儲存時只影響這次瀏覽
    }
    setDark(next)
  }
  const label = dark ? '切換為淺色' : '切換為深色'
  const Icon = dark ? Sun : Moon
  return (
    <Hint text={label} side="bottom">
      <button
        type="button"
        onClick={() => set(!dark)}
        aria-label={label}
        className="bg-card text-ink-2 hover:text-ink focus-visible:ring-primary/40 grid size-10 place-items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Icon className="size-[18px]" aria-hidden />
      </button>
    </Hint>
  )
}
