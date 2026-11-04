// 模組一・找最佳流程：放入圖片 → 每個方法都執行 → 確認真值 → 選出最佳的方法與順序。
// 真值推定、判定、貪婪選擇與統計一律由後端（dietai.evaluation.best_flow 與 methods）計算，前端只顯示。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleHelp,
  FolderOpen,
  ListChecks,
  Play,
  Square,
  Trophy,
  Undo2,
  Upload,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { api, artifactUrl, unwrap } from '@/api/client'
import { BarList } from '@/components/charts'
import { CodeBlock } from '@/components/ConfigIO'
import { PanelSection, PanelStack } from '@/components/layout/PanelSections'
import {
  EmptyState,
  MainView,
  ReadoutBlock,
  Section,
  Split,
  Workspace,
} from '@/components/layout/Workspace'
import { DataTable, ErrorBox, Metric, MetricGrid } from '@/components/results'
import { Badge, Button, DraftNumberInput, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { uploadImage } from '@/hooks/useImagePipeline'
import { useStream } from '@/hooks/useStream'
import { cn } from '@/lib/cn'
import { parseClampedInt, progressPercent } from '@/lib/number'
import { methodText } from '@/lib/text'

import { RootInput, Select } from './shared'

// 以下型別是本頁自行宣告的後端回應形狀（規格中為自由 JSON：FreeJson），
// 由 dietai.devtools.best_flow.run_json 產生；欄位改名時這裡不會有型別錯誤提醒。

/** GET /dev/e1/runs：本頁只用找最佳流程的執行清單。 */
interface RunList {
  root: string
  best_flow_runs?: { name: string; path: string }[]
}

/** 一個候選條碼：解出它的方法與檢查碼是否正確。 */
interface Candidate {
  code: string
  methods: string[]
  checksum_ok: boolean
}

/** 真值表的一列。status：auto（自動推定）、review（需確認）、unknown（沒有方法讀到）。 */
interface ImageRow {
  id: string
  image: string
  status: 'auto' | 'review' | 'unknown'
  truth: string
  candidates: Candidate[]
  /** 採用的真值；null 為尚未確定（不納入統計）。truth 空字串表示沒有條碼 */
  applied: { truth: string; source: 'auto' | 'manual' } | null
  error: string
  thumb_id: string
}

/** dietai.evaluation.summarize 的一列（單一方法或一條流程）。 */
interface Summary {
  arm: string
  n: number
  correct: number
  rate: number | null
  ci_low: number | null
  ci_high: number | null
  misread: number
  missed: number
  negatives: number
  false_positive: number
  errors: number
  median_ms: number | null
  lost?: number
  gained?: number
  p_value?: number
}

/** 貪婪選擇的一步：加入這個方法多救回幾張、新增幾張誤讀／誤報，以及加入後的累計結果。 */
interface Step {
  method: string
  rescued: number
  new_misread: number
  new_false_positive: number
  correct: number
  positives: number
  misread: number
  false_positive: number
  rate: number | null
  mean_ms: number
}

interface Result {
  methods: Summary[]
  error?: string
  greedy?: {
    order: string[]
    stop: 'min_gain' | 'constraints' | 'exhausted'
    excluded: number
    steps: Step[]
  }
  compare?: { orders: Record<string, string[]>; summary: Summary[] }
  export?: { class: string; values: Record<string, unknown>; exact: boolean }
  errors?: number
}

/** GET /dev/best-flow/runs/{run_id}：真值表與結論。 */
interface Run {
  name: string
  path: string
  meta: { created: string; source: string; images: number; min_methods: number }
  counts: {
    images: number
    decided: number
    undecided: number
    positives: number
    negatives: number
    auto: number
    review: number
    unknown: number
  }
  images: ImageRow[]
  result: Result | null
}

/** 執行的 SSE 事件：start → 多筆 progress → done（帶新執行的名稱）。 */
type RunEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; name: string; path: string }

/** 貪婪選擇的準則；maxMeanMs 為 0 表示不限。 */
interface Criteria {
  minGain: number
  maxNewWrong: number
  maxMeanMs: number
}

