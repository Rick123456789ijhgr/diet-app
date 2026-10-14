// 模組一：E1 條碼消融。各實驗組的成功率與信賴區間、依拍攝條件分組、成功階、失敗影像
// （research/experiments/e1_barcode）。統計一律由後端（dietai.evaluation）計算。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  FlaskConical,
  Grid3x3,
  ImageOff,
  Layers,
  Lock,
  Play,
  Square,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, artifactUrl, unwrap } from '@/api/client'
import { BarList, Heatmap, StackedBars } from '@/components/charts'
import { ImageViewer } from '@/components/ImageViewer'
import { EmptyState, PageHeader, Section, Workspace } from '@/components/layout/Workspace'
import { DataTable, ErrorBox, Metric, MetricGrid } from '@/components/results'
import {
  Badge,
  Button,
  Card,
  Segmented,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalImage } from '@/hooks/useLocalImage'
import { useStream } from '@/hooks/useStream'
import { cn } from '@/lib/cn'
import { outcomeText, rungText } from '@/lib/text'

interface RunList {
  root: string
  runs: { name: string; path: string }[]
  arms: string[]
  default_arms: string[]
}

interface Summary {
  arm: string
  n: number
  correct: number
  rate: number | null
  ci_low: number | null
  ci_high: number | null
  misread: number
  missed: number
  false_positive: number
  errors: number
  median_ms: number | null
  mean_attempts: number | null
  p_value?: number
  [tag: string]: unknown
}

interface Failure {
  id: string
  arm: string
  outcome: string
  truth: string
  decoded: string
  success_rung: string
  error: string
  image: string
  [tag: string]: string
}

interface Run {
  name: string
  meta: {
    items: number
    include_test: boolean
    duration_s: number
    git: { commit?: string; dirty?: boolean }
  }
  arms: string[]
  tags: string[]
  overall: Record<string, Summary[]>
  by_tag: Record<string, Summary[]>
  rescues: { arm: string; rung: string; count: number }[]
  failures: Failure[]
  attempts: Record<string, string>[]
}

type E1Event =
  | { type: 'start'; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; name: string; path: string }

const FAILURE_KINDS = ['misread', 'missed', 'false_positive', 'error']
const RUNG_ORDER = ['raw', 'gray', 'binarize', 'sharpen', 'denoise', 'deskew', 'multiscale']

