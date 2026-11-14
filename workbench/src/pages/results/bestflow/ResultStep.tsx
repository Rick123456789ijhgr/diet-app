// 找最佳流程・步驟 4「結論」：推薦流程、真值、單一方法三個分頁；準則與匯出放在彈窗。
// 判定、貪婪選擇與統計一律由後端計算，這裡只顯示。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleHelp,
  Download,
  ListChecks,
  FilePen,
  RotateCw,
  SlidersHorizontal,
  TriangleAlert,
  Trophy,
  Undo2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { api, ApiError, artifactUrl, unwrap } from '@/api/client'
import { FolderPicker } from '@/components/FolderPicker'
import { BarList } from '@/components/charts'
import { CodeBlock } from '@/components/ConfigIO'
import { EmptyState, Section } from '@/components/layout/Workspace'
import { DataTable, ErrorBox } from '@/components/results'
import { Dialog } from '@/components/ui/Dialog'
import { Badge, Button, DraftNumberInput, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { cn } from '@/lib/cn'
import { parseClampedInt } from '@/lib/number'
import { errorText, methodText } from '@/lib/text'

import {
  criteriaQuery,
  DEFAULT_CRITERIA,
  LADDER_TEXT,
  pct,
  STATUS_BADGE,
  STOP_TEXT,
  type Criteria,
  type ImageRow,
  type Result,
  type Run,
  type UnsavedTruths,
} from './types'

/** 錯誤的一行說明：後端錯誤為「代碼的中文：訊息」，其他（例如連線中斷）只有訊息。 */
const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? `${errorText(error.code)}：${error.message}`
    : error instanceof Error
      ? error.message
      : String(error)

/**
 * 結論畫面。runName 為要看的執行；criteria 改變時以查詢參數重新取得（後端重新選擇）。
 * unsaved：剛執行完送出人工真值失敗時留下的那批真值；不分分頁在頂部提醒，可重新送出。
 */
export function ResultStep({
  runName,
  root,
  criteria,
  setCriteria,
  unsaved,
  onSaved,
}: {
  runName: string
  root: string
  criteria: Criteria
  setCriteria: (c: Criteria) => void
  /** 逐張確認的真值沒寫進這次執行；null 為沒有這種情況 */
  unsaved: UnsavedTruths | null
  /** 重新送出成功 */
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const runKey = ['best-flow-run', root, runName, criteria]
  const run = useQuery({
    queryKey: runKey,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/dev/best-flow/runs/{run_id}', {
          params: { path: { run_id: runName }, query: criteriaQuery(root, criteria) },
          signal,
        }),
      ) as Promise<unknown> as Promise<Run>,
    // 換準則時保留上一份結果，避免畫面閃成「載入中」
    placeholderData: (prev) => prev,
  })

  // 確認真值：回應即更新後的結果，直接寫回快取；其他準則下的快取一併失效
  const setTruth = useMutation({
    mutationFn: (truths: Record<string, string | null>) =>
      unwrap(
        api.PUT('/workbench/v1/dev/best-flow/runs/{run_id}/truth', {
          params: { path: { run_id: runName }, query: criteriaQuery(root, criteria) },
          body: { truths },
        }),
      ) as Promise<unknown> as Promise<Run>,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['best-flow-run', root, runName] })
      qc.setQueryData(runKey, data)
    },
  })

  if (run.error) {
    return (
      <div className="p-5">
        <ErrorBox error={run.error} />
      </div>
    )
  }
  if (!run.data) return <EmptyState>載入中…</EmptyState>
  return (
    <RunView
      key={run.data.name}
      data={run.data}
      criteria={criteria}
      setCriteria={setCriteria}
      onTruth={(truths) => setTruth.mutate(truths)}
      saving={setTruth.isPending}
      saveError={setTruth.error}
      unsaved={unsaved}
      onResend={() => unsaved && setTruth.mutate(unsaved.truths, { onSuccess: onSaved })}
    />
  )
}

