// 總覽：各模組與其工具的完成進度（儀器面板式的索引）。
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { MODULES, modulePath, toolPath } from '@/nav'

export function HomePage() {
  const tools = MODULES.flatMap((m) => m.tools)
  const ready = tools.filter((t) => t.ready).length
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-card-border bg-card border-b px-6 py-5">
        <h1 className="text-lg font-semibold tracking-tight">開發工作台</h1>
        <p className="text-muted mt-1 text-[13px]">
          以合成影像或開發照片測試各模組、調整參數。開發工具只在本機開發模式啟用；不得讀取測試集。
        </p>
        <dl className="mt-4 flex gap-8">
          {[
            ['模組', String(MODULES.length)],
            ['可用工具', `${ready}／${tools.length}`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted text-[11px]">{k}</dt>
              <dd className="readout text-xl font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="grid gap-px p-6 lg:grid-cols-2 2xl:grid-cols-3">
        {MODULES.map((m) => (
          <section
            key={m.id}
            className={cn(
              'border-card-border bg-card -mt-px -ml-px flex flex-col border',
              // 有工具的模組佔滿整列，避免旁邊留下大片空白
              m.tools.length > 0 && 'lg:col-span-2 2xl:col-span-3',
            )}
          >
            <Link
              to={modulePath(m)}
              className="group hover:bg-hover flex items-start gap-3 px-4 py-3"
            >
              <m.icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold group-hover:underline">{m.name}</span>
                  <span className="text-muted text-[11px]">{m.short}</span>
                </div>
                <p className="text-muted mt-0.5 text-xs">{m.description}</p>
              </div>
            </Link>
            {m.tools.length > 0 ? (
              <ul className="border-card-border border-t">
                {m.tools.map((t) => (
                  <li key={t.slug} className="border-card-border border-b last:border-b-0">
                    <Link
                      to={toolPath(m, t)}
                      className="group hover:bg-hover flex items-center gap-2.5 px-4 py-1.5 text-[13px]"
                    >
                      <t.icon className="text-muted size-3.5" aria-hidden />
                      <span className="w-24 shrink-0">{t.name}</span>
                      <span className="text-muted min-w-0 flex-1 truncate text-xs">
                        {t.description}
                      </span>
                      {t.ready ? <Badge tone="ok">可用</Badge> : <Badge>階段 {t.stage}</Badge>}
                      <ArrowRight
                        className="text-muted size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted border-card-border border-t px-4 py-2 text-xs">尚無工具</p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
