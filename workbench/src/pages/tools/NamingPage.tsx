// 通用工具・圖片批次命名（/tools/naming）：把「檔名就是條碼」的實驗照片改成 <類別>_<批次>_<序號>_<條碼>。
// 流程：填參數 → 預覽（不動檔案）→ 確認後改名 → 需要時還原。規劃與改名都在 Python
// （dietai.devtools.image_naming），改名時後端依資料夾重新規劃，不採用這裡顯示的預覽。
// 找最佳流程會直接把規則化檔名中的條碼當作人工確認的真值。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, FolderOpen, PenLine, SlidersHorizontal, TriangleAlert, Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { api, ApiError, unwrap } from '@/api/client'
import { FolderPicker } from '@/components/FolderPicker'
import { Disclosure, PanelSection, PanelStack } from '@/components/layout/PanelSections'
import { EmptyState, MainView, ReadoutBlock, Split, Workspace } from '@/components/layout/Workspace'
import { ErrorBox, Metric, MetricGrid } from '@/components/results'
import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { Badge, Button, DraftNumberInput, Segmented } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { parseClampedInt } from '@/lib/number'

/** 後端 image_naming.plan_json 的回應（FreeJson，結構由 Python 定義）。 */
export interface NamingItem {
  src: string
  dst: string
  status: 'rename' | 'same' | 'skip'
  /** 檔名帶的條碼；空字串＝沒有條碼、null＝看不出來 */
  code: string | null
  note: string
}
export interface NamingResult {
  folder: string
  items: NamingItem[]
  counts: { rename: number; same: number; skip: number }
  /** 改名後（含不變的）主檔名的長度；不只一種時提示長度不一致 */
  stem_lengths: number[]
  can_undo: boolean
  categories: Record<string, string>
  /** 只有改名的回應才有 */
  renamed?: number
}

interface Options {
  folder: string
  category: string
  batch: string
  start: number
  width: number
  order: 'mtime' | 'name'
  include_unknown: boolean
  no_code: string
}

/** 預設的類別（與後端 image_naming.CATEGORIES 相同）；也可自訂。 */
const PRESETS = [
  { value: 'f', label: '食物包裝' },
  { value: 'o', label: '其他物品' },
] as const
const CUSTOM = 'custom'

const STATUS: Record<NamingItem['status'], { text: string; tone: 'primary' | 'muted' | 'warn' }> = {
  rename: { text: '改名', tone: 'primary' },
  same: { text: '不變', tone: 'muted' },
  skip: { text: '略過', tone: 'warn' },
}

const fieldClass =
  'border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card h-7 rounded-lg border px-2 text-xs focus-visible:outline-none aria-[invalid=true]:border-danger'

const preview = (o: Options) =>
  unwrap(
    api.POST('/workbench/v1/dev/image-naming/preview', { body: o }),
  ) as Promise<unknown> as Promise<NamingResult>