const STOP_TEXT: Record<string, string> = {
  min_gain: '下一個方法能多救回的張數低於下限',
  constraints: '剩下的方法都會增加誤讀／誤報，或超過耗時上限',
  exhausted: '所有方法都已加入',
}

/** 比較的三條流程。 */
const LADDER_TEXT: Record<string, string> = {
  raw: '只用原圖',
  greedy: '推薦流程',
  all: '全部方法依序都試',
}

const STATUS_BADGE: Record<ImageRow['status'], { tone: 'ok' | 'warn' | 'danger'; text: string }> = {
  auto: { tone: 'ok', text: '自動' },
  review: { tone: 'warn', text: '需確認' },
  unknown: { tone: 'danger', text: '未知' },
}

/** 一次最多上傳幾張（後端上限為 500；暫存區有容量上限，大量圖片請改用資料夾）。 */
const MAX_UPLOADS = 200

/** 比例轉百分比字串（一位小數）；null 顯示「—」。 */
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

/** 查詢參數：準則只送與預設值不同的部分（0 表示不限的耗時不送）。 */
function criteriaQuery(root: string, c: Criteria) {
  return {
    ...(root ? { root } : {}),
    ...(c.minGain !== 1 ? { min_gain: c.minGain } : {}),
    ...(c.maxNewWrong !== 0 ? { max_new_wrong: c.maxNewWrong } : {}),
    ...(c.maxMeanMs > 0 ? { max_mean_ms: c.maxMeanMs } : {}),
  }
}

/**
 * 找最佳流程（實驗結果頁的預設模式）。
 * 左側：圖片（上傳或資料夾）與執行、選擇準則、過去的執行。右側：結論、真值確認、單一方法比較。
 */
