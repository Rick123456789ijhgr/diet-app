// 專案架構・架構圖（檢視）：只顯示成品，點有細部圖的元件逐層進入（類似 C4 Model）。
// 「編輯」在新分頁開啟編輯器（/arch/edit）；編輯器存檔時這裡經 storage 事件即時更新。
import { ChevronRight, Network, SquarePen } from 'lucide-react'
import { useSearchParams } from 'react-router'

import { EmptyState, PageHeader } from '@/components/layout/Workspace'
import { Badge } from '@/components/ui/primitives'
import { type ArchDoc, pathTo } from '@/lib/arch/model'
import { ARCH } from '@/lib/arch/theme'
import { cn } from '@/lib/cn'

import { DrillIcon, StaticDiagram } from './DiagramSvg'
import { useStoredDoc } from './useArchDoc'

/** 編輯器的網址（新分頁開啟）；帶目前的圖，打開就在同一層。 */
export function editorUrl(doc: ArchDoc, diagramId: string): string {
  return diagramId === doc.root ? '/arch/edit' : `/arch/edit?d=${encodeURIComponent(diagramId)}`
}

/** 層級路徑（檢視頁與編輯器共用）：最後一層為目前的圖，其餘可點回去。 */
export function Breadcrumb({
  doc,
  diagramId,
  onGo,
  className,
}: {
  doc: ArchDoc
  diagramId: string
  onGo: (id: string) => void
  className?: string
}) {
  const trail = pathTo(doc, diagramId)
  const level = trail.at(-1)?.diagram.level
  return (
    <nav aria-label="層級" className={cn('flex min-w-0 items-center gap-1 text-[13px]', className)}>
      {trail.map(({ diagram: d }, i) => {
        const last = i === trail.length - 1
        return (
          <span key={d.id} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="text-muted size-3.5 shrink-0" aria-hidden />}
            {last ? (
              <span aria-current="page" className="truncate font-semibold">
                {d.title || '未命名'}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onGo(d.id)}
                className="text-ink-2 hover:text-ink truncate rounded px-1 hover:underline"
              >
                {d.title || '未命名'}
              </button>
            )}
          </span>
        )
      })}
      {level && <Badge className="ml-2">{level}</Badge>}
    </nav>
  )
}

export function ArchPage() {
  const doc = useStoredDoc()
  const [params, setParams] = useSearchParams()
  const diagram = doc.diagrams[params.get('d') ?? ''] ?? doc.diagrams[doc.root]! // 最上層一定存在
  const go = (id: string) => setParams(id === doc.root ? {} : { d: id })
  const drill = (child?: string) => child && doc.diagrams[child] && go(child)

  return (
    <div className="flex h-full min-h-0 flex-col pr-3 pb-3">
      <PageHeader
        title="架構圖"
        description="逐層放大的專案架構（類似 C4 Model）：點有疊層圖示的元件看內部組成與流程；滑過元件看說明。"
        aside={
          <a
            href={editorUrl(doc, diagram.id)}
            target="_blank"
            rel="noopener"
            className="bg-ink text-on-ink focus-visible:ring-primary/40 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium hover:opacity-85 focus-visible:ring-2 focus-visible:outline-none"
          >
            <SquarePen className="size-4" aria-hidden />
            編輯
          </a>
        }
      />
      <div className="bg-card shadow-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px]">
        <div className="flex shrink-0 items-center px-4 pt-4 pb-3">
          <Breadcrumb doc={doc} diagramId={diagram.id} onGo={go} />
        </div>
        <div
          className="mx-3 mb-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl"
          style={{ background: ARCH.canvas }}
        >
          {diagram.nodes.length === 0 ? (
            <EmptyState icon={<Network className="size-8" aria-hidden />}>
              這張圖還沒有元件，按「編輯」開始畫。
            </EmptyState>
          ) : (
            <StaticDiagram
              key={diagram.id}
              diagram={diagram}
              idPrefix="view"
              labelBg={ARCH.canvas}
              role="group"
              aria-label={`${diagram.title} 架構圖`}
              className="block h-full max-h-full w-full max-w-full"
              preserveAspectRatio="xMidYMid meet"
              nodeProps={(n) => ({
                role: 'button',
                tabIndex: 0,
                'aria-label': n.title || '未命名元件',
                'aria-description': n.note || undefined,
                'data-node': n.id,
                style: { cursor: n.child ? 'zoom-in' : 'default', outline: 'none' },
                onClick: () => drill(n.child),
                onKeyDown: (e) => {
                  if (e.key === 'Enter' && n.child) {
                    e.preventDefault()
                    drill(n.child)
                  }
                },
              })}
              nodeChildren={(n) => (
                <>
                  {n.note && <title>{n.note}</title>}
                  {n.child && <DrillIcon node={n} />}
                </>
              )}
            />
          )}
        </div>
      </div>
    </div>
  )
}
