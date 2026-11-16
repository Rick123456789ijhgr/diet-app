// 外框（光學儀器）：左側窄圖示欄（標誌、模組、深淺色切換）＋頂列（模組名稱｜頁面分頁、服務狀態、登入者）＋內容區。
// 欄與列以髮絲線分隔、貼齊邊緣，不用浮動卡片。
import { useQuery } from '@tanstack/react-query'
import { LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

import { api, ApiError, unwrap } from '@/api/client'
import { Button, Hint } from '@/components/ui/primitives'
import { useLogout, useMe } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'
import { errorText } from '@/lib/text'
import { HOME, locate, MODULES, modulePath, toolPath } from '@/nav'

/**
 * 整個工作台的外框（路由的版面元件）：子路由頁面經 <Outlet /> 渲染在 <main> 內。
 * 目前的模組與工具頁由網址推得（locate），用來標示側欄與頂列分頁的選中狀態。
 */
export function AppShell() {
  const { module, tool } = locate(useLocation().pathname)
  return (
    <div className="bg-canvas flex h-full">
      <Rail activeId={module.id} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card border-card-border flex h-12 shrink-0 items-stretch gap-4 border-b pr-3 pl-4">
          <div className="flex shrink-0 items-center gap-2">
            <module.icon className="text-primary size-4" aria-hidden />
            <span className="text-sm font-semibold">{module.name}</span>
          </div>
          {/* 目前模組的頁面分頁（選中為主色底線）；沒有工具頁的模組（例如總覽）不顯示。頁面多時可橫向捲動 */}
          {module.tools.length > 0 && (
            <nav
              aria-label="頁面"
              className="border-card-border my-3 flex min-w-0 items-stretch gap-1 overflow-x-auto border-l pl-3"
            >
              {module.tools.map((t) => (
                <NavLink
                  key={t.slug}
                  to={toolPath(module, t)}
                  className={cn(
                    'relative -my-3 inline-flex shrink-0 items-center gap-1.5 px-2.5 text-sm transition-colors',
                    "after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:content-['']",
                    t.slug === tool?.slug
                      ? 'text-ink after:bg-primary font-medium'
                      : 'text-muted hover:text-ink',
                    // 尚未完成的頁面淡化（仍可點進去）；正在看的那頁不淡化
                    !t.ready && t.slug !== tool?.slug && 'opacity-50',
                  )}
                >
                  <t.icon className="size-4" aria-hidden />
                  {t.name}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="flex-1" />
          <ServiceStatus />
          <UserMenu />
        </header>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** 左側窄圖示欄：標誌（回總覽）、各模組（選中為主色淡底＋左緣亮條）、底部深淺色切換。名稱以右側提示顯示。 */
function Rail({ activeId }: { activeId: string }) {
  return (
    <aside
      aria-label="模組"
      className="bg-card border-card-border flex w-14 shrink-0 flex-col items-center border-r py-2"
    >
      <Link to="/" aria-label="開發工作台總覽" className="mb-2 grid h-10 w-full place-items-center">
        {/* 裝飾性標誌：alt="" 讓螢幕閱讀器略過，連結名稱由 aria-label 提供 */}
        <img src="/icon.svg" alt="" className="size-7" />
      </Link>
      <nav aria-label="模組清單" className="flex w-full flex-col items-center gap-1">
        {/* 總覽（HOME）的 id 為空字串，key 改用 'home'；只有圖示，名稱以 aria-label 與右側提示提供 */}
        {[HOME, ...MODULES].map((m) => {
          const active = m.id === activeId
          // 尚無工作台頁面的模組淡化（仍可點進去看說明）
          const planned = m.id !== '' && m.tools.length === 0
          return (
            <Hint key={m.id || 'home'} text={m.id ? `${m.short}・${m.name}` : m.name} side="right">
              <NavLink
                to={modulePath(m)}
                aria-label={m.name}
                className={cn(
                  'relative grid size-9 place-items-center rounded-md transition-colors',
                  // 左緣亮條：貼齊側欄左邊
                  active &&
                    "bg-primary-soft text-primary before:bg-primary before:absolute before:inset-y-2 before:-left-2.5 before:w-0.5 before:rounded-r before:content-['']",
                  !active && 'text-muted hover:bg-hover hover:text-ink',
                  planned && !active && 'opacity-55',
                )}
              >
                <m.icon className="size-[18px]" aria-hidden />
              </NavLink>
            </Hint>
          )
        })}
      </nav>
      <div className="flex-1" />
      <ThemeToggle />
    </aside>
  )
}

/** 服務狀態：定期經 Go 向 Python 取設定結構，顯示整條鏈路是否正常。 */
function ServiceStatus() {
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
  const detail =
    state === 'up'
      ? '瀏覽器 → Go → Python 都正常；本機開發模式，測試集已鎖定。'
      : state === 'down'
        ? `無法連線：${err instanceof ApiError ? errorText(err.code) : '請確認服務已啟動'}`
        : '連線中…'
  return (
    <Hint text={detail} side="bottom">
      {/* role="status"：狀態變化時螢幕閱讀器會朗讀；aria-label 用完整說明取代較短的可見文字。
          色點只是輔助（aria-hidden），狀態一定同時以文字呈現 */}
      <span
        role="status"
        aria-label={detail}
        className="text-ink-2 flex shrink-0 items-center gap-2 px-1 text-xs"
      >
        <span
          className={cn(
            'size-2 rounded-full',
            state === 'up'
              ? 'bg-ok-mark shadow-[0_0_0_3px_var(--ok-soft)]'
              : state === 'down'
                ? 'bg-danger-mark shadow-[0_0_0_3px_var(--danger-soft)]'
                : 'bg-line-strong',
          )}
          aria-hidden
        />
        {state === 'up' ? '服務正常' : state === 'down' ? '服務中斷' : '連線中…'}
      </span>
    </Hint>
  )
}

/** 目前登入者與登出；未登入時不顯示（開發工具頁不需要登入）。 */
function UserMenu() {
  const me = useMe()
  const logout = useLogout()
  // 查詢中或未登入時都沒有 data，一律不顯示
  if (!me.data) return null
  return (
    <div className="border-card-border my-2.5 flex shrink-0 items-center gap-2 border-l pl-3 text-sm">
      <UserRound className="text-muted size-4" aria-hidden />
      <span title={me.data.username}>{me.data.display_name}</span>
      <Button size="sm" variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <LogOut aria-hidden />
        登出
      </Button>
    </div>
  )
}

/** 深淺色切換：側欄底部一顆按鈕，按一下切換；圖示顯示切換後的主題。 */
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
    <Hint text={label} side="right">
      <button
        type="button"
        onClick={() => set(!dark)}
        aria-label={label}
        className="text-muted hover:bg-hover hover:text-ink focus-visible:ring-primary/40 grid size-9 place-items-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Icon className="size-[18px]" aria-hidden />
      </button>
    </Hint>
  )
}