export function BestFlow({
  switcher,
  root,
  setRoot,
  debouncedRoot,
}: {
  switcher: ReactNode
  root: string
  setRoot: (v: string) => void
  debouncedRoot: string
}) {
  const qc = useQueryClient()
  const [source, setSource] = useState<'upload' | 'folder'>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [folder, setFolder] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [criteria, setCriteria] = useState<Criteria>({ minGain: 1, maxNewWrong: 0, maxMeanMs: 0 })
  // 使用者選的執行；不在目前清單中時改用最新的一次
  const [runName, setRunName] = useState<string | null>(null)
  // 上傳進度（上傳完才開始執行）；null 表示沒有在上傳
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [uploadError, setUploadError] = useState<unknown>(null)
  const stream = useStream<RunEvent>('/workbench/v1/dev/best-flow/runs')

  const list = useQuery({
    queryKey: ['e1-runs', debouncedRoot],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/dev/e1/runs', {
          params: { query: debouncedRoot ? { root: debouncedRoot } : {} },
          signal,
        }),
      ) as Promise<unknown> as Promise<RunList>,
  })
  const runs = list.data?.best_flow_runs ?? []
  const current = runs.some((r) => r.name === runName) ? runName : (runs[0]?.name ?? null)

  const runKey = ['best-flow-run', debouncedRoot, current, criteria]
  const run = useQuery({
    queryKey: runKey,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/dev/best-flow/runs/{run_id}', {
          params: { path: { run_id: current! }, query: criteriaQuery(debouncedRoot, criteria) },
          signal,
        }),
      ) as Promise<unknown> as Promise<Run>,
    enabled: !!current,
    // 換準則時保留上一份結果，避免畫面閃成「載入中」
    placeholderData: (prev) => prev,
  })

  // 確認真值：回應即更新後的結果，直接寫回快取；其他準則下的快取一併失效
  const setTruth = useMutation({
    mutationFn: (truths: Record<string, string | null>) =>
      unwrap(
        api.PUT('/workbench/v1/dev/best-flow/runs/{run_id}/truth', {
          params: { path: { run_id: current! }, query: criteriaQuery(debouncedRoot, criteria) },
          body: { truths },
        }),
      ) as Promise<unknown> as Promise<Run>,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['best-flow-run', debouncedRoot, current] })
      qc.setQueryData(runKey, data)
    },
  })

  const busy = stream.status === 'running' || uploading !== null
  const start = async () => {
    setUploadError(null)
    const onEvent = (e: RunEvent) => {
      if (e.type === 'done') {
        setRunName(e.name)
        void qc.invalidateQueries({ queryKey: ['e1-runs'] })
      }
    }
    if (source === 'folder') {
      void stream.run({ folder, recursive, root: root || undefined }, onEvent)
      return
    }
    // 逐張上傳到暫存區，取得 image_id 後才開始執行
    const ids: string[] = []
    setUploading({ done: 0, total: files.length })
    try {
      for (const f of files) {
        ids.push((await uploadImage(f)).image_id)
        setUploading({ done: ids.length, total: files.length })
      }
    } catch (err) {
      setUploadError(err)
      return
    } finally {
      setUploading(null)
    }
    void stream.run({ image_ids: ids, root: root || undefined }, onEvent)
  }
  const progress = [...stream.events].reverse().find((e) => e.type === 'progress')
  const canStart = source === 'folder' ? folder.trim() !== '' : files.length > 0

  const panel = (
    <PanelStack>
      <PanelSection title="1. 放入圖片">
        <div className="space-y-3 text-sm">
          <Segmented
            label="圖片來源"
            value={source}
            onChange={setSource}
            options={[
              { value: 'upload', label: withIcon(Upload, '上傳') },
              { value: 'folder', label: withIcon(FolderOpen, '資料夾') },
            ]}
            className="w-full"
          />
          {source === 'upload' ? (
            // 原生檔案欄位的按鈕文字隨瀏覽器語系（例如 Choose Files），改以中文的 label 當按鈕
            <label className="flex flex-col gap-1">
              <span className="text-muted text-xs">可多選，最多 {MAX_UPLOADS} 張</span>
              <input
                aria-label="選擇圖片"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_UPLOADS))}
                className="peer sr-only"
              />
              <span className="bg-sunken hover:bg-hover peer-focus-visible:ring-primary/40 flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full text-[13px] font-medium peer-focus-visible:ring-2">
                <Upload className="size-4" aria-hidden />
                {files.length > 0 ? `已選 ${files.length} 張，重新選擇` : '選擇圖片'}
              </span>
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs">資料夾（伺服器本機路徑）</span>
                <input
                  aria-label="圖片資料夾"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="D:\photos\barcodes"
                  className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card readout h-7 rounded-lg border px-2 text-xs focus-visible:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(e) => setRecursive(e.target.checked)}
                  className="accent-primary"
                />
                包含子資料夾
              </label>
            </>
          )}
          {busy ? (
            <>
              <Button className="w-full" onClick={stream.cancel} disabled={uploading !== null}>
                <Square className="size-4" aria-hidden />
                停止
              </Button>
              <div
                role="progressbar"
                aria-valuenow={progress?.type === 'progress' ? progress.done : 0}
                aria-valuemax={progress?.type === 'progress' ? progress.total : undefined}
              >
                <div className="text-muted mb-1 text-xs">
                  {uploading
                    ? `上傳中 ${uploading.done} / ${uploading.total}`
                    : progress?.type === 'progress'
                      ? `每個方法都執行中 ${progress.done} / ${progress.total} 張`
                      : '準備中…'}
                </div>
                <div className="bg-hover h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-all"
                    style={{
                      width: `${
                        uploading
                          ? progressPercent(uploading.done, uploading.total)
                          : progress?.type === 'progress'
                            ? progressPercent(progress.done, progress.total)
                            : 5
                      }%`,
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <Button
              variant="primary"
              className="w-full"
              disabled={!canStart}
              onClick={() => void start()}
            >
              <Play className="size-4" aria-hidden />
              開始比較
            </Button>
          )}
          <p className="text-muted text-xs">
            每張圖都會用全部前處理方法（含多尺度與疊加流程）各解碼一次，再依條碼推定真值。
            不要放測試集的圖片（規則 7）。
          </p>
          {stream.error ? <ErrorBox error={stream.error} /> : null}
          {uploadError ? <ErrorBox error={uploadError} /> : null}
        </div>
      </PanelSection>
      <PanelSection title="2. 選擇準則">
        <div className="space-y-2 text-xs">
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
            help="誤讀會被當成另一個商品，預設 0：會增加誤讀的方法一律不選。"
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
      </PanelSection>
      <PanelSection title="過去的執行">
        <RootInput value={root} onChange={setRoot} placeholder={list.data?.root} />
        <Select
          label="執行"
          value={current ?? ''}
          onChange={setRunName}
          options={runs.map((r) => ({ value: r.name, label: r.name }))}
          empty="尚無執行結果"
        />
      </PanelSection>
    </PanelStack>
  )

  return (
    <Workspace
      panel={panel}
      title="找最佳流程"
      description="放入圖片，比較各種前處理方法與流程，選出讀得最多、不增加誤讀的方法與順序。"
      aside={
        <div className="flex items-center gap-2">
          {busy && (
            <Badge tone="primary" aria-live="polite">
              執行中…
            </Badge>
          )}
          {switcher}
        </div>
      }
    >
      {list.error ? (
        <div className="p-4">
          <ErrorBox error={list.error} />
        </div>
      ) : !current ? (
        list.isLoading ? (
          <EmptyState>載入中…</EmptyState>
        ) : (
          <Intro />
        )
      ) : run.error ? (
        <div className="p-4">
          <ErrorBox error={run.error} />
        </div>
      ) : !run.data ? (
        <EmptyState>載入中…</EmptyState>
      ) : (
        <RunView
          key={run.data.name}
          data={run.data}
          onTruth={(truths) => setTruth.mutate(truths)}
          saving={setTruth.isPending}
          saveError={setTruth.error}
        />
      )}
    </Workspace>
  )
}

