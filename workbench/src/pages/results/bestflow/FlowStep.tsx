// 找最佳流程・步驟 3「處理流程」：選一個方案（要比較哪些前處理方法），可編輯、另存、還原與刪除。
// 內建方案由後端提供；修改與自訂方案只存在這個瀏覽器（lib/flowPresets.ts）。
import { Copy, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useId, useState } from 'react'

import type { ConfigOverride } from '@/api/client'
import { LadderControls } from '@/components/LadderControls'
import { ParamForm } from '@/components/ParamForm'
import { ErrorBox } from '@/components/results'
import { Dialog } from '@/components/ui/Dialog'
import { Badge, Button } from '@/components/ui/primitives'
import { useConfigSchemas } from '@/hooks/useConfigSchemas'
import { cn } from '@/lib/cn'
import {
  methodsOf,
  overridesOf,
  PIPELINE_STEPS,
  presetProblems,
  valuesOf,
  type Preset,
  type PresetEntry,
} from '@/lib/flowPresets'
import { methodText, rungText } from '@/lib/text'

export function FlowStep({
  entries,
  selected,
  onSelect,
  onSave,
  onRestore,
  onDuplicate,
  onRemove,
  loading,
  error,
}: {
  entries: PresetEntry[]
  selected: PresetEntry | undefined
  onSelect: (id: string) => void
  onSave: (p: Preset) => void
  onRestore: (id: string) => void
  /** 以某個方案為底新增自訂方案，回傳新方案的 id */
  onDuplicate: (base: Preset, name?: string) => string
  onRemove: (id: string) => void
  loading: boolean
  error: unknown
}) {
  // 編輯中的方案 id（打開編輯彈窗）；新增方案後直接打開
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<PresetEntry | null>(null)
  const editEntry = entries.find((e) => e.preset.id === editing)

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorBox error={error} />
      </div>
    )
  }
  if (loading) {
    return <p className="text-muted p-8 text-center text-sm">載入方案中…</p>
  }

  const builtins = entries.filter((e) => e.kind === 'builtin')
  const custom = entries.filter((e) => e.kind === 'custom')

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="處理流程方案"
        className="border-card-border flex w-72 shrink-0 flex-col overflow-y-auto border-r px-3 py-4"
      >
        <PresetList title="內建方案" entries={builtins} selected={selected} onSelect={onSelect} />
        <PresetList
          title="我的方案"
          entries={custom}
          selected={selected}
          onSelect={onSelect}
          empty="還沒有自訂方案。可以從任何方案複製一份再修改。"
        />
        <Button
          size="sm"
          className="mt-3 self-start"
          disabled={!selected}
          onClick={() => {
            if (!selected) return
            setEditing(onDuplicate(selected.preset, '新方案'))
          }}
        >
          <Plus className="size-3.5" aria-hidden />
          新增方案
        </Button>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
        {selected ? (
          <PresetDetail
            entry={selected}
            onEdit={() => setEditing(selected.preset.id)}
            onRestore={() => onRestore(selected.preset.id)}
            onDuplicate={() => onDuplicate(selected.preset)}
            onRemove={() => setRemoving(selected)}
          />
        ) : (
          <p className="text-muted text-sm">請從左邊選一個方案。</p>
        )}
      </div>

      {editEntry && (
        <EditDialog
          // 換方案時重建草稿
          key={editEntry.preset.id}
          entry={editEntry}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            onSave(p)
            setEditing(null)
          }}
        />
      )}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title="要刪除這個方案嗎？"
        description={removing ? `「${removing.preset.name}」刪除後無法復原。` : undefined}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (removing) onRemove(removing.preset.id)
                setRemoving(null)
              }}
            >
              <Trash2 className="size-3.5" aria-hidden />
              刪除
            </Button>
          </>
        }
      >
        <p className="text-ink-2 text-[13px]">過去用這個方案跑出的結果不受影響。</p>
      </Dialog>
    </div>
  )
}

