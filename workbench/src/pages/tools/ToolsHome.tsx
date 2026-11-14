// 通用工具（/tools）：不屬於特定研究模組的工具，以按鈕列出，點了進入各工具的專屬頁面。
// 按鈕取自 nav.ts 的 tools 模組，新增工具時只要在那裡登記並在 App.tsx 註冊路由。
import { ArrowRight, Wrench } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState, PageHeader } from '@/components/layout/Workspace'
import { MODULES, toolPath } from '@/nav'

export function ToolsHome() {
  const module = MODULES.find((m) => m.id === 'tools')!
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto pr-3 pb-3">
      <PageHeader title={module.name} description={module.description} />
      {module.tools.length === 0 ? (
        <EmptyState icon={<Wrench className="size-8" aria-hidden />}>尚無工具。</EmptyState>
      ) : (
        <nav aria-label="通用工具" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {module.tools.map((t) => (
            <Link
              key={t.slug}
              to={toolPath(module, t)}
              className="bg-card shadow-card group hover:bg-hover focus-visible:ring-primary/40 flex items-start gap-4 rounded-[20px] p-5 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-sunken group-hover:bg-card grid size-11 shrink-0 place-items-center rounded-full">
                <t.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                  {t.name}
                  <ArrowRight
                    className="text-muted size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
                <span className="text-muted mt-1 block text-xs leading-relaxed">
                  {t.description}
                </span>
              </span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