/** 一次執行：上方一行真值摘要＋分頁與動作，下方為目前分頁的內容。換執行時（key）分頁重置。 */
function RunView({
  data,
  criteria,
  setCriteria,
  onTruth,
  saving,
  saveError,
  unsaved,
  onResend,
}: {
  data: Run
  criteria: Criteria
  setCriteria: (c: Criteria) => void
  onTruth: (truths: Record<string, string | null>) => void
  saving: boolean
  saveError: unknown
  unsaved: UnsavedTruths | null
  onResend: () => void
}) {
  const c = data.counts
  // 有未定的圖片又還沒有結論時，先帶到真值
  const [tab, setTab] = useState(c.undecided > 0 && !data.result ? 'truth' : 'result')
  const result = data.result
  const manual = data.images.filter((i) => i.applied?.source === 'manual').length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-4 pb-3">
        <Segmented
          label="檢視"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'result', label: withIcon(Trophy, '結論') },
            {
              value: 'truth',
              label: withIcon(
                ListChecks,
                c.undecided > 0 ? `真值（${c.undecided} 待確認）` : '真值',
              ),
            },
            { value: 'methods', label: withIcon(BarChart3, '單一方法') },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <CriteriaDialog criteria={criteria} setCriteria={setCriteria} />
          <RenameDialog data={data} />
          {result?.export && <ExportDialog exp={result.export} />}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {/* 不分分頁都顯示：沒寫入的話，畫面上的結論只用了程式推定的真值 */}
        {unsaved && (
          <div
            role="alert"
            aria-label="真值沒有寫入"
            className="bg-danger-soft mb-4 rounded-2xl px-4 py-3 text-[13px]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <TriangleAlert className="text-danger size-4 shrink-0" aria-hidden />
              <p className="text-danger min-w-0 flex-1 font-semibold">
                你確認的 {Object.keys(unsaved.truths).length}{' '}
                張真值沒有寫入，下面的結論只用了程式推定的真值。
              </p>
              <Button size="sm" variant="primary" disabled={saving} onClick={onResend}>
                <RotateCw className="size-3.5" aria-hidden />
                重新送出
              </Button>
            </div>
            <p className="text-muted mt-1 pl-6 text-xs break-all">
              {errorMessage(saveError ?? unsaved.error)}
            </p>
          </div>
        )}
        <p className="text-ink-2 mb-4 text-xs">
          共 {c.images} 張：已確定 {c.decided} 張（有條碼 {c.positives}、沒有條碼 {c.negatives}；
          人工 {manual}、程式推定 {c.decided - manual}）
          {c.undecided > 0 ? `，${c.undecided} 張待確認。` : '。'}
          <span className="text-muted">
            {' '}
            至少 {data.meta.min_methods} 個方法讀出相同且檢查碼正確的號碼，程式就自動採用。
          </span>
        </p>
        {c.undecided > 0 && tab !== 'truth' && (
          <div
            role="alert"
            className="bg-warn-soft text-warn mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-xs"
          >
            <CircleHelp className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">
              有 {c.undecided}{' '}
              張圖片尚未確認真值，沒有納入統計。這些多半是讀不出來或讀法不一致的難題，
              不確認的話成功率會偏高。
            </span>
            <Button size="sm" onClick={() => setTab('truth')}>
              去確認
            </Button>
          </div>
        )}
        {tab === 'result' ? (
          <Conclusion result={result} onGoTruth={() => setTab('truth')} />
        ) : tab === 'truth' ? (
          <TruthTable
            images={data.images}
            onTruth={onTruth}
            saving={saving}
            saveError={saveError}
          />
        ) : (
          <MethodTable result={result} />
        )}
        <p className="text-muted mt-6 text-xs">
          推薦流程是在這批圖片上選出來的；要寫成結論，請另外用鎖定的測試集驗證。
        </p>
      </div>
    </div>
  )
}