export function NamingPage() {
  const qc = useQueryClient()
  const [folder, setFolder] = useState('')
  const [preset, setPreset] = useState<string>('f')
  const [custom, setCustom] = useState('')
  const [batch, setBatch] = useState('a01')
  const [start, setStart] = useState(0)
  const [width, setWidth] = useState(3)
  const [order, setOrder] = useState<Options['order']>('mtime')
  const [includeUnknown, setIncludeUnknown] = useState(false)
  const [noCode, setNoCode] = useState('nocode')
  const [advanced, setAdvanced] = useState(false)

  const current: Options = {
    folder: folder.trim(),
    category: preset === CUSTOM ? custom.trim() : preset,
    batch: batch.trim(),
    start,
    width,
    order,
    include_unknown: includeUnknown,
    no_code: noCode.trim(),
  }
  // 按「預覽」時的參數；改名一律用這組（與畫面上的預覽一致）
  const [submitted, setSubmitted] = useState<Options | null>(null)
  const key = ['image-naming', submitted] as const
  const query = useQuery({
    queryKey: key,
    queryFn: () => preview(submitted!),
    enabled: submitted !== null,
    retry: false,
  })
  const changed = submitted !== null && JSON.stringify(submitted) !== JSON.stringify(current)

  const apply = useMutation({
    mutationFn: (o: Options) =>
      unwrap(
        api.POST('/workbench/v1/dev/image-naming/apply', { body: o }),
      ) as Promise<unknown> as Promise<NamingResult>,
    onSuccess: (data) => qc.setQueryData(key, data),
  })
  const undo = useMutation({
    mutationFn: (dir: string) =>
      unwrap(
        api.POST('/workbench/v1/dev/image-naming/undo', { body: { folder: dir } }),
      ) as Promise<unknown> as Promise<{ restored: number; problems: string[] }>,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const error = query.error ?? apply.error ?? undo.error
  const badField = error instanceof ApiError ? error.field : undefined
  const invalid = (f: string) => (badField === f ? true : undefined)
  const data = query.data
  const lastApply = apply.data?.renamed

  function run() {
    apply.reset()
    undo.reset()
    setSubmitted(current)
    if (JSON.stringify(current) === JSON.stringify(submitted)) void query.refetch()
  }

  const panel = (
    <PanelStack>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault()
          if (current.folder) run()
        }}
      >
        <PanelSection title="資料夾">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted text-xs">
              照片所在的資料夾（伺服器本機路徑，不含子資料夾）
            </span>
            <div className="flex gap-2">
              <input
                aria-label="資料夾"
                aria-invalid={invalid('folder')}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="D:\photos\food"
                className={cn(fieldClass, 'readout min-w-0 flex-1')}
              />
              <FolderPicker value={folder} onPick={setFolder} />
            </div>
          </div>
          <p className="text-muted mt-2 text-xs">
            檔名要先是條碼（<span className="readout">4710088410108.jpg</span>、
            <span className="readout">沒有條碼_IMG_1.jpg</span>），工具保留條碼、改成規則化檔名。
          </p>
        </PanelSection>

        <PanelSection title="命名規則">
          <div className="space-y-3 text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-muted">類別</span>
              <Segmented
                label="類別"
                value={preset}
                onChange={setPreset}
                options={[
                  ...PRESETS.map((p) => ({ value: p.value, label: `${p.label}（${p.value}）` })),
                  { value: CUSTOM, label: '自訂' },
                ]}
              />
              {preset === CUSTOM && (
                <input
                  aria-label="自訂類別"
                  aria-invalid={invalid('category')}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="例如 b（書）"
                  className={cn(fieldClass, 'readout mt-1')}
                />
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-muted">批次</span>
                <input
                  aria-label="批次"
                  aria-invalid={invalid('batch')}
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  className={cn(fieldClass, 'readout')}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted">起始序號</span>
                <DraftNumberInput
                  aria-label="起始序號"
                  aria-invalid={invalid('start')}
                  min={0}
                  value={start}
                  parse={(t) => parseClampedInt(t, 0, 999_999)}
                  onCommit={setStart}
                />
              </label>
            </div>
            <p className="text-muted">
              類別、批次只用小寫英數字與連字號。起始序號 0＝接在這個類別批次既有的最大序號之後。
            </p>
          </div>
        </PanelSection>
        <Disclosure
          open={advanced || ['width', 'no_code'].includes(badField ?? '')}
          onOpenChange={setAdvanced}
          icon={SlidersHorizontal}
          title="進階"
        >
          <div className="space-y-3 text-xs">
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted">序號位數（3–6）</span>
              <DraftNumberInput
                aria-label="序號位數"
                aria-invalid={invalid('width')}
                min={3}
                max={6}
                value={width}
                parse={(t) => parseClampedInt(t, 3, 6)}
                onCommit={setWidth}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-muted">編號順序</span>
              <Segmented
                label="編號順序"
                value={order}
                onChange={setOrder}
                options={[
                  { value: 'mtime', label: '拍攝時間' },
                  { value: 'name', label: '原檔名' },
                ]}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-muted">「沒有條碼」的標記（小寫字母）</span>
              <input
                aria-label="沒有條碼的標記"
                aria-invalid={invalid('no_code')}
                value={noCode}
                onChange={(e) => setNoCode(e.target.value)}
                className={cn(fieldClass, 'readout')}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeUnknown}
                onChange={(e) => setIncludeUnknown(e.target.checked)}
              />
              看不出條碼的檔名也編號（不帶條碼）
            </label>
          </div>
        </Disclosure>

        <PanelSection>
          <Button type="submit" variant="primary" className="w-full" disabled={!current.folder}>
            <Eye className="size-4" aria-hidden />
            預覽
          </Button>
        </PanelSection>
      </form>
    </PanelStack>
  )

  return (
    <Workspace
      panel={panel}
      title="圖片批次命名"
      description="把檔名就是條碼的照片改成 <類別>_<批次>_<序號>_<條碼>；先預覽，確認後改名，可還原。"
      aside={changed ? <Badge tone="warn">參數已修改，按「預覽」重新規劃</Badge> : null}
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        {error ? <ErrorBox error={error} className="shrink-0" /> : null}
        {submitted === null ? (
          <EmptyState icon={<FolderOpen className="size-8" aria-hidden />}>
            在左側輸入資料夾與命名規則後按「預覽」。
          </EmptyState>
        ) : !data ? (
          query.isFetching ? (
            <EmptyState>規劃中…</EmptyState>
          ) : null
        ) : (
          <div className="min-h-0 flex-1">
            <Split
              main={<MainView>{<ItemsTable items={data.items} />}</MainView>}
              readout={
                <>
                  <ReadoutBlock title="統計">
                    <MetricGrid>
                      <Metric label="會改名" value={String(data.counts.rename)} />
                      <Metric label="已是規則化" value={String(data.counts.same)} />
                      <Metric label="略過" value={String(data.counts.skip)} />
                    </MetricGrid>
                    {data.stem_lengths.length > 1 && (
                      <p className="text-warn mt-3 flex items-start gap-1.5 text-xs">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        檔名長度不一致（{data.stem_lengths.join('、')} 字元）：EAN-8
                        或「沒有條碼」的檔名較短。
                      </p>
                    )}
                    {lastApply !== undefined && (
                      <p role="status" className="text-ok mt-3 text-xs">
                        已改名 {lastApply} 個檔案。
                      </p>
                    )}
                    {undo.data && (
                      <p role="status" className="text-ok mt-3 text-xs">
                        已還原 {undo.data.restored} 個檔案。
                        {undo.data.problems.map((p) => (
                          <span key={p} className="text-danger block">
                            {p}
                          </span>
                        ))}
                      </p>
                    )}
                  </ReadoutBlock>
                  <ReadoutBlock title="執行">
                    <div className="space-y-2">
                      <ConfirmButton
                        label={`改名 ${data.counts.rename} 個檔案`}
                        icon={<PenLine className="size-4" aria-hidden />}
                        variant="primary"
                        disabled={changed || data.counts.rename === 0 || apply.isPending}
                        title="確定改名？"
                        body={`將在 ${data.folder} 改名 ${data.counts.rename} 個檔案。不覆寫既有檔案；每筆記在資料夾的 _rename_log.csv，可以還原。`}
                        confirm="改名"
                        onConfirm={() => apply.mutate(submitted)}
                      />
                      <ConfirmButton
                        label="還原先前的改名"
                        icon={<Undo2 className="size-4" aria-hidden />}
                        variant="outline"
                        disabled={!data.can_undo || undo.isPending}
                        title="確定還原？"
                        body={`依 ${data.folder} 的 _rename_log.csv，由後往前還原紀錄中的全部改名。`}
                        confirm="還原"
                        onConfirm={() => {
                          apply.reset()
                          undo.mutate(submitted.folder)
                        }}
                      />
                      {changed && (
                        <p className="text-muted text-xs">參數已修改：先按「預覽」再改名。</p>
                      )}
                    </div>
                  </ReadoutBlock>
                </>
              }
            />
          </div>
        )}
      </div>
    </Workspace>
  )
}

/** 按下後先開確認彈窗，確認才執行。 */
function ConfirmButton({
  label,
  icon,
  variant,
  disabled,
  title,
  body,
  confirm,
  onConfirm,
}: {
  label: string
  icon: ReactNode
  variant: 'primary' | 'outline'
  disabled: boolean
  title: string
  body: string
  confirm: string
  onConfirm: () => void
}) {
  return (
    <Dialog
      title={title}
      trigger={
        <Button variant={variant} className="w-full" disabled={disabled}>
          {icon}
          {label}
        </Button>
      }
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="primary" onClick={onConfirm}>
              {confirm}
            </Button>
          </DialogClose>
        </>
      }
    >
      <p className="text-ink-2 text-[13px] break-all">{body}</p>
    </Dialog>
  )
}

/** 每個檔案的計畫：原檔名 → 新檔名、狀態、條碼；略過的附原因。 */
function ItemsTable({ items }: { items: NamingItem[] }) {
  if (items.length === 0) return <EmptyState>資料夾中沒有影像。</EmptyState>
  return (
    <table className="w-full text-xs" aria-label="改名預覽">
      <thead className="text-muted bg-card sticky top-0 text-left">
        <tr>
          <th className="px-4 py-2 font-medium">狀態</th>
          <th className="px-2 py-2 font-medium">原檔名</th>
          <th className="px-2 py-2 font-medium">新檔名</th>
          <th className="px-4 py-2 font-medium">條碼</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.src} className="border-card-border border-t">
            <td className="px-4 py-1.5">
              <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].text}</Badge>
            </td>
            <td className="readout px-2 py-1.5 break-all">{i.src}</td>
            <td className="readout px-2 py-1.5 break-all">
              {i.status === 'skip' ? (
                <span className="text-muted">{i.note}</span>
              ) : i.status === 'same' ? (
                <span className="text-muted">（不變）</span>
              ) : (
                i.dst
              )}
            </td>
            <td className="readout px-4 py-1.5">
              {i.code === null ? '—' : i.code === '' ? '沒有條碼' : i.code}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
