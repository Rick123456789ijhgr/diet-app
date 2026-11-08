// 架構圖右側的檢視器：點選元件看說明與細部圖；編輯模式可改文字、尺寸、連線路線。
import { ArrowLeftRight, CornerDownRight, Layers, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { ReadoutBlock } from '@/components/layout/Workspace'
import { Badge, Button, DraftNumberInput, Segmented } from '@/components/ui/primitives'
import {
  type ArchEdge,
  type ArchNode,
  type Diagram,
  type EdgeEnd,
  type Op,
  type Route,
  SIZE_LIMITS,
} from '@/lib/arch/model'
import { cn } from '@/lib/cn'

const INPUT =
  'bg-sunken h-8 w-full rounded-lg border border-transparent px-2.5 text-[13px] focus-visible:border-primary focus-visible:bg-card focus-visible:outline-none disabled:opacity-60'

/** 有標籤的文字欄位；聚焦時記一步復原，打字時不逐字記錄。 */
export function TextField({
  label,
  value,
  onChange,
  onFocus,
  disabled,
  multiline,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onFocus: () => void
  disabled?: boolean
  multiline?: boolean
  placeholder?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-muted text-xs">{label}</span>
      {multiline ? (
        <textarea
          className={cn(INPUT, 'h-24 resize-y py-1.5 leading-relaxed')}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={INPUT}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

function SizeField({
  label,
  value,
  onCommit,
  onFocus,
  max,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  onFocus: () => void
  max: number
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <DraftNumberInput
        aria-label={label}
        value={value}
        min={SIZE_LIMITS.min}
        max={max}
        step={10}
        onFocus={onFocus}
        parse={(t) => {
          const v = Number(t)
          return v >= SIZE_LIMITS.min && v <= max ? Math.round(v) : undefined
        }}
        onCommit={onCommit}
      />
    </label>
  )
}

interface Props {
  diagram: Diagram
  editable: boolean
  apply: (op: Op, record?: boolean) => void
  checkpoint: () => void
  onDrill: (node: string) => void
  onCreateChild: (node: string) => void
  onDeleteNode: (node: string) => void
  onDeleteEdge: (edge: string) => void
}

export function NodeInspector({ node: n, ...p }: Props & { node: ArchNode }) {
  const update = (patch: Partial<ArchNode>) =>
    p.apply({ type: 'updateNode', diagram: p.diagram.id, node: n.id, patch }, false)
  const drill = n.child ? (
    <Button variant="primary" onClick={() => p.onDrill(n.id)} className="w-full">
      <Layers className="size-4" aria-hidden />
      進入細部圖
    </Button>
  ) : p.editable ? (
    <Button onClick={() => p.onCreateChild(n.id)} className="w-full">
      <Layers className="size-4" aria-hidden />
      建立細部圖
    </Button>
  ) : null

  if (!p.editable) {
    return (
      <ReadoutBlock
        title="元件"
        aside={n.child ? <Badge tone="primary">有細部圖</Badge> : undefined}
      >
        <div className="space-y-3">
          <div>
            {n.kicker && <div className="text-muted text-[11px] tracking-[0.2em]">{n.kicker}</div>}
            <div className="text-[17px] font-semibold">{n.title || '未命名元件'}</div>
            {n.accent && (
              <div className="text-ink-2 mt-1 text-xs">
                <CornerDownRight className="mr-1 inline size-3.5" aria-hidden />
                {n.accent}
              </div>
            )}
          </div>
          <p className="text-ink-2 text-[13px] leading-relaxed whitespace-pre-wrap">
            {n.note || '（沒有說明）'}
          </p>
          {drill}
        </div>
      </ReadoutBlock>
    )
  }

  return (
    <ReadoutBlock title="元件">
      <div className="space-y-3">
        <TextField
          label="小標"
          value={n.kicker}
          placeholder="例如 01、INPUT"
          onFocus={p.checkpoint}
          onChange={(v) => update({ kicker: v })}
        />
        <TextField
          label="標題"
          value={n.title}
          onFocus={p.checkpoint}
          onChange={(v) => update({ title: v })}
        />
        <TextField
          label="強調塊"
          value={n.accent}
          placeholder="空白表示不顯示"
          onFocus={p.checkpoint}
          onChange={(v) => update({ accent: v })}
        />
        <TextField
          label="說明"
          multiline
          value={n.note}
          placeholder="這個元件做什麼、怎麼運作"
          onFocus={p.checkpoint}
          onChange={(v) => update({ note: v })}
        />
        <div className="space-y-1.5">
          <SizeField
            label="寬度"
            value={n.w}
            max={SIZE_LIMITS.maxW}
            onFocus={p.checkpoint}
            onCommit={(w) => update({ w })}
          />
          <SizeField
            label="高度"
            value={n.h}
            max={SIZE_LIMITS.maxH}
            onFocus={p.checkpoint}
            onCommit={(h) => update({ h })}
          />
          {n.accent && (
            <SizeField
              label="強調塊寬度"
              value={n.accentW}
              max={SIZE_LIMITS.maxW}
              onFocus={p.checkpoint}
              onCommit={(accentW) => update({ accentW })}
            />
          )}
        </div>
        {drill}
        <Button variant="ghost" onClick={() => p.onDeleteNode(n.id)} className="text-danger w-full">
          <Trash2 className="size-4" aria-hidden />
          刪除元件{n.child ? '（含細部圖）' : ''}
        </Button>
      </div>
    </ReadoutBlock>
  )
}

const ROUTES: { value: Route; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'hv', label: '先水平' },
  { value: 'vh', label: '先垂直' },
]

export function EdgeInspector({ edge: e, ...p }: Props & { edge: ArchEdge }) {
  const name = (end: EdgeEnd) => {
    const n = p.diagram.nodes.find((x) => x.id === end.node)
    if (!n) return '？'
    return end.part === 'accent' && n.accent ? `${n.title}・${n.accent}` : n.title
  }
  const update = (patch: Partial<ArchEdge>, record = true) =>
    p.apply({ type: 'updateEdge', diagram: p.diagram.id, edge: e.id, patch }, record)

  return (
    <ReadoutBlock title="連線">
      <div className="space-y-3">
        <div className="text-[13px]">
          <span className="font-medium">{name(e.from)}</span>
          <span className="text-muted mx-1.5">→</span>
          <span className="font-medium">{name(e.to)}</span>
        </div>
        {p.editable ? (
          <>
            <TextField
              label="標籤"
              value={e.label}
              placeholder="例如 gRPC、REST"
              onFocus={p.checkpoint}
              onChange={(v) => update({ label: v }, false)}
            />
            <div className="space-y-1">
              <span className="text-muted text-xs">路線</span>
              <Segmented
                label="路線"
                value={e.route}
                onChange={(route) => update({ route })}
                options={ROUTES}
                className="flex w-full"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => update({ from: e.to, to: e.from })}>
                <ArrowLeftRight className="size-4" aria-hidden />
                反轉方向
              </Button>
              <Button
                variant="ghost"
                className="text-danger flex-1"
                onClick={() => p.onDeleteEdge(e.id)}
              >
                <Trash2 className="size-4" aria-hidden />
                刪除連線
              </Button>
            </div>
          </>
        ) : (
          e.label && <p className="text-ink-2 text-[13px]">標籤：{e.label}</p>
        )}
      </div>
    </ReadoutBlock>
  )
}

/** 沒有選取時：這張圖的概要與操作說明。 */
export function DiagramSummary({ diagram, editable }: { diagram: Diagram; editable: boolean }) {
  const drillable = diagram.nodes.filter((n) => n.child).length
  return (
    <ReadoutBlock title="這張圖" aside={diagram.level ? <Badge>{diagram.level}</Badge> : undefined}>
      <div className="space-y-3 text-[13px]">
        <div className="text-ink-2">
          {diagram.nodes.length} 個元件、{diagram.edges.length} 條連線
          {drillable > 0 && `，其中 ${drillable} 個有細部圖`}。
        </div>
        <ul className="text-muted list-disc space-y-1 pl-4 text-xs leading-relaxed">
          <Tip>點一下元件看說明；點兩下（或右上角疊層圖示）進入細部圖。</Tip>
          <Tip>上方的層級路徑可以回到上一層；Esc 也會回到上一層。</Tip>
          {editable ? (
            <>
              <Tip>拖曳元件移動位置（對齊 10 px 格線）。</Tip>
              <Tip>選取或滑過元件會出現藍色圓點，拖到另一個元件即可連線。</Tip>
              <Tip>Delete 刪除選取的元件或連線；Ctrl+Z 復原、Ctrl+Shift+Z 重做。</Tip>
            </>
          ) : (
            <Tip>切換到「編輯」才能移動元件、連線與修改文字。</Tip>
          )}
        </ul>
      </div>
    </ReadoutBlock>
  )
}

function Tip({ children }: { children: ReactNode }) {
  return <li>{children}</li>
}