/** 準則的數字輸入（整數；可暫時清空，失焦時才套用）。 */
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
    <label className="flex items-center justify-between gap-2" title={help}>
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1">
        <DraftNumberInput
          aria-label={label}
          min={min}
          max={9999}
          value={value}
          parse={(t) => parseClampedInt(t, min, 9999)}
          onCommit={onCommit}
        />
        <span className="text-muted w-5">{unit}</span>
      </span>
    </label>
  )
}

/** 還沒有任何執行時的說明：三個步驟。 */
function Intro() {
  const steps = [
    ['放入圖片', '在左側上傳條碼照片，或填入照片所在的資料夾，按「開始比較」。'],
    [
      '確認真值',
      '多數圖片會自動推定條碼；方法之間讀出不同號碼、或都讀不到的圖片，請在「真值確認」選擇或輸入。',
    ],
    [
      '看結論',
      '程式依序挑出能多讀對最多張、且不增加誤讀的方法，列出推薦流程與每一步的貢獻，可匯出設定。',
    ],
  ]
  return (
    <div className="flex h-full items-center justify-center p-6">
      <ol className="grid max-w-3xl gap-3 md:grid-cols-3">
        {steps.map(([title, text], i) => (
          <li key={title} className="bg-card shadow-card rounded-[20px] p-5">
            <div className="text-primary-ink mb-1 text-xs font-semibold">步驟 {i + 1}</div>
            <div className="mb-1 font-semibold">{title}</div>
            <p className="text-muted text-xs leading-relaxed">{text}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * 一次執行：讀數欄（真值狀態、匯出）＋主檢視三個分頁（結論、真值確認、單一方法）。
 * 父層以 key={data.name} 掛載，換執行時分頁與篩選重置。
 */
function RunView({
  data,
  onTruth,
  saving,
  saveError,
}: {
  data: Run
  onTruth: (truths: Record<string, string | null>) => void
  saving: boolean
  saveError: unknown
}) {
  const c = data.counts
  // 有未定的圖片時先帶到真值確認
  const [tab, setTab] = useState(c.undecided > 0 && !data.result ? 'truth' : 'result')
  const result = data.result

  const readout = (
    <>
      {c.undecided > 0 && (
        <div
          role="alert"
          className="bg-warn-soft text-warn shrink-0 rounded-[20px] px-4 py-3 text-xs"
        >
          有 {c.undecided}{' '}
          張圖片尚未確認真值，沒有納入統計。這些多半是方法讀不出來或讀法不一致的難題，
          不確認的話成功率會偏高。
        </div>
      )}
      <ReadoutBlock title="真值">
        <MetricGrid>
          <Metric label="圖片" value={String(c.images)} />
          <Metric
            label="已確定"
            value={String(c.decided)}
            delta={`有條碼 ${c.positives}・沒有 ${c.negatives}`}
          />
          <Metric label="自動推定" value={String(c.auto)} />
          <Metric
            label="待確認"
            value={String(c.undecided)}
            good={c.undecided === 0}
            delta={`需確認 ${c.review}・未知 ${c.unknown}`}
          />
        </MetricGrid>
        <p className="text-muted mt-2 text-xs">
          至少 {data.meta.min_methods} 個方法讀出相同且檢查碼正確的號碼，就自動採用。
        </p>
      </ReadoutBlock>
      {result?.export && (
        <ReadoutBlock title="匯出推薦流程">
          <CodeBlock
            text={JSON.stringify(
              { class: result.export.class, values: result.export.values },
              null,
              2,
            )}
          />
          <p className="text-muted mt-2 text-xs">
            可貼到「單張檢視 → 商品條碼」的匯入。
            {!result.export.exact &&
              ' 設定中同一種處理只能出現一次，多尺度與疊加流程已併在第一次出現的位置，順序與推薦略有不同。'}
          </p>
        </ReadoutBlock>
      )}
      <ReadoutBlock title="這次執行">
        <p className="readout text-xs break-all">{data.name}</p>
        <p className="text-muted mt-1 text-xs break-all">
          來源：{data.meta.source === 'upload' ? '上傳' : data.meta.source}
        </p>
        <p className="text-muted mt-2 text-xs">
          推薦流程是在這批圖片上選出來的；要寫成結論，請另外用鎖定的測試集驗證。
        </p>
      </ReadoutBlock>
    </>
  )

  return (
    <Split
      readout={readout}
      main={
        <MainView
          scroll
          toolbar={
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
                    c.undecided > 0 ? `真值確認（${c.undecided}）` : '真值確認',
                  ),
                },
                { value: 'methods', label: withIcon(BarChart3, '單一方法') },
              ]}
            />
          }
        >
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
        </MainView>
      }
    />
  )
}

/** 結論：推薦流程、每一步的貢獻、與只用原圖／全部方法的比較。 */
function Conclusion({ result, onGoTruth }: { result: Result | null; onGoTruth: () => void }) {
  if (!result) {
    return (
      <EmptyState icon={<CircleHelp className="size-8" aria-hidden />}>
        還沒有任何「有條碼」的圖片確認了真值，無法計算成功率。
        <Button onClick={onGoTruth}>前往真值確認</Button>
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
              {i > 0 && <ArrowRight className="text-muted size-3.5" aria-hidden />}
              <span className="bg-primary-soft text-primary-ink rounded-full px-3 py-1 text-xs font-medium">
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
      <Section title="每一步的貢獻">
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
      </Section>
      <Section title="與其他做法比較">
        <BarList
          label="三種做法的成功率，附 95% 信賴區間"
          rows={compare.map((r) => ({
            label: LADDER_TEXT[r.arm] ?? r.arm,
            value: r.rate,
            low: r.ci_low,
            high: r.ci_high,
          }))}
        />
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
          精確檢定。同一個條碼拍多張時圖片不獨立， 區間會偏窄，僅供參考。
        </p>
      </Section>
    </>
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

/** 真值確認：每張圖的縮圖、推定狀態、候選號碼；可選候選、輸入號碼、標為沒有條碼或改回自動。 */
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
