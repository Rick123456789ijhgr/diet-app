// 外框：左側直欄（模組）＋頂部列（模組名稱與頁面膠囊）＋內容區。
import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'

import { cn } from '@/lib/cn'
import { HOME, locate, MODULES, modulePath, toolPath } from '@/nav'

export const TOPBAR_HEIGHT = 56

export function AppShell() {
  const { module, tool } = locate(useLocation().pathname)
  return (
    <div className="flex h-full">
      <Rail activeId={module.id} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="border-card-border bg-card/80 flex shrink-0 items-center gap-4 border-b px-5 backdrop-blur"
          style={{ height: TOPBAR_HEIGHT }}
        >
          <div className="min-w-0">
            <div className="text-muted text-xs">{module.id ? module.short : '開發工作台'}</div>
            <div className="truncate text-sm font-semibold">{module.name}</div>
          </div>
          {module.tools.length > 0 && (
            <nav aria-label="頁面" className="flex min-w-0 gap-1 overflow-x-auto">
              {module.tools.map((t) => (
                <NavLink
                  key={t.slug}
                  to={toolPath(module, t)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
                    t.slug === tool?.slug
                      ? 'bg-primary text-white'
                      : 'text-muted hover:bg-hover hover:text-ink',
                    !t.ready && t.slug !== tool?.slug && 'opacity-60',
                  )}
                >
                  <t.icon className="size-4" aria-hidden />
                  {t.name}
                </NavLink>
              ))}
            </nav>
          )}
        </header>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Rail({ activeId }: { activeId: string }) {
  return (
    <aside
      aria-label="模組"
      className="border-card-border bg-card flex w-[84px] shrink-0 flex-col items-center gap-1 border-r py-3"
    >
      <img src="/icon.svg" alt="" className="mb-2 size-9" />
      {[HOME, ...MODULES].map((m) => (
        <NavLink
          key={m.id || 'home'}
          to={modulePath(m)}
          title={m.name}
          className={cn(
            'flex w-[68px] flex-col items-center gap-1 rounded-xl py-2 text-[11px] transition-colors',
            m.id === activeId
              ? 'bg-primary-soft text-primary font-semibold'
              : 'text-muted hover:bg-hover hover:text-ink',
          )}
        >
          <m.icon className="size-5" aria-hidden />
          {m.short}
        </NavLink>
      ))}
      <div className="flex-1" />
      <ThemeToggle />
    </aside>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('wb.theme', next ? 'dark' : 'light')
    } catch {
      // 無法儲存時只影響這次瀏覽
    }
    setDark(next)
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? '切換為淺色' : '切換為深色'}
      className="text-muted hover:bg-hover hover:text-ink rounded-lg p-2"
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}
