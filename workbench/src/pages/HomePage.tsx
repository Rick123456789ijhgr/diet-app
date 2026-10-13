import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'

import { Badge, Card } from '@/components/ui/primitives'
import { MODULES, modulePath, toolPath } from '@/nav'

export function HomePage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">開發工作台</h1>
      <p className="text-muted mt-1 text-sm">
        以合成影像或開發照片測試各模組、調整參數。開發工具只在本機開發模式啟用；不得讀取測試集。
      </p>
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {MODULES.map((m) => (
          <Card key={m.id} className="p-4">
            <Link to={modulePath(m)} className="group flex items-start gap-3">
              <m.icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-muted text-xs">{m.short}</div>
                <div className="font-semibold group-hover:underline">{m.name}</div>
                <p className="text-muted mt-1 text-sm">{m.description}</p>
              </div>
            </Link>
            {m.tools.length > 0 && (
              <ul className="border-card-border mt-3 border-t pt-2">
                {m.tools.map((t) => (
                  <li key={t.slug}>
                    <Link
                      to={toolPath(m, t)}
                      className="hover:bg-hover flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                    >
                      <t.icon className="text-muted size-4" aria-hidden />
                      <span className="flex-1">{t.name}</span>
                      {t.ready ? <Badge tone="primary">可用</Badge> : <Badge>階段 {t.stage}</Badge>}
                      <ChevronRight className="text-muted size-4" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
