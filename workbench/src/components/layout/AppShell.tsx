// 外框：頂部列（模組切換＋頁面分頁）＋內容區＋底部狀態列（服務連線）。
import { useQuery } from '@tanstack/react-query'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

import { api, ApiError, unwrap } from '@/api/client'
import { cn } from '@/lib/cn'
import { errorText } from '@/lib/text'
import { HOME, locate, MODULES, modulePath, toolPath, type Module } from '@/nav'

export const TOPBAR_HEIGHT = 44

export function AppShell() {
  const { module, tool } = locate(useLocation().pathname)
  return (
    <div className="flex h-full flex-col">
      <header
        className="border-card-border bg-card flex shrink-0 items-stretch border-b"
        style={{ height: TOPBAR_HEIGHT }}
      >
        <Link
          to="/"
          className="border-card-border hover:bg-hover flex items-center gap-2 border-r px-3"
          aria-label="開發工作台總覽"
        >
          <img src="/icon.svg" alt="" className="size-5" />
          <span className="text-[13px] font-semibold tracking-tight">開發工作台</span>
        </Link>
        <ModuleSwitcher active={module} />
        {module.tools.length > 0 && (
          <nav aria-label="頁面" className="flex min-w-0 items-stretch overflow-x-auto px-1">
            {module.tools.map((t) => (
              <NavLink
                key={t.slug}
                to={toolPath(module, t)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 pt-0.5 text-[13px] transition-colors',
                  t.slug === tool?.slug
                    ? 'border-primary text-ink font-medium'
                    : 'text-muted hover:text-ink border-transparent',
                  !t.ready && t.slug !== tool?.slug && 'opacity-50',
                )}
              >
                <t.icon className="size-3.5" aria-hidden />
                {t.name}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="flex-1" />
        <ThemeToggle />
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  )
}

/** 模組切換：下拉選單列出所有模組（含尚無工具的模組）。 */
function ModuleSwitcher({ active }: { active: Module }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="border-card-border hover:bg-hover data-[state=open]:bg-hover flex items-center gap-2 border-r px-3 text-left focus-visible:outline-none"
        aria-label="切換模組"
      >
        <active.icon className="text-primary size-4" aria-hidden />
        <span className="leading-tight">
          <span className="text-muted block text-[10px]">{active.id ? active.short : '模組'}</span>
          <span className="block text-[13px] font-medium">{active.name}</span>
        </span>
        <ChevronDown className="text-muted size-3.5" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={0}
          className="border-line-strong bg-card z-50 w-80 rounded-b-[4px] border py-1 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)]"
        >
          {[HOME, ...MODULES].map((m) => (
            <DropdownMenu.Item key={m.id || 'home'} asChild>
              <Link
                to={modulePath(m)}
                className="data-[highlighted]:bg-hover flex items-start gap-2.5 px-3 py-2 outline-none"
              >
                <m.icon className="text-muted mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium">{m.name}</span>
                    {m.id && <span className="text-muted text-[11px]">{m.short}</span>}
                  </span>
                  <span className="text-muted block truncate text-[11px]">
                    {m.tools.length > 0
                      ? `${m.tools.filter((t) => t.ready).length}／${m.tools.length} 個工具可用`
                      : m.id
                        ? '尚無工具'
                        : m.description}
                  </span>
                </span>
                {m.id === active.id && <Check className="text-primary size-4" aria-hidden />}
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** 底部狀態列：定期經 Go 向 Python 取設定結構，顯示整條鏈路是否正常。 */
function StatusBar() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/workbench/v1/dev/config-schemas', { signal })).then(() => Date.now()),
    refetchInterval: 15_000,
    retry: false,
  })
  const err = health.error
  const state = health.isPending ? 'pending' : err ? 'down' : 'up'
  return (
    <footer
      className="border-card-border bg-card text-muted flex h-6 shrink-0 items-center gap-4 border-t px-3 text-[11px]"
      aria-label="狀態列"
    >
      <span className="inline-flex items-center gap-1.5" role="status">
        <span
          className={cn(
            'size-1.5 rounded-full',
            state === 'up' ? 'bg-ok-mark' : state === 'down' ? 'bg-danger-mark' : 'bg-line-strong',
          )}
          aria-hidden
        />
        {state === 'up'
          ? '服務正常（瀏覽器 → Go → Python）'
          : state === 'down'
            ? `無法連線：${err instanceof ApiError ? errorText(err.code) : '請確認服務已啟動'}`
            : '連線中…'}
      </span>
      <span className="flex-1" />
      <span>本機開發模式 · 測試集已鎖定</span>
    </footer>
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
      className="border-card-border text-muted hover:bg-hover hover:text-ink border-l px-3"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}