function PresetList({
  title,
  entries,
  selected,
  onSelect,
  empty,
}: {
  title: string
  entries: PresetEntry[]
  selected: PresetEntry | undefined
  onSelect: (id: string) => void
  empty?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="mb-4">
      <h3 id={id} className="text-muted mb-1.5 px-2 text-xs font-semibold">
        {title}
      </h3>
      {entries.length === 0 && empty ? (
        <p className="text-muted px-2 text-xs leading-relaxed">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {entries.map((e) => {
            const on = e.preset.id === selected?.preset.id
            return (
              <li key={e.preset.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(e.preset.id)}
                  className={cn(
                    'focus-visible:ring-primary/40 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] focus-visible:ring-2 focus-visible:outline-none',
                    on ? 'bg-ink text-on-ink' : 'hover:bg-hover',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{e.preset.name}</span>
                  {e.modified && <Badge tone={on ? 'muted' : 'warn'}>已修改</Badge>}
                  <span className={cn('readout text-xs', on ? 'opacity-70' : 'text-muted')}>
                    {methodsOf(e.preset.arm.ladder).length}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const ZXING_TEXT: Record<string, string> = {
  try_rotate: '90° 旋轉',
  try_downscale: '縮小',
  try_invert: '反色',
}

function PresetDetail({
  entry,
  onEdit,
  onRestore,
  onDuplicate,
  onRemove,
}: {
  entry: PresetEntry
  onEdit: () => void
  onRestore: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const { preset, kind, modified } = entry
  const methods = methodsOf(preset.arm.ladder)
  const zxingOn = Object.entries(preset.arm.zxing)
    .filter(([, v]) => v === true)
    .map(([k]) => ZXING_TEXT[k] ?? k)
  const formats = (preset.arm.ladder.accept_formats as string[] | undefined) ?? []
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[18px] font-semibold">{preset.name}</h3>
          <Badge tone="muted">{kind === 'builtin' ? '內建' : '自訂'}</Badge>
          {modified && <Badge tone="warn">已修改，可還原</Badge>}
        </div>
        {preset.description && (
          <p className="text-ink-2 mt-1.5 text-[13px] leading-relaxed">{preset.description}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" aria-hidden />
          編輯
        </Button>
        <Button size="sm" variant="ghost" onClick={onDuplicate}>
          <Copy className="size-3.5" aria-hidden />
          複製成新方案
        </Button>
        {kind === 'builtin' && (
          <Button size="sm" variant="ghost" disabled={!modified} onClick={onRestore}>
            <RotateCcw className="size-3.5" aria-hidden />
            還原預設
          </Button>
        )}
        {kind === 'custom' && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <Trash2 className="size-3.5" aria-hidden />
            刪除
          </Button>
        )}
      </div>

      <section aria-label="會執行的方法">
        <h4 className="mb-2 text-xs font-semibold">
          會執行的方法 <span className="readout text-muted">{methods.length}</span> 個
        </h4>
        <ul className="flex flex-wrap gap-1.5">
          {methods.map((m) => (
            <li key={m} className="border-card-border rounded-lg border px-2 py-0.5 text-xs">
              {methodText(m)}
            </li>
          ))}
        </ul>
        <p className="text-muted mt-2 text-xs">每張圖都會用每個方法各解碼一次，方法越多越慢。</p>
      </section>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-muted">zxing 內建嘗試</dt>
        <dd>{zxingOn.length ? zxingOn.join('、') : '全部關閉'}</dd>
        <dt className="text-muted">採用格式</dt>
        <dd>{formats.length ? formats.join('、') : '全部格式'}</dd>
      </dl>
    </div>
  )
}

/** 編輯彈窗：在草稿上修改，按「儲存」才寫回。 */
function EditDialog({
  entry,
  onClose,
  onSave,
}: {
  entry: PresetEntry
  onClose: () => void
  onSave: (p: Preset) => void
}) {
  const schemas = useConfigSchemas()
  const ladderSchema = schemas.data?.classes.find((c) => c.name === 'LadderConfig')
  const zxingSchema = schemas.data?.classes.find((c) => c.name === 'ZxingConfig')
  const enums = schemas.data?.enums ?? {}
  const [draft, setDraft] = useState<Preset>(entry.preset)
  const problems = presetProblems(draft)
  const nameId = useId()
  const descId = useId()

  const ladder = draft.arm.ladder
  const pipelines = (ladder.pipelines as string[][] | undefined) ?? []
  const rungs = (ladder.rungs as string[] | undefined) ?? []
  const setArm = (patch: Partial<Preset['arm']>) =>
    setDraft((d) => ({ ...d, arm: { ...d.arm, ...patch } }))
  const setLadder = (next: Record<string, unknown>) => setArm({ ladder: next })

  // 疊加流程（陣列的陣列）不交給 LadderControls／ParamForm，另外編輯
  let ladderOverrides: ConfigOverride = {}
  if (ladderSchema) {
    const { pipelines: _p, ...rest } = overridesOf(ladderSchema, ladder)
    void _p
    ladderOverrides = rest
  }
  const sequences = Object.fromEntries(
    Object.entries(ladderOverrides).filter(([, v]) => Array.isArray(v)),
  )
  const scalars = Object.fromEntries(
    Object.entries(ladderOverrides).filter(([, v]) => !Array.isArray(v)),
  )
  const applyLadder = (o: ConfigOverride) =>
    ladderSchema && setLadder({ ...valuesOf(ladderSchema, o), pipelines })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`編輯方案：${entry.preset.name}`}
      description={
        entry.kind === 'builtin'
          ? '修改只存在這個瀏覽器；之後可以按「還原預設」回到內建設定。'
          : '自訂方案只存在這個瀏覽器。'
      }
      className="max-w-2xl"
      footer={
        <>
          {problems.length > 0 && (
            <p role="alert" className="text-danger min-w-0 flex-1 text-xs">
              {problems.join('；')}
            </p>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={problems.length > 0}
            onClick={() => onSave({ ...draft, name: draft.name.trim() })}
          >
            儲存
          </Button>
        </>
      }
    >
      {schemas.error ? (
        <ErrorBox error={schemas.error} />
      ) : !ladderSchema || !zxingSchema ? (
        <p className="text-muted text-sm">載入參數結構中…</p>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <div>
              <label htmlFor={nameId} className="mb-1 block text-xs font-semibold">
                方案名稱
              </label>
              <input
                id={nameId}
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="border-card-border bg-card focus-visible:ring-primary/40 w-full rounded-lg border px-2.5 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
            <div>
              <label htmlFor={descId} className="mb-1 block text-xs font-semibold">
                說明
              </label>
              <textarea
                id={descId}
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                className="border-card-border bg-card focus-visible:ring-primary/40 w-full rounded-lg border px-2.5 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
          </div>

          <section className="border-card-border space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">要比較的方法</h3>
            <LadderControls
              schema={ladderSchema}
              overrides={sequences}
              onChange={(o) => applyLadder({ ...o, ...scalars })}
              rungs={enums.Rung ?? []}
              formats={(enums.CodeFormat ?? []).filter((f) => f !== 'OTHER')}
              showFormats
              hideReset
              orderTitle="方法"
              orderHelp="每個方法都由原圖獨立產生一個版本並解碼，全部都會執行；這裡的順序只影響列出的順序，最佳順序由結論決定。"
            />
          </section>

          {rungs.includes('pipeline') && (
            <section className="border-card-border space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold">疊加流程</h3>
              <p className="text-muted text-xs">
                每條流程在同一張影像上依序做多個處理（至少兩個步驟、不重複）。
              </p>
              <PipelinesEditor
                pipelines={pipelines}
                onChange={(next) => setLadder({ ...ladder, pipelines: next })}
              />
            </section>
          )}

          <section className="border-card-border space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">解碼器（zxing-cpp）</h3>
            <p className="text-muted text-xs">
              全部關閉時只看前處理本身的效果；開啟後解碼器會自己嘗試旋轉、縮小與反色。
            </p>
            <ParamForm
              schema={zxingSchema}
              overrides={overridesOf(zxingSchema, draft.arm.zxing) as ConfigOverride}
              onChange={(o) => setArm({ zxing: valuesOf(zxingSchema, o) })}
              hideReset
            />
          </section>

          <details className="border-card-border border-t pt-4">
            <summary className="cursor-pointer text-sm font-semibold">各處理的參數</summary>
            <div className="mt-3">
              <ParamForm
                schema={ladderSchema}
                overrides={scalars}
                onChange={(o) => applyLadder({ ...o, ...sequences })}
                hideReset
              />
            </div>
          </details>
        </div>
      )}
    </Dialog>
  )
}

/** 疊加流程清單：每條流程依點選順序加入步驟；可新增、刪除流程與移除最後一步。 */
function PipelinesEditor({
  pipelines,
  onChange,
}: {
  pipelines: string[][]
  onChange: (next: string[][]) => void
}) {
  const set = (i: number, p: string[]) => onChange(pipelines.map((x, j) => (j === i ? p : x)))
  return (
    <div className="space-y-2">
      <ol className="space-y-2" aria-label="疊加流程">
        {pipelines.map((p, i) => (
          <li
            key={i}
            className="border-card-border space-y-1.5 rounded-lg border px-2.5 py-2 text-[13px]"
          >
            <div className="flex items-center gap-2">
              <span className="text-muted tabular w-4 text-xs">{i + 1}</span>
              <span className="min-w-0 flex-1">
                {p.length ? p.map(rungText).join(' → ') : '（尚未選步驟）'}
              </span>
              <button
                type="button"
                aria-label={`刪除第 ${i + 1} 條疊加流程`}
                onClick={() => onChange(pipelines.filter((_, j) => j !== i))}
                className="text-muted hover:text-ink rounded p-0.5"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1 pl-6">
              {PIPELINE_STEPS.map((s) => {
                const on = p.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    aria-label={`第 ${i + 1} 條：${rungText(s)}`}
                    // 點選加到最後，再點一次移除
                    onClick={() => set(i, on ? p.filter((x) => x !== s) : [...p, s])}
                    className={cn(
                      'rounded-lg border px-2 py-0.5 text-xs',
                      on
                        ? 'border-primary bg-primary-soft text-primary-ink'
                        : 'border-card-border text-muted hover:bg-hover',
                    )}
                  >
                    {rungText(s)}
                    {on && <span className="ml-1 opacity-60">{p.indexOf(s) + 1}</span>}
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ol>
      <Button size="sm" variant="ghost" onClick={() => onChange([...pipelines, []])}>
        <Plus className="size-3.5" aria-hidden />
        新增疊加流程
      </Button>
    </div>
  )
}