/** 選擇準則（彈窗）：改了就以新準則重新選擇。 */
function CriteriaDialog({
  criteria,
  setCriteria,
}: {
  criteria: Criteria
  setCriteria: (c: Criteria) => void
}) {
  const changed = (Object.keys(DEFAULT_CRITERIA) as (keyof Criteria)[]).some(
    (k) => criteria[k] !== DEFAULT_CRITERIA[k],
  )
  return (
    <Dialog
      title="選擇準則"
      description="程式從原圖開始，依序加入「能多讀對最多張」的方法，直到下列條件不再滿足。"
      trigger={
        <Button size="sm">
          <SlidersHorizontal className="size-3.5" aria-hidden />
          選擇準則
          {changed && <span className="bg-primary size-1.5 rounded-full" aria-label="已調整" />}
        </Button>
      }
      footer={
        <Button
          size="sm"
          variant="ghost"
          disabled={!changed}
          onClick={() => setCriteria(DEFAULT_CRITERIA)}
        >
          <Undo2 className="size-3.5" aria-hidden />
          改回預設
        </Button>
      }
    >
      <div className="space-y-4 text-[13px]">
        <CriteriaInput
          label="每一步至少多救回"
          unit="張"
          help="下一個方法能多讀對的張數低於這個值時就停止加入。"
          value={criteria.minGain}
          min={1}
          onCommit={(v) => setCriteria({ ...criteria, minGain: v })}
        />
        <CriteriaInput
          label="每一步最多新增誤讀＋誤報"
          unit="張"
          help="誤讀會被當成另一個商品。預設 0：會增加誤讀的方法一律不選。"
          value={criteria.maxNewWrong}
          min={0}
          onCommit={(v) => setCriteria({ ...criteria, maxNewWrong: v })}
        />
        <CriteriaInput
          label="平均耗時上限（0 為不限）"
          unit="ms"
          help="加入方法後每張圖的平均耗時超過這個值時不選。"
          value={criteria.maxMeanMs}
          min={0}
          onCommit={(v) => setCriteria({ ...criteria, maxMeanMs: v })}
        />
      </div>
    </Dialog>
  )
}

/** 準則的數字輸入（整數；可暫時清空，失焦或按 Enter 時才套用）。 */
function CriteriaInput({
  label,
  unit,
  help,
  value,
  min,
  onCommit,
}: {
  label: string
  unit: string
  help: string
  value: number
  min: number
  onCommit: (v: number) => void
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-1">
        <DraftNumberInput
          aria-label={label}
          min={min}
          max={9999}
          value={value}
          parse={(t) => parseClampedInt(t, min, 9999)}
          onCommit={onCommit}
        />
        <span className="text-muted w-6 text-xs">{unit}</span>
      </span>
      <span className="text-muted col-span-2 text-xs">{help}</span>
    </label>
  )
}

/** Windows 命令列的引號：路徑含空白或中文時也能整段當成一個參數。 */
const quote = (v: string) => `"${v.replace(/"/g, '')}"`

/**
 * 把原始照片改名（彈窗）：產生 Python 改名工具的指令（research/experiments/e1_barcode/rename_by_truth.py）。
 * 瀏覽器不能改硬碟上的檔案；上傳來源的執行只知道檔名，要使用者填照片所在的資料夾。
 */
