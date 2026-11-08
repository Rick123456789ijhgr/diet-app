// 編輯器右側的屬性面板：元件（文字、尺寸、細部圖）、連線（標籤、路線）、圖（名稱、層級）。
import { ArrowLeftRight, Layers, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button, DraftNumberInput, Segmented } from '@/components/ui/primitives'
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
  'bg-sunken h-8 w-full rounded-lg border border-transparent px-2.5 text-[13px] focus-visible:border-primary focus-visible:bg-card focus-visible:outline-none'

/** 面板的一段：小標＋內容。 */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-card-border space-y-3 border-b px-4 py-4">
      <h2 className="text-muted text-[11px] font-semibold tracking-[0.12em]">{title}</h2>
      {children}
    </section>
  )
}

/** 有標籤的文字欄位；聚焦時記一步復原，打字時不逐字記錄。 */
export function TextField({
  label,
  value,
  onChange,
  onFocus,
  multiline,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onFocus: () => void
  multiline?: boolean
  placeholder?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-ink-2 text-xs">{label}</span>
      {multiline ? (
        <textarea
          className={cn(INPUT, 'h-24 resize-y py-1.5 leading-relaxed')}
          value={value}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={INPUT}
          value={value}
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
      <span className="text-ink-2">{label}</span>
      <DraftNumberInput
        aria-label={label}
        value={value}
        min={SIZE_LIMITS.min}
        max={max}
        step={20}
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
  apply: (op: Op, record?: boolean) => void
  checkpoint: () => void
}

export function NodeInspector({
  node: n,
  onDrill,
  onCreateChild,
  onDelete,
  ...p
}: Props & {
  node: ArchNode
  onDrill: () => void
  onCreateChild: () => void
  onDelete: () => void
}) {
  const update = (patch: Partial<ArchNode>) =>
    p.apply({ type: 'updateNode', diagram: p.diagram.id, node: n.id, patch }, false)
  return (
    <>
      <Block title="元件">
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
          placeholder="這個元件做什麼、怎麼運作（檢視時滑過顯示）"
          onFocus={p.checkpoint}
          onChange={(v) => update({ note: v })}
        />
      </Block>
      <Block title="尺寸">
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
      </Block>
      <Block title="細部圖">
        <p className="text-muted text-xs leading-relaxed">
          {n.child
            ? '這個元件有細部圖（C4 的下一層）。點兩下元件也可以進入。'
            : '為這個元件建立下一層，畫出它內部的組成或流程。'}
        </p>
        {n.child ? (
          <Button variant="primary" onClick={onDrill} className="w-full">
            <Layers className="size-4" aria-hidden />
            進入細部圖
          </Button>
        ) : (
          <Button onClick={onCreateChild} className="w-full">
            <Layers className="size-4" aria-hidden />
            建立細部圖
          </Button>
        )}
        <Button variant="ghost" onClick={onDelete} className="text-danger w-full">
          <Trash2 className="size-4" aria-hidden />
          刪除元件{n.child ? '（含細部圖）' : ''}
        </Button>
      </Block>
    </>
  )
}

const ROUTES: { value: Route; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'hv', label: '先水平' },
  { value: 'vh', label: '先垂直' },
]

export function EdgeInspector({
  edge: e,
  onDelete,
  ...p
}: Props & { edge: ArchEdge; onDelete: () => void }) {
  const name = (end: EdgeEnd) => {
    const n = p.diagram.nodes.find((x) => x.id === end.node)
    if (!n) return '？'
    return end.part === 'accent' && n.accent ? `${n.title}・${n.accent}` : n.title
  }
  const update = (patch: Partial<ArchEdge>, record = true) =>
    p.apply({ type: 'updateEdge', diagram: p.diagram.id, edge: e.id, patch }, record)

  return (
    <Block title="連線">
      <div className="text-[13px]">
        <span className="font-medium">{name(e.from)}</span>
        <span className="text-muted mx-1.5">→</span>
        <span className="font-medium">{name(e.to)}</span>
      </div>
      <TextField
        label="標籤"
        value={e.label}
        placeholder="例如 gRPC、REST"
        onFocus={p.checkpoint}
        onChange={(v) => update({ label: v }, false)}
      />
      <div className="space-y-1">
        <span className="text-ink-2 text-xs">路線</span>
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
        <Button variant="ghost" className="text-danger flex-1" onClick={onDelete}>
          <Trash2 className="size-4" aria-hidden />
          刪除連線
        </Button>
      </div>
    </Block>
  )
}

/** 沒有選取時：圖的名稱與層級，以及操作說明。 */
export function DiagramInspector(p: Props) {
  const set = (patch: Partial<Pick<Diagram, 'level' | 'title'>>) =>
    p.apply({ type: 'updateDiagram', diagram: p.diagram.id, patch }, false)
  return (
    <>
      <Block title="這張圖">
        <TextField
          label="名稱"
          value={p.diagram.title}
          onFocus={p.checkpoint}
          onChange={(title) => set({ title })}
        />
        <TextField
          label="C4 層級"
          value={p.diagram.level}
          placeholder="例如 L2 容器"
          onFocus={p.checkpoint}
          onChange={(level) => set({ level })}
        />
        <p className="text-muted text-xs">
          {p.diagram.nodes.length} 個元件、{p.diagram.edges.length} 條連線
        </p>
      </Block>
      <Block title="操作">
        <ul className="text-muted list-disc space-y-1 pl-4 text-xs leading-relaxed">
          <li>拖曳元件移動，會吸附格點；靠近其他元件的邊或中線時自動對齊（紅色參考線）。</li>
          <li>選取或滑過元件會出現藍色圓點，拖到另一個元件即可連線。</li>
          <li>選取後拖曳右下角方塊調整大小。</li>
          <li>點兩下空白處新增元件；點兩下有細部圖的元件進入下一層，Esc 回上一層。</li>
          <li>拖曳空白處或滾輪平移，Ctrl＋滾輪縮放，Shift+1 符合畫面。</li>
          <li>方向鍵移動一格；Delete 刪除；Ctrl+Z 復原、Ctrl+Shift+Z 重做。</li>
        </ul>
      </Block>
    </>
  )
}