export function E1Page() {
  const qc = useQueryClient()
  const [root, setRoot] = useState('')
  const debouncedRoot = useDebounced(root, 400)
  const [runName, setRunName] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<string | null>(null)
  const [group, setGroup] = useState('')
  const [picked, setPicked] = useState<string[] | null>(null)
  const [nCodes, setNCodes] = useState(2)
  const stream = useStream<E1Event>('/workbench/v1/dev/e1/runs')

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
  const runs = list.data?.runs ?? []
  // 換了資料夾（或原本沒有結果）時，選取值不在清單中：改選最新的一次
  const current = runs.some((r) => r.name === runName) ? runName : (runs[0]?.name ?? null)

  const run = useQuery({
    queryKey: ['e1-run', debouncedRoot, current],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/dev/e1/runs/{run_id}', {
          params: {
            path: { run_id: current! },
            query: debouncedRoot ? { root: debouncedRoot } : {},
          },
          signal,
        }),
      ) as Promise<unknown> as Promise<Run>,
    enabled: !!current,
    staleTime: Infinity,
  })
  const data = run.data
  const base = data && baseline && data.arms.includes(baseline) ? baseline : data?.arms[0]
  const arms = picked ?? list.data?.default_arms ?? []

  const quickRun = () =>
    void stream.run({ arms, n_codes: nCodes, root: debouncedRoot || undefined }, (e) => {
      if (e.type === 'done') {
        setRunName(e.name)
        void qc.invalidateQueries({ queryKey: ['e1-runs'] })
      }
    })
  const progress = [...stream.events].reverse().find((e) => e.type === 'progress')

  const panel = (
    <Tabs defaultValue="runs">
      <TabsList className="mb-4">
        <TabsTrigger value="runs">執行結果</TabsTrigger>
        <TabsTrigger value="quick">快速執行</TabsTrigger>
      </TabsList>
      <TabsContent value="runs" className="space-y-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">結果資料夾（空白為預設）</span>
          <input
            aria-label="結果資料夾"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder={list.data?.root ?? 'research/experiments/e1_barcode/runs'}
            className="border-card-border bg-card h-8 rounded-md border px-2"
          />
        </label>
        <Select
          label="執行"
          value={current ?? ''}
          onChange={setRunName}
          options={runs.map((r) => ({ value: r.name, label: r.name }))}
          empty="尚無執行結果"
        />
        {data && (
          <>
            <Select
              label="基準實驗組"
              help="McNemar 檢定的比較對象。"
              value={base ?? ''}
              onChange={setBaseline}
              options={data.arms.map((a) => ({ value: a, label: a }))}
            />
            <Select
              label="分組條件"
              value={group}
              onChange={setGroup}
              options={[
                { value: '', label: '（不分組）' },
                ...data.tags.map((t) => ({ value: t, label: t })),
              ]}
            />
          </>
        )}
      </TabsContent>
      <TabsContent value="quick" className="space-y-3 text-sm">
        <p className="text-muted text-xs">
          以合成條碼產生資料（寫到
          e1_barcode/synthetic/）並執行選取的實驗組，結果存到「執行結果」的資料夾。
          合成資料只供驗證流程與觀察趨勢，不可作為結論。
        </p>
        <fieldset>
          <legend className="text-muted mb-1 text-xs">實驗組</legend>
          <div className="flex flex-wrap gap-1.5">
            {(list.data?.arms ?? []).map((a) => {
              const on = arms.includes(a)
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(on ? arms.filter((x) => x !== a) : [...arms, a])}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs',
                    on
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-card-border text-muted hover:bg-hover',
                  )}
                >
                  {a}
                </button>
              )
            })}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted">條碼數</span>
          <input
            aria-label="條碼數"
            type="number"
            min={1}
            max={20}
            value={nCodes}
            onChange={(e) => setNCodes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            className="border-card-border bg-card h-7 w-16 rounded-md border px-2 text-right"
          />
        </label>
        {stream.status === 'running' ? (
          <>
            <Button className="w-full" onClick={stream.cancel}>
              <Square className="size-4" aria-hidden />
              停止
            </Button>
            <div
              role="progressbar"
              aria-valuenow={progress?.type === 'progress' ? progress.done : 0}
            >
              <div className="text-muted mb-1 text-xs">
                {progress?.type === 'progress'
                  ? `執行中 ${progress.done} / ${progress.total}`
                  : '產生合成資料中…'}
              </div>
              <div className="bg-hover h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full transition-all"
                  style={{
                    width: `${progress?.type === 'progress' ? (progress.done / progress.total) * 100 : 5}%`,
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            disabled={arms.length === 0}
            onClick={quickRun}
          >
            <Play className="size-4" aria-hidden />
            執行
          </Button>
        )}
        {stream.status === 'done' && (
          <p className="text-primary text-xs">完成，已切換到新的執行結果。</p>
        )}
        {stream.error ? <ErrorBox error={stream.error} /> : null}
      </TabsContent>
    </Tabs>
  )

  return (
    <Workspace panel={panel}>
      <PageHeader
        title="E1 條碼消融"
        description="各實驗組的成功率與信賴區間、依拍攝條件分組、成功階與失敗影像（research/experiments/e1_barcode）。"
      />
      {list.error ? (
        <ErrorBox error={list.error} />
      ) : !current ? (
        <EmptyState icon={<FlaskConical className="size-8" aria-hidden />}>
          {list.isLoading
            ? '載入中…'
            : '尚無執行結果：在左側「快速執行」，或在終端機執行 make e1-synthetic。'}
        </EmptyState>
      ) : run.error ? (
        <ErrorBox error={run.error} />
      ) : !data || !base ? (
        <EmptyState>載入中…</EmptyState>
      ) : (
        // 換一次執行時重新建立，避免沿用前一次的選取（例如新執行沒有的實驗組）
        <RunView key={data.name} data={data} base={base} group={group} />
      )}
    </Workspace>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
  empty,
  help,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  empty?: string
  help?: string
}) {
  return (
    <label className="flex flex-col gap-1" title={help}>
      <span className="text-muted text-xs">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
        className="border-card-border bg-card h-8 rounded-md border px-2"
      >
        {options.length === 0 && <option>{empty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

function RunView({ data, base, group }: { data: Run; base: string; group: string }) {
  const [tab, setTab] = useState('overall')
  const overall = data.overall[base] ?? []
  const misreads = overall.reduce((a, r) => a + r.misread, 0)
  const git = data.meta.git
  return (
    <>
      <MetricGrid>
        <Metric label="影像" value={String(data.meta.items)} />
        <Metric label="實驗組" value={String(data.arms.length)} />
        <Metric label="耗時" value={`${data.meta.duration_s.toFixed(1)} s`} />
        <Metric
          label="版本"
          value={String(git.commit ?? '?').slice(0, 8)}
          delta={git.dirty ? '有未提交變更' : '乾淨'}
          help="執行時的 git commit；有未提交變更表示結果可能無法由該版本重現。"
        />
      </MetricGrid>
      {data.meta.include_test && (
        <p className="text-accent mb-3 flex items-center gap-1.5 text-sm">
          <Lock className="size-4" aria-hidden />
          此執行納入測試集（正式實驗），失敗影像不提供檢視。
        </p>
      )}
      {misreads > 0 && (
        <p
          role="alert"
          className="border-danger/40 bg-danger-soft text-danger mb-3 rounded-lg border px-4 py-2 text-sm"
        >
          共有 {misreads}{' '}
          次誤讀（檢查碼正確但內容錯誤）：會被當成另一個商品，比漏讀更危險。請在「失敗影像」檢視。
        </p>
      )}
      <Section title="檢視">
        <Segmented
          label="檢視"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overall', label: withIcon(BarChart3, '整體成功率') },
            { value: 'group', label: withIcon(Grid3x3, '依條件分組') },
            { value: 'rung', label: withIcon(Layers, '成功階') },
            { value: 'fail', label: withIcon(ImageOff, '失敗影像') },
          ]}
          className="mb-3"
        />
        <Card className="p-3">
          {tab === 'overall' ? (
            <>
              <BarList
                label="各實驗組的整體成功率長條圖，附 95% 信賴區間"
                rows={overall.map((r) => ({
                  label: r.arm,
                  value: r.rate,
                  low: r.ci_low,
                  high: r.ci_high,
                }))}
              />
              <p className="text-muted text-xs">
                誤差線為 Wilson 95% 信賴區間；p 值為對基準組 {base} 的 McNemar 精確檢定。
              </p>
              <DataTable
                label="各實驗組的整體彙整"
                columns={[
                  '實驗組',
                  '成功率',
                  '信賴區間',
                  '正確／正樣本',
                  '誤讀',
                  '漏讀',
                  '耗時中位數 ms',
                  '平均嘗試',
                  'McNemar p 值',
                ]}
                rows={overall.map((r) => [
                  r.arm,
                  pct(r.rate),
                  `${pct(r.ci_low)}–${pct(r.ci_high)}`,
                  `${r.correct}／${r.n}`,
                  r.misread,
                  r.missed,
                  r.median_ms?.toFixed(1) ?? '—',
                  r.mean_attempts?.toFixed(2) ?? '—',
                  r.arm === base
                    ? '基準'
                    : r.p_value != null
                      ? Number(r.p_value.toPrecision(3))
                      : '—',
                ])}
              />
            </>
          ) : tab === 'group' ? (
            !group ? (
              <EmptyState>在左側「執行結果」選擇分組條件。</EmptyState>
            ) : (
              <GroupView data={data} group={group} />
            )
          ) : tab === 'rung' ? (
            data.rescues.length === 0 ? (
              <EmptyState>沒有成功的影像。</EmptyState>
            ) : (
              <>
                <p className="text-muted mb-2 text-xs">
                  各階由原圖獨立產生，因此成功階就是救回該影像的步驟。
                </p>
                <StackedBars
                  label="各實驗組成功於各階的影像數"
                  keys={RUNG_ORDER.filter((r) => data.rescues.some((x) => x.rung === r))}
                  keyLabel={rungText}
                  rows={data.arms.map((arm) => ({
                    label: arm,
                    values: Object.fromEntries(
                      data.rescues.filter((x) => x.arm === arm).map((x) => [x.rung, x.count]),
                    ),
                  }))}
                />
              </>
            )
          ) : (
            <Failures data={data} />
          )}
        </Card>
      </Section>
    </>
  )
}

function GroupView({ data, group }: { data: Run; group: string }) {
  const rows = (data.by_tag[group] ?? []).filter((r) => r.n > 0)
  const cols = [...new Set(rows.map((r) => String(r[group])))]
  return (
    <Heatmap
      label={`實驗組與 ${group} 的成功率熱度圖`}
      rows={data.arms}
      cols={cols}
      value={(arm, col) => {
        const r = rows.find((x) => x.arm === arm && String(x[group]) === col)
        return (
          r && {
            rate: r.rate,
            title: `${arm}・${group}=${col}：${pct(r.rate)}（${r.correct}／${r.n}，誤讀 ${r.misread}）`,
          }
        )
      }}
    />
  )
}

function Failures({ data }: { data: Run }) {
  const [arm, setArm] = useState(data.arms[data.arms.length - 1]!)
  const [kinds, setKinds] = useState(FAILURE_KINDS)
  const [selected, setSelected] = useState<Failure | null>(null)
  useEffect(() => setSelected(null), [arm, kinds])
  const failed = data.failures.filter((f) => f.arm === arm && kinds.includes(f.outcome))
  const attempts = selected
    ? data.attempts.filter((a) => a.id === selected.id && a.arm === arm)
    : []
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select
          label="實驗組"
          value={arm}
          onChange={setArm}
          options={data.arms.map((a) => ({ value: a, label: a }))}
        />
        <div className="flex flex-wrap gap-1.5 self-end">
          {FAILURE_KINDS.map((k) => {
            const on = kinds.includes(k)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs',
                  on ? 'border-danger bg-danger-soft text-danger' : 'border-card-border text-muted',
                )}
              >
                {outcomeText(k)}
              </button>
            )
          })}
        </div>
      </div>
      {failed.length === 0 ? (
        <EmptyState>這個實驗組沒有符合條件的失敗影像。</EmptyState>
      ) : (
        <>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm" aria-label="失敗影像清單">
              <thead className="bg-card sticky top-0">
                <tr className="text-muted border-card-border border-b text-left text-xs">
                  {['影像', '結果', '真值', '解出', '成功階', ...data.tags].map((c) => (
                    <th key={c} className="py-2 pr-3 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {failed.map((f) => (
                  <tr
                    key={f.id}
                    onClick={() => setSelected(f)}
                    aria-selected={selected?.id === f.id}
                    className={cn(
                      'border-card-border tabular cursor-pointer border-b last:border-0',
                      selected?.id === f.id ? 'bg-primary-soft' : 'hover:bg-hover',
                    )}
                  >
                    <td className="py-1.5 pr-3 font-mono text-xs">{f.id}</td>
                    <td className="pr-3">
                      <Badge tone={f.outcome === 'missed' ? 'accent' : 'danger'}>
                        {outcomeText(f.outcome)}
                      </Badge>
                    </td>
                    <td className="pr-3 font-mono text-xs">{f.truth || '（負樣本）'}</td>
                    <td className="pr-3 font-mono text-xs">{f.decoded || '—'}</td>
                    <td className="pr-3">{f.success_rung ? rungText(f.success_rung) : '—'}</td>
                    {data.tags.map((t) => (
                      <td key={t} className="pr-3 text-xs">
                        {f[t]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? (
            <div className="border-card-border mt-4 grid gap-4 border-t pt-4 lg:grid-cols-[3fr_2fr]">
              {data.meta.include_test ? (
                <EmptyState icon={<Lock className="size-6" aria-hidden />}>
                  測試集已鎖定，不提供影像檢視。
                </EmptyState>
              ) : (
                <FailureImage path={selected.image} id={selected.id} />
              )}
              <DataTable
                label="這張影像每一階的嘗試紀錄"
                columns={Object.keys(attempts[0] ?? {}).filter((c) => c !== 'id' && c !== 'arm')}
                rows={attempts.map((a) =>
                  Object.entries(a)
                    .filter(([k]) => k !== 'id' && k !== 'arm')
                    .map(([k, v]) => (k === 'rung' ? rungText(v) : v)),
                )}
              />
            </div>
          ) : (
            <p className="text-muted mt-3 text-xs">點選表格列以檢視影像與每一階的嘗試。</p>
          )}
        </>
      )}
    </>
  )
}

function FailureImage({ path, id }: { path: string; id: string }) {
  const image = useLocalImage(path)
  if (image.error) return <ErrorBox error={image.error} />
  if (!image.data) return <EmptyState>載入中…</EmptyState>
  return (
    <ImageViewer
      src={artifactUrl(image.data.image_id)}
      width={image.data.width}
      height={image.data.height}
      alt={`失敗影像 ${id}`}
      onError={() => void image.refetch()}
    />
  )
}