function RenameDialog({ data }: { data: Run }) {
  const uploaded = data.meta.source === 'upload'
  const [folder, setFolder] = useState('')
  const base = [
    String.raw`ai\.venv\Scripts\python research\experiments\e1_barcode\rename_by_truth.py`,
    quote(data.path),
    ...(uploaded
      ? ['--folder', folder.trim() ? quote(folder.trim()) : '"<照片所在的資料夾>"']
      : []),
  ].join(' ')
  return (
    <Dialog
      title="把原始照片改名"
      description="依這次確認的真值，用 Python 工具把照片改成條碼號碼。"
      className="max-w-xl"
      trigger={
        <Button size="sm">
          <FilePen className="size-3.5" aria-hidden />
          把原始照片改名
        </Button>
      }
    >
      <div className="space-y-4 text-[13px]">
        <ul className="text-ink-2 list-disc space-y-1 pl-5 text-xs leading-relaxed">
          <li>
            有條碼 → <span className="readout">號碼.jpg</span>（同一個號碼有多張時加 _2、_3）
          </li>
          <li>
            沒有條碼 → <span className="readout">沒有條碼_原檔名</span>
          </li>
          <li>
            只改人工確認過的 {data.images.filter((i) => i.applied?.source === 'manual').length}{' '}
            張；程式推定的與還沒確定的不改（要連程式推定的一起改，在指令後加 --include-auto）。
            不會覆寫既有的檔案。
          </li>
        </ul>
        {uploaded ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold">照片所在的資料夾</span>
            <div className="flex gap-2">
              <input
                aria-label="照片所在的資料夾"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="D:\photos\barcodes"
                className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card readout h-9 min-w-0 flex-1 rounded-xl border px-3 focus-visible:outline-none"
              />
              <FolderPicker value={folder} onPick={setFolder} size="md" />
            </div>
            <span className="text-muted text-xs">
              這次的圖片是上傳的，工具以檔名在這個資料夾裡找到原始照片。
            </span>
          </div>
        ) : (
          <p className="text-muted text-xs">
            這次的圖片來自資料夾 <span className="readout break-all">{data.meta.source}</span>
            ，直接改那裡的檔案。
          </p>
        )}
        <div className="space-y-1.5">
          <p className="font-semibold">在專案根目錄執行（先看預覽）</p>
          <CodeBlock text={base} />
          <p className="font-semibold">預覽無誤後真的改名</p>
          <CodeBlock text={`${base} --apply`} />
          <p className="text-muted text-xs">
            每一筆改名都記在執行資料夾的 rename_log.csv；改錯了把 --apply 換成 --undo 還原。
          </p>
        </div>
      </div>
    </Dialog>
  )
}

/** 匯出推薦流程（彈窗）：可貼到單張檢視的條碼設定匯入。 */
function ExportDialog({ exp }: { exp: NonNullable<Result['export']> }) {
  return (
    <Dialog
      title="匯出推薦流程"
      description="複製後貼到「單張檢視 → 商品條碼」的匯入。"
      trigger={
        <Button size="sm">
          <Download className="size-3.5" aria-hidden />
          匯出推薦流程
        </Button>
      }
    >
      <CodeBlock text={JSON.stringify({ class: exp.class, values: exp.values }, null, 2)} />
      {!exp.exact && (
        <p className="text-muted mt-2 text-xs">
          設定中同一種處理只能出現一次，多尺度與疊加流程已併在第一次出現的位置，順序與推薦略有不同。
        </p>
      )}
    </Dialog>
  )
}

