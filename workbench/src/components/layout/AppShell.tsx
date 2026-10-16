// 外框（柔和卡片風）：左側浮動圖示欄（深淺色切換＋模組）、頂部列（標誌、頁面膠囊、服務狀態、登入者）、內容區。
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

export const TOPBAR_HEIGHT = 64

export function AppShell() {
  const { module, tool } = locate(useLocation().pathname)
  return (
    <div className="flex h-full">
      <Rail activeId={module.id} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 pr-3" style={{ height: TOPBAR_HEIGHT }}>
          <Link
            to="/"
            className="bg-card shadow-card flex h-11 shrink-0 items-center gap-2 rounded-full pr-4 pl-1.5"
            aria-label="開發工作台總覽"
          >
            <img src="/icon.svg" alt="" className="size-8" />
            <span className="text-[14px] font-semibold tracking-tight">開發工作台</span>
          </Link>
          <div className="flex min-w-0 flex-1 justify-center">
            {module.tools.length > 0 && (
              <nav
                aria-label="頁面"
                className="bg-card shadow-card flex min-w-0 gap-0.5 overflow-x-auto rounded-full p-1"
              >
                {module.tools.map((t) => (
                  <NavLink
                    key={t.slug}
                    to={toolPath(module, t)}
                    className={cn(
                      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors',
                      t.slug === tool?.slug
                        ? 'bg-ink text-on-ink font-medium'
                        : 'text-ink-2 hover:bg-hover hover:text-ink',
                      !t.ready && t.slug !== tool?.slug && 'opacity-50',
                    )}
                  >
                    <t.icon className="size-3.5" aria-hidden />
                    {t.name}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>
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

/** 左側浮動圖示欄：深淺色切換、各模組（選中為黑色圓）。 */
function Rail({ activeId }: { activeId: string }) {
  return (
    <aside aria-label="模組" className="flex w-[76px] shrink-0 flex-col items-center gap-3 py-3">
      <ThemeToggle />
      <nav
        aria-label="模組清單"
        className="bg-card shadow-card mt-6 flex flex-col items-center gap-1 rounded-full p-1.5"
      >
        {[HOME, ...MODULES].map((m) => (
          <Hint key={m.id || 'home'} text={m.id ? `${m.short}・${m.name}` : m.name} side="right">
            <NavLink
              to={modulePath(m)}
              aria-label={m.name}
              className={cn(
                'flex size-10 items-center justify-center rounded-full transition-colors',
                m.id === activeId
                  ? 'bg-ink text-on-ink'
                  : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
            >
              <m.icon className="size-[18px]" aria-hidden />
            </NavLink>
          </Hint>
        ))}
      </nav>
    </aside>
  )
}

/** 服務狀態：定期經 Go 向 Python 取設定結構，顯示整條鏈路是否正常。 */
function ServiceStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/workbench/v1/dev/config-schemas', { signal })).then(() => Date.now()),
    refetchInterval: 15_000,
    retry: false,
  })
  const err = health.error
  const state = health.isPending ? 'pending' : err ? 'down' : 'up'
  const detail =
    state === 'up'
      ? '瀏覽器 → Go → Python 都正常；本機開發模式，測試集已鎖定。'
      : state === 'down'
        ? `無法連線：${err instanceof ApiError ? errorText(err.code) : '請確認服務已啟動'}`
        : '連線中…'
  return (
    <Hint text={detail} side="bottom">
      <span
        role="status"
        aria-label={detail}
        className="bg-card shadow-card text-ink-2 flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-xs"
      >
        <span
          className={cn(
            'size-2 rounded-full',
            state === 'up' ? 'bg-ok-mark' : state === 'down' ? 'bg-danger-mark' : 'bg-line-strong',
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
  if (!me.data) return null
  return (
    <div className="bg-card shadow-card flex h-11 shrink-0 items-center gap-2 rounded-full pr-1.5 pl-4 text-[13px]">
      <UserRound className="text-muted size-4" aria-hidden />
      <span title={me.data.username}>{me.data.display_name}</span>
      <Button size="sm" variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <LogOut className="size-3.5" aria-hidden />
        登出
      </Button>
    </div>
  )
}

/** 深淺色切換：上下兩顆圓鈕，選中的一顆加底色。 */
function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const set = (next: boolean) => {
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('wb.theme', next ? 'dark' : 'light')
    } catch {
      // 無法儲存時只影響這次瀏覽
    }
    setDark(next)
  }
  return (
    <div className="bg-card shadow-card flex flex-col gap-1 rounded-full p-1.5">
      {(
        [
          [false, Sun, '切換為淺色'],
          [true, Moon, '切換為深色'],
        ] as const
      ).map(([value, Icon, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => set(value)}
          aria-label={label}
          aria-pressed={dark === value}
          className={cn(
            'flex size-10 items-center justify-center rounded-full transition-colors',
            dark === value ? 'bg-sunken text-ink' : 'text-muted hover:text-ink',
          )}
        >
          <Icon className="size-[18px]" />
        </button>
      ))}
    </div>
  )
}
