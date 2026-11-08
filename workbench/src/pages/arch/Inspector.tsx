// 編輯器右側的屬性面板：元件（文字、形狀、顏色、字級、尺寸、細部圖）、
// 連線（標籤、線形、線型、箭頭、顏色、粗細、端點）、圖（名稱、層級）。
import { ArrowLeftRight, Ban, Layers, Trash2, Unlink } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button, DraftNumberInput, Segmented } from '@/components/ui/primitives'
import {
  type ArchEdge,
  type ArchNode,
  type Diagram,
  type EdgeEnd,
  type EdgePatch,
  type EdgeStyle,
  FONT_LIMITS,
  isColor,
  isNodeEnd,
  type NodePatch,
  type NodeShapeKind,
  type NodeStyle,
  type Op,
  type Route,
  type Side,
  SHAPES,
  SIZE_LIMITS,
  snapSize,
} from '@/lib/arch/model'
import { SWATCHES } from '@/lib/arch/theme'
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
          className={cn(INPUT, 'h-20 resize-y py-1.5 leading-relaxed')}
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

/** 一列：左邊標籤、右邊控制項。 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-ink-2 shrink-0">{label}</span>
      {children}
    </div>
  )
}

/** 數字欄位；聚焦時記一步復原。transform 把輸入值轉成實際值（例如對齊格點）。 */
function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onCommit,
  onFocus,
  transform = (v) => v,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onCommit: (v: number) => void
  onFocus: () => void
  transform?: (v: number) => number
}) {
  return (
    <Row label={label}>
      <DraftNumberInput
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onFocus={onFocus}
        parse={(t) => {
          const v = Number(t)
          return v >= min && v <= max ? transform(Math.round(v)) : undefined
        }}
        onCommit={onCommit}
      />
    </Row>
  )
}

/**
 * 顏色欄位：色票＋自訂（原生取色器）。allowNone 時多一格「透明」。
 * 點色票記一步復原；取色器拖曳中不逐筆記錄（聚焦時記一步）。
 */
export function ColorField({
  label,
  value,
  onChange,
  onFocus,
  allowNone,
}: {
  label: string
  value: string
  onChange: (v: string, record: boolean) => void
  onFocus: () => void
  allowNone?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="text-muted tabular font-mono text-[11px]">
          {value === 'none' ? '透明' : value}
        </span>
      </div>
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
        {allowNone && (
          <Swatch label="透明" selected={value === 'none'} onClick={() => onChange('none', true)}>
            <Ban className="text-muted size-3.5" aria-hidden />
          </Swatch>
        )}
        {SWATCHES.map((c) => (
          <Swatch
            key={c}
            label={c}
            color={c}
            selected={value.toLowerCase() === c}
            onClick={() => onChange(c, true)}
          />
        ))}
        <label
          className="border-card-border relative inline-flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-md border"
          style={{
            background:
              'conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)',
          }}
          title="自訂顏色"
        >
          <input
            type="color"
            aria-label={`${label}（自訂）`}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={isColor(value) && value.length === 7 ? value : '#000000'}
            onFocus={onFocus}
            onChange={(e) => onChange(e.target.value, false)}
          />
        </label>
      </div>
    </div>
  )
}

function Swatch({
  label,
  color,
  selected,
  onClick,
  children,
}: {
  label: string
  color?: string
  selected: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'border-card-border inline-flex size-6 items-center justify-center rounded-md border',
        selected && 'ring-primary ring-2 ring-offset-1',
      )}
      style={color ? { background: color } : undefined}
    >
      {children}
    </button>
  )
}

/** 形狀選擇：五個小圖示按鈕。 */
function ShapePicker({
  value,
  onChange,
}: {
  value: NodeShapeKind
  onChange: (v: NodeShapeKind) => void
}) {
  return (
    <div role="group" aria-label="形狀" className="grid grid-cols-5 gap-1">
      {SHAPES.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-label={s.label}
          aria-pressed={value === s.value}
          title={s.label}
          onClick={() => onChange(s.value)}
          className={cn(
            'bg-sunken hover:bg-hover flex h-9 items-center justify-center rounded-lg',
            value === s.value && 'bg-card ring-primary ring-2',
          )}
        >
          <ShapeIcon shape={s.value} />
        </button>
      ))}
    </div>
  )
}