/** 結論：推薦流程、每一步的貢獻、與只用原圖／全部方法的比較。 */
function Conclusion({ result, onGoTruth }: { result: Result | null; onGoTruth: () => void }) {
  if (!result) {
    return (
      <EmptyState icon={<CircleHelp className="size-8" aria-hidden />}>
        還沒有任何「有條碼」的圖片確認了真值，無法計算成功率。
        <Button onClick={onGoTruth}>去確認真值</Button>
      </EmptyState>
    )
  }
  if (result.error || !result.greedy || !result.compare) {
    return <ErrorBox error={new Error(result.error ?? '無法計算')} />
  }
  const g = result.greedy
  const compare = result.compare.summary
  return (
    <>
      <Section title="推薦流程">
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="推薦流程">
          {g.order.map((m, i) => (
            <li key={m} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="text-muted size-4" aria-hidden />}
              <span className="bg-primary-soft text-primary-ink rounded-full px-3.5 py-1.5 text-[13px] font-semibold">
                {methodText(m)}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-muted mt-2 text-xs">
          先試原圖，讀不到才依序換下一個方法。停止原因：{STOP_TEXT[g.stop] ?? g.stop}。
          {g.excluded > 0 && ` 有 ${g.excluded} 張圖因處理錯誤未納入。`}
        </p>
      </Section>
      <Section title="與其他做法比較" className="max-w-3xl">
        <BarList
          label="三種做法的成功率，附 95% 信賴區間"
          rows={compare.map((r) => ({
            label: LADDER_TEXT[r.arm] ?? r.arm,
            value: r.rate,
            low: r.ci_low,
            high: r.ci_high,
          }))}
        />
      </Section>
      <Details summary="每一步的貢獻">
        <DataTable
          label="推薦流程每一步的貢獻"
          columns={[
            '步驟',
            '方法',
            '多救回',
            '新增誤讀',
            '新增誤報',
            '累計讀對',
            '累計成功率',
            '平均耗時 ms',
          ]}
          rows={g.steps.map((s, i) => [
            i + 1,
            methodText(s.method),
            s.rescued,
            s.new_misread,
            s.new_false_positive,
            `${s.correct}／${s.positives}`,
            pct(s.rate),
            s.mean_ms.toFixed(1),
          ])}
        />
      </Details>
      <Details summary="三種做法的詳細數字">
        <DataTable
          label="三種做法的比較"
          columns={[
            '做法',
            '成功率',
            '信賴區間',
            '讀對／有條碼',
            '誤讀',
            '誤報',
            '耗時中位數 ms',
            '對只用原圖 p 值',
          ]}
          rows={compare.map((r) => [
            LADDER_TEXT[r.arm] ?? r.arm,
            pct(r.rate),
            `${pct(r.ci_low)}–${pct(r.ci_high)}`,
            `${r.correct}／${r.n}`,
            r.misread,
            `${r.false_positive}／${r.negatives}`,
            r.median_ms?.toFixed(1) ?? '—',
            r.arm === 'raw' ? '基準' : r.p_value != null ? Number(r.p_value.toPrecision(3)) : '—',
          ])}
        />
        <p className="text-muted mt-2 text-xs">
          信賴區間為 Wilson 95%；p 值為與「只用原圖」配對的 McNemar
          精確檢定。同一個條碼拍多張時圖片不獨立，區間會偏窄，僅供參考。
        </p>
      </Details>
    </>
  )
}

/** 可展開的細節（原生 details：預設收起，鍵盤與螢幕閱讀器都支援）。 */
function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group border-card-border mb-3 rounded-2xl border">
      <summary className="hover:bg-hover focus-visible:ring-primary/40 flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-semibold focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ArrowRight
          className="text-muted size-4 transition-transform group-open:rotate-90"
          aria-hidden
        />
        {summary}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}

/** 單一方法比較：每個方法單獨使用時的成功率，以及相對原圖多讀對、少讀對幾張。 */
function MethodTable({ result }: { result: Result | null }) {
  if (!result) return <EmptyState>確認真值後才能比較。</EmptyState>
  const rows = [...result.methods].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
  return (
    <>
      <p className="text-muted mb-1 text-xs">
        每個方法都從原圖獨立處理一次。「救回」為原圖讀不到、這個方法讀得到的張數；「退步」相反。
        deskew 在傾斜角太小時會略過，單獨的成功率偏低屬正常。
      </p>
      <DataTable
        label="單一方法比較"
        columns={[
          '方法',
          '成功率',
          '讀對／有條碼',
          '救回',
          '退步',
          '誤讀',
          '誤報',
          '耗時中位數 ms',
        ]}
        rows={rows.map((r) => [
          methodText(r.arm),
          pct(r.rate),
          `${r.correct}／${r.n}`,
          r.arm === 'raw' ? '基準' : (r.gained ?? '—'),
          r.arm === 'raw' ? '—' : (r.lost ?? '—'),
          r.misread,
          r.false_positive,
          r.median_ms?.toFixed(1) ?? '—',
        ])}
      />
    </>
  )
}

/** 真值：每張圖的縮圖、推定狀態、候選號碼；可選候選、輸入號碼、標為沒有條碼或改回自動。 */
function TruthTable({
  images,
  onTruth,
  saving,
  saveError,
}: {
  images: ImageRow[]
  onTruth: (truths: Record<string, string | null>) => void
  saving: boolean
  saveError: unknown
}) {
  const [filter, setFilter] = useState<'pending' | 'all'>(
    images.some((i) => !i.applied) ? 'pending' : 'all',
  )
  const shown = filter === 'pending' ? images.filter((i) => !i.applied) : images
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="篩選"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: '未確定' },
            { value: 'all', label: `全部（${images.length}）` },
          ]}
        />
        {saving && <Badge tone="primary">儲存中…</Badge>}
      </div>
      {saveError ? <ErrorBox error={saveError} /> : null}
      {shown.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-8" aria-hidden />}>
          所有圖片都已確定真值，可以到「結論」查看。
        </EmptyState>
      ) : (
        <ul className="space-y-2" aria-label="真值確認">
          {shown.map((img) => (
            <TruthRow key={img.id} img={img} onTruth={onTruth} disabled={saving} />
          ))}
        </ul>
      )}
    </>
  )
}