/** 形狀的小圖示（也用在左側工具列）。 */
export function ShapeIcon({ shape, className }: { shape: NodeShapeKind; className?: string }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg viewBox="0 0 24 24" className={cn('size-5', className)} aria-hidden>
      {shape === 'rect' && <rect x={3} y={6} width={18} height={12} rx={1.5} {...p} />}
      {shape === 'ellipse' && <ellipse cx={12} cy={12} rx={9} ry={6.5} {...p} />}
      {shape === 'diamond' && <polygon points="12,3.5 21,12 12,20.5 3,12" {...p} />}
      {shape === 'hexagon' && <polygon points="7,5 17,5 21.5,12 17,19 7,19 2.5,12" {...p} />}
      {shape === 'cylinder' && (
        <>
          <path d="M5 6.5 A7 2.5 0 0 1 19 6.5 V17.5 A7 2.5 0 0 1 5 17.5 Z" {...p} />
          <path d="M5 6.5 A7 2.5 0 0 0 19 6.5" {...p} />
        </>
      )}
    </svg>
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
  const s = n.style
  const update = (patch: NodePatch, record = false) =>
    p.apply({ type: 'updateNode', diagram: p.diagram.id, node: n.id, patch }, record)
  const setStyle = (style: Partial<NodeStyle>, record = true) => update({ style }, record)
  const rect = s.shape === 'rect'
  const accent = rect && n.accent.trim() !== ''
  const color = (label: string, key: keyof NodeStyle, allowNone = false) => (
    <ColorField
      label={label}
      value={s[key] as string}
      allowNone={allowNone}
      onFocus={p.checkpoint}
      onChange={(v, record) => setStyle({ [key]: v }, record)}
    />
  )
  return (
    <>
      <Block title="文字">
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
        {rect && (
          <TextField
            label="強調塊"
            value={n.accent}
            placeholder="右側的色塊；空白表示不顯示"
            onFocus={p.checkpoint}
            onChange={(v) => update({ accent: v })}
          />
        )}
        <TextField
          label="說明"
          multiline
          value={n.note}
          placeholder="這個元件做什麼、怎麼運作（檢視時滑過顯示）"
          onFocus={p.checkpoint}
          onChange={(v) => update({ note: v })}
        />
      </Block>

      <Block title="形狀">
        <ShapePicker
          value={s.shape}
          onChange={(shape) => setStyle({ shape, align: shape === 'rect' ? s.align : 'center' })}
        />
        {rect && (
          <>
            <NumberField
              label="圓角"
              value={s.radius}
              min={0}
              max={80}
              step={2}
              onFocus={p.checkpoint}
              onCommit={(radius) => setStyle({ radius }, false)}
            />
            <Row label="文字對齊">
              <Segmented
                label="文字對齊"
                value={s.align}
                onChange={(align) => setStyle({ align })}
                options={[
                  { value: 'left', label: '靠左' },
                  { value: 'center', label: '置中' },
                ]}
              />
            </Row>
          </>
        )}
      </Block>

      <Block title="顏色">
        {color('底色', 'fill', true)}
        {color('框線', 'stroke', true)}
        <NumberField
          label="框線粗細"
          value={s.strokeWidth}
          min={0}
          max={8}
          onFocus={p.checkpoint}
          onCommit={(strokeWidth) => setStyle({ strokeWidth }, false)}
        />
        {color('標題文字', 'textColor')}
        {color('小標文字', 'kickerColor')}
        {accent && color('強調塊底色', 'accentFill')}
        {accent && color('強調塊文字', 'accentText')}
      </Block>

      <Block title="字級">
        <NumberField
          label="標題字級"
          value={s.titleSize}
          min={FONT_LIMITS.min}
          max={FONT_LIMITS.max}
          onFocus={p.checkpoint}
          onCommit={(titleSize) => setStyle({ titleSize }, false)}
        />
        <NumberField
          label="小標字級"
          value={s.kickerSize}
          min={FONT_LIMITS.min}
          max={FONT_LIMITS.max}
          onFocus={p.checkpoint}
          onCommit={(kickerSize) => setStyle({ kickerSize }, false)}
        />
        <p className="text-muted text-[11px]">標題太長放不下時會自動縮小。</p>
      </Block>

      <Block title="尺寸（對齊 20 px 格點）">
        <NumberField
          label="寬度"
          value={n.w}
          min={SIZE_LIMITS.min}
          max={SIZE_LIMITS.maxW}
          step={20}
          transform={(v) => snapSize(v, SIZE_LIMITS.maxW)}
          onFocus={p.checkpoint}
          onCommit={(w) => update({ w })}
        />
        <NumberField
          label="高度"
          value={n.h}
          min={SIZE_LIMITS.min}
          max={SIZE_LIMITS.maxH}
          step={20}
          transform={(v) => snapSize(v, SIZE_LIMITS.maxH)}
          onFocus={p.checkpoint}
          onCommit={(h) => update({ h })}
        />
        {accent && (
          <NumberField
            label="強調塊寬度"
            value={n.accentW}
            min={SIZE_LIMITS.min}
            max={SIZE_LIMITS.maxW}
            step={20}
            transform={(v) => snapSize(v, SIZE_LIMITS.maxW)}
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

const SIDE_TEXT: Record<Side, string> = { top: '上緣', right: '右側', bottom: '下緣', left: '左側' }

export function EdgeInspector({
  edge: e,
  onDelete,
  ...p
}: Props & { edge: ArchEdge; onDelete: () => void }) {
  const name = (end: EdgeEnd) => {
    if (!isNodeEnd(end)) return `自由端點（${end.x}, ${end.y}）`
    const n = p.diagram.nodes.find((x) => x.id === end.node)
    if (!n) return '？'
    const base = end.part === 'accent' && n.accent ? `${n.title}・${n.accent}` : n.title
    return end.side ? `${base}（${SIDE_TEXT[end.side]}）` : base
  }
  const update = (patch: EdgePatch, record = true) =>
    p.apply({ type: 'updateEdge', diagram: p.diagram.id, edge: e.id, patch }, record)
  const setStyle = (style: Partial<EdgeStyle>, record = true) => update({ style }, record)
  const autoEnds = [e.from, e.to].every((end) => isNodeEnd(end) && !end.side)
  const fixedEnds = [e.from, e.to].some((end) => isNodeEnd(end) && end.side)
  const unfix = (end: EdgeEnd): EdgeEnd =>
    isNodeEnd(end) ? { node: end.node, part: end.part } : end

  return (
    <>
      <Block title="連線">
        <div className="space-y-0.5 text-[13px]">
          <div className="font-medium">{name(e.from)}</div>
          <div className="text-muted text-xs">↓</div>
          <div className="font-medium">{name(e.to)}</div>
        </div>
        <TextField
          label="標籤"
          value={e.label}
          placeholder="例如 gRPC、REST"
          onFocus={p.checkpoint}
          onChange={(v) => update({ label: v }, false)}
        />
        <p className="text-muted text-[11px] leading-relaxed">
          拖曳連線兩端的方塊可以重新接到別的定位點，或拉到空白處成為自由端點。
        </p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => update({ from: e.to, to: e.from })}>
            <ArrowLeftRight className="size-4" aria-hidden />
            反轉方向
          </Button>
          {fixedEnds && (
            <Button
              className="flex-1"
              onClick={() => update({ from: unfix(e.from), to: unfix(e.to) })}
            >
              <Unlink className="size-4" aria-hidden />
              自動選邊
            </Button>
          )}
        </div>
      </Block>

      <Block title="樣式">
        <Field label="線形">
          <Segmented
            label="線形"
            value={e.style.shape}
            onChange={(shape) => setStyle({ shape })}
            options={[
              { value: 'orthogonal', label: '直角' },
              { value: 'straight', label: '直線' },
              { value: 'curved', label: '曲線' },
            ]}
            className="flex w-full"
          />
        </Field>
        {e.style.shape === 'orthogonal' && autoEnds && (
          <Field label="轉彎">
            <Segmented
              label="轉彎"
              value={e.route}
              onChange={(route: Route) => update({ route })}
              options={[
                { value: 'auto', label: '自動' },
                { value: 'hv', label: '先水平' },
                { value: 'vh', label: '先垂直' },
              ]}
              className="flex w-full"
            />
          </Field>
        )}
        <Field label="線型">
          <Segmented
            label="線型"
            value={e.style.dash}
            onChange={(dash) => setStyle({ dash })}
            options={[
              { value: 'solid', label: '實線' },
              { value: 'dashed', label: '虛線' },
              { value: 'dotted', label: '點線' },
            ]}
            className="flex w-full"
          />
        </Field>
        <Field label="箭頭">
          <Segmented
            label="箭頭"
            value={e.style.arrow}
            onChange={(arrow) => setStyle({ arrow })}
            options={[
              { value: 'end', label: '終點' },
              { value: 'start', label: '起點' },
              { value: 'both', label: '雙向' },
              { value: 'none', label: '無' },
            ]}
            className="flex w-full"
          />
        </Field>
        <ColorField
          label="線條顏色"
          value={e.style.color}
          onFocus={p.checkpoint}
          onChange={(color, record) => setStyle({ color }, record)}
        />
        <NumberField
          label="粗細"
          value={e.style.width}
          min={1}
          max={10}
          onFocus={p.checkpoint}
          onCommit={(width) => setStyle({ width }, false)}
        />
      </Block>

      <Block title="刪除">
        <Button variant="ghost" className="text-danger w-full" onClick={onDelete}>
          <Trash2 className="size-4" aria-hidden />
          刪除連線
        </Button>
      </Block>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-ink-2 text-xs">{label}</span>
      {children}
    </div>
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
          <li>左側工具列：點形狀新增元件；選「線條」（L）後從任意處拖到另一處畫線，V 回到選取。</li>
          <li>元件一律落在點點上；與其他元件對齊時出現紅色參考線。</li>
          <li>圖形四邊的中點是定位點：從定位點拖出線條，或把線條拖到定位點固定在那一邊。</li>
          <li>選取後拖曳右下角方塊調整大小；拖曳連線兩端重新接。</li>
          <li>點兩下空白處新增元件；點兩下有細部圖的元件進入下一層，Esc 回上一層。</li>
          <li>拖曳空白處或滾輪平移，Ctrl＋滾輪縮放；Shift+1 符合畫面、Shift+2 回到中心。</li>
          <li>方向鍵移動一格；Delete 刪除；Ctrl+Z 復原、Ctrl+Shift+Z 重做。</li>
        </ul>
      </Block>
    </>
  )
}