function TruthRow({
  img,
  onTruth,
  disabled,
}: {
  img: ImageRow
  onTruth: (truths: Record<string, string | null>) => void
  disabled: boolean
}) {
  const [draft, setDraft] = useState('')
  const badge = STATUS_BADGE[img.status]
  const applied = img.applied
  const set = (v: string | null) => onTruth({ [img.id]: v })
  return (
    <li className="border-card-border flex gap-3 rounded-2xl border p-3">
      <div className="bg-sunken flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl">
        {img.thumb_id ? (
          <img
            src={artifactUrl(img.thumb_id)}
            alt={img.id}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-muted text-xs">無縮圖</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="readout truncate font-medium" title={img.image}>
            {img.id}
          </span>
          <Badge tone={badge.tone}>{badge.text}</Badge>
          {applied ? (
            <Badge tone={applied.source === 'manual' ? 'primary' : 'muted'}>
              {applied.truth ? `採用 ${applied.truth}` : '沒有條碼'}
              {applied.source === 'manual' ? '（人工）' : ''}
            </Badge>
          ) : (
            <Badge tone="warn">未確定・不納入統計</Badge>
          )}
        </div>
        {img.error && <p className="text-danger">處理錯誤：{img.error}</p>}
        {img.candidates.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label="候選號碼">
            {img.candidates.map((c) => {
              const on = applied?.truth === c.code
              return (
                <button
                  key={c.code}
                  type="button"
                  disabled={disabled}
                  onClick={() => set(c.code)}
                  title={`讀出的方法：${c.methods.map(methodText).join('、')}`}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-left',
                    on ? 'border-primary bg-primary-soft' : 'border-card-border hover:bg-hover',
                  )}
                >
                  <span className="readout block">{c.code}</span>
                  <span
                    className={cn(
                      'block text-[11px]',
                      c.checksum_ok ? 'text-muted' : 'text-danger',
                    )}
                  >
                    {c.methods.length} 個方法・{c.checksum_ok ? '檢查碼正確' : '檢查碼錯誤'}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-muted">沒有任何方法讀到條碼：請看圖輸入號碼，或標為沒有條碼。</p>
        )}
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.trim()) set(draft)
          }}
        >
          <input
            aria-label={`${img.id} 的條碼`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="輸入條碼號碼"
            inputMode="numeric"
            className="border-card-border bg-sunken focus-visible:border-primary readout h-7 w-40 rounded-lg border px-2 focus-visible:outline-none"
          />
          <Button type="submit" disabled={disabled || !draft.trim()}>
            採用
          </Button>
          <Button type="button" disabled={disabled} onClick={() => set('')}>
            沒有條碼
          </Button>
          {applied?.source === 'manual' && (
            <Button type="button" disabled={disabled} onClick={() => set(null)}>
              <Undo2 className="size-3.5" aria-hidden />
              取消人工確認
            </Button>
          )}
        </form>
      </div>
    </li>
  )
}
