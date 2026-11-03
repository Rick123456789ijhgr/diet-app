// 模組一・實驗結果：E1 規則式自適應策略（ADR 0005 後續 6）。依品質量測值排出嘗試順序的策略，與貪婪選出的
// 逐步升級比較成功率與耗時。資料來自「每個方法都執行」的結果（run_methods.py）與 features.csv
// （adaptive.py）；模擬與統計一律由後端（dietai.evaluation）計算，前端不重算。
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Gauge, ListOrdered, Rows3, SlidersHorizontal, Terminal } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { api, unwrap } from '@/api/client'
import { BarList, Heatmap } from '@/components/charts'
import { PanelSection } from '@/components/layout/PanelSections'
import { EmptyState, MainView, ReadoutBlock, Split, Workspace } from '@/components/layout/Workspace'
import { DataTable, ErrorBox, Metric, MetricGrid } from '@/components/results'
import { Badge, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { featureText, methodText, outcomeText } from '@/lib/text'

import { RootInput, Select } from './shared'

// 以下型別是本頁自行宣告的後端回應形狀（E1 路由的回應在規格中是自由 JSON：FreeJson），
// 由 dietai.devtools.e1.list_runs_json 與 dietai.devtools.adaptive.adaptive_run_json 產生。

/** GET /dev/e1/runs：本頁只用「每個方法都執行」的清單；features 為是否已量測品質。 */
interface RunList {
  root: string
  method_runs: { name: string; path: string; features: boolean }[]
}

/** 一個策略或基準的整體彙整（dietai.evaluation.summarize）；rate 等在 n = 0 時為 null。 */
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
  p_value?: number
}

interface Rule {
  feature: string
  op: '<' | '>'
  threshold: number
  methods: string[]
  note?: string
  hits: number
  rate: number | null
}

/** 一個變體在策略下的結果；索引簽章容納拍攝條件欄位與各量測值。 */
interface Variant {
  id: string
  truth: string
  outcome: string
  success_rung: string
  plan: string
  rules: string
  attempts: number
  elapsed_ms: number
  [key: string]: string | number
}

/** 一個策略；策略用到結果表沒有的方法時只有 error。source：configs/adaptive（config）或執行資料夾內調整後（run）。 */
interface Policy {
  name: string
  description: string
  source: 'config' | 'run'
  start: string[]
  fallback: string[]
  max_attempts: number
  error?: string
  rules: Rule[]
  overall?: Summary[]
  timing?: { arm: string; n: number; mean_ms: number; total_s: number; mean_attempts: number }[]
  plans?: { plan: string; count: number }[]
  variants?: Variant[]
  truncated?: boolean
}

/** 依量測值四分位分組的各方法成功率（dietai.evaluation.feature_bins）；方法代碼為鍵。 */
type Bin = { bin: number; low: number; high: number; n: number } & Record<string, number | null>

interface ArmResult {
  arm: string
  methods: string[]
  baseline: { name: string; order: string[] } | null
  policies: Policy[]
  bins: Record<string, Bin[]>
}

/** GET /dev/e1/runs/{run_id}（「每個方法都執行」的資料夾）。 */
interface AdaptiveRun {
  mode: 'methods'
  name: string
  meta: { items: number; include_test: boolean; git: { commit?: string; dirty?: boolean } }
  features_ready: boolean
  feature_names: string[]
  tags: string[]
  command: string
  arms: ArmResult[]
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
/** 門檻顯示：取四位有效數字，轉回 number 去掉多餘的 0。 */
const num = (v: number) => String(Number(v.toPrecision(4)))
/** 嘗試順序（以 > 串接的方法代碼）轉成中文。 */
const planText = (plan: string) => plan.split('>').map(methodText).join(' → ')

/**
 * 自適應策略（實驗結果頁的一種模式）。左側選資料夾、執行、實驗組與策略；右側讀數欄為與基準的比較，
 * 主檢視分「比較、規則、嘗試順序、量測值分組、各影像」五個分頁。
 */
export function AdaptiveResults({
  switcher,
  root,
  setRoot,
  debouncedRoot,
}: {
  switcher: ReactNode
  /** 結果資料夾；與 E1 消融共用（見 E1Results） */
  root: string
  setRoot: (v: string) => void
  debouncedRoot: string
}) {
  const [runName, setRunName] = useState<string | null>(null)
  const [armName, setArmName] = useState<string | null>(null)
  const [policyName, setPolicyName] = useState<string | null>(null)

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
  const runs = list.data?.method_runs ?? []
  // 選取值不在目前清單中（換資料夾或還沒選）時改選最新的一次（後端已依名稱反向排序）
  const current = runs.some((r) => r.name === runName) ? runName : (runs[0]?.name ?? null)

  // 結果由磁碟上的檔案算出；adaptive.py 重新調整後才會變，因此不設 staleTime: Infinity，切回本頁時重新抓取
  const run = useQuery({
    queryKey: ['e1-adaptive', debouncedRoot, current],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/dev/e1/runs/{run_id}', {
          params: {
            path: { run_id: current! },
            query: debouncedRoot ? { root: debouncedRoot } : {},
          },
          signal,
        }),
      ) as Promise<unknown> as Promise<AdaptiveRun>,
    enabled: !!current,
  })
  const data = run.data
  const arm = data?.arms.find((a) => a.arm === armName) ?? data?.arms[0]
  const policy = arm?.policies.find((p) => p.name === policyName) ?? arm?.policies[0]

  const panel = (
    <PanelSection title="執行結果">
      <RootInput value={root} onChange={setRoot} placeholder={list.data?.root} />
      <Select
        label="執行"
        value={current ?? ''}
        onChange={setRunName}
        options={runs.map((r) => ({
          value: r.name,
          label: r.features ? r.name : `${r.name}（未量測）`,
        }))}
        empty="尚無「每個方法都執行」的結果"
      />
      {data && arm && (
        <>
          {data.arms.length > 1 && (
            <Select
              label="實驗組"
              value={arm.arm}
              onChange={setArmName}
              options={data.arms.map((a) => ({ value: a.arm, label: a.arm }))}
            />
          )}
          <Select
            label="策略"
            help="configs/adaptive/ 的策略檔，以及這次執行中 --tune 調整後的策略。"
            value={policy?.name ?? ''}
            onChange={setPolicyName}
            options={arm.policies.map((p) => ({
              value: p.name,
              label: p.source === 'run' ? `${p.name}（調整後）` : p.name,
            }))}
            empty="沒有策略檔"
          />
        </>
      )}
      <p className="text-muted text-xs">
        先試原圖，失敗才量測品質，依規則決定接下來嘗試的方法與順序。門檻只能在 dev 上以 adaptive.py
        --tune 調整；這裡只檢視結果。
      </p>
    </PanelSection>
  )

  return (
    <Workspace
      panel={panel}
      title="實驗結果"
      description="自適應策略：依品質量測值選擇處理方式，與貪婪選出的逐步升級比較成功率與耗時（research/experiments/e1_barcode/adaptive.py）。"
      aside={switcher}
    >
      {list.error ? (
        <div className="p-4">
          <ErrorBox error={list.error} />
        </div>
      ) : !current ? (
        <EmptyState icon={<Gauge className="size-8" aria-hidden />}>
          {list.isLoading
            ? '載入中…'
            : '尚無結果：先執行 run_methods.py（每個方法都執行），再執行 adaptive.py 量測品質。'}
        </EmptyState>
      ) : run.error ? (
        <div className="p-4">
          <ErrorBox error={run.error} />
        </div>
      ) : !data ? (
        <EmptyState>載入中…</EmptyState>
      ) : !data.features_ready ? (
        <EmptyState icon={<Terminal className="size-8" aria-hidden />}>
          <span>這次執行還沒有品質量測值，請在專案根目錄執行：</span>
          <code className="readout bg-sunken mt-2 block rounded-lg px-3 py-2 text-xs">
            {data.command}
          </code>
        </EmptyState>
      ) : !arm || !policy ? (
        <EmptyState>沒有可顯示的實驗組或策略。</EmptyState>
      ) : policy.error ? (
        <div className="p-4">
          <div role="alert" className="bg-danger-soft text-danger rounded-[20px] px-4 py-3 text-xs">
            策略 {policy.name} 無法在這個實驗組上計算：{policy.error}
          </div>
        </div>
      ) : (
        <PolicyView
          key={`${data.name}/${arm.arm}/${policy.name}`}
          data={data}
          arm={arm}
          policy={policy}
        />
      )}
    </Workspace>
  )
}

/**
 * 一個策略的結果。讀數欄：與基準的成功率與平均耗時、策略內容；主檢視五個分頁。
 * 父層以 key 掛載，換執行、實驗組或策略時重建。
 */
function PolicyView({ data, arm, policy }: { data: AdaptiveRun; arm: ArmResult; policy: Policy }) {
  const [tab, setTab] = useState('compare')
  const overall = policy.overall ?? []
  const timing = policy.timing ?? []
  const mine = overall.find((r) => r.arm === policy.name)
  const base = arm.baseline && overall.find((r) => r.arm === arm.baseline!.name)
  const myMs = timing.find((t) => t.arm === policy.name)?.mean_ms
  const baseMs = arm.baseline && timing.find((t) => t.arm === arm.baseline!.name)?.mean_ms
  const git = data.meta.git

  const readout = (
    <>
      {!arm.baseline && (
        <div className="bg-warn-soft text-warn shrink-0 rounded-[20px] px-4 py-3 text-xs">
          結果含測試集（或沒有原圖），不做貪婪選擇，沒有比較基準。
        </div>
      )}
      <ReadoutBlock title="與基準比較">
        <MetricGrid>
          <Metric
            label="成功率"
            value={pct(mine?.rate)}
            delta={
              base && mine?.rate != null && base.rate != null ? `基準 ${pct(base.rate)}` : undefined
            }
            good={base && mine ? (mine.rate ?? 0) >= (base.rate ?? 0) : undefined}
          />
          <Metric
            label="平均耗時"
            value={myMs == null ? '—' : `${myMs.toFixed(1)} ms`}
            delta={baseMs == null ? undefined : `基準 ${baseMs.toFixed(1)} ms`}
            good={myMs != null && baseMs != null ? myMs <= baseMs : undefined}
            help="每個變體（含負樣本）的平均；原圖失敗時含品質量測耗時。H4 比較的是總耗時。"
          />
          <Metric label="誤讀" value={String(mine?.misread ?? '—')} />
          <Metric label="影像" value={String(data.meta.items)} />
        </MetricGrid>
      </ReadoutBlock>
      <ReadoutBlock title="策略">
        <p className="readout text-[13px]">
          {policy.name} {policy.source === 'run' && <Badge tone="primary">調整後</Badge>}
        </p>
        {policy.description && <p className="text-muted mt-1 text-xs">{policy.description}</p>}
        <p className="text-muted mt-2 text-xs">
          開頭 {policy.start.map(methodText).join(' → ')}；候補{' '}
          {policy.fallback.length ? policy.fallback.map(methodText).join(' → ') : '無'}；最多{' '}
          {policy.max_attempts} 次
        </p>
        {arm.baseline && (
          <p className="text-muted mt-1 text-xs">
            基準（貪婪）：{arm.baseline.order.map(methodText).join(' → ')}
          </p>
        )}
        <p className="text-muted mt-1 text-xs">
          版本 {String(git.commit ?? '?').slice(0, 8)}
          {git.dirty ? '（有未提交變更）' : ''}
        </p>
      </ReadoutBlock>
    </>
  )

  return (
    <Split
      readout={readout}
      main={
        <MainView
          toolbar={
            <Segmented
              label="檢視"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'compare', label: withIcon(BarChart3, '比較') },
                { value: 'rules', label: withIcon(SlidersHorizontal, '規則') },
                { value: 'plans', label: withIcon(ListOrdered, '嘗試順序') },
                { value: 'bins', label: withIcon(Gauge, '量測值分組') },
                { value: 'variants', label: withIcon(Rows3, '各影像') },
              ]}
            />
          }
        >
          {tab === 'compare' ? (
            <>
              <BarList
                label="基準與策略的成功率長條圖，附 95% 信賴區間"
                rows={overall.map((r) => ({
                  label: r.arm,
                  value: r.rate,
                  low: r.ci_low,
                  high: r.ci_high,
                }))}
              />
              <DataTable
                label="基準與策略的整體彙整"
                columns={[
                  '策略',
                  '成功率',
                  '正確／正樣本',
                  '誤讀',
                  '漏讀',
                  '負樣本誤報',
                  'McNemar p 值',
                ]}
                rows={overall.map((r) => [
                  r.arm,
                  pct(r.rate),
                  `${r.correct}／${r.n}`,
                  r.misread,
                  r.missed,
                  r.false_positive,
                  r.arm === arm.baseline?.name
                    ? '基準'
                    : r.p_value != null
                      ? Number(r.p_value.toPrecision(3))
                      : '—',
                ])}
              />
              <DataTable
                label="基準與策略的耗時"
                columns={['策略', '變體', '平均耗時 ms', '總耗時 s', '平均嘗試次數']}
                rows={timing.map((t) => [
                  t.arm,
                  t.n,
                  t.mean_ms.toFixed(1),
                  t.total_s.toFixed(2),
                  t.mean_attempts.toFixed(2),
                ])}
              />
              <p className="text-muted mt-2 text-xs">
                以變體為單位的信賴區間與 McNemar 只供探索；以原始樣本為單位的比較見 adaptive.py 的
                summary_adaptive_*.md。
              </p>
            </>
          ) : tab === 'rules' ? (
            <DataTable
              label="規則與成立比例"
              columns={['#', '條件', '處理', '成立', '比例', '說明']}
              rows={policy.rules.map((r, i) => [
                i,
                `${featureText(r.feature)} ${r.op} ${num(r.threshold)}`,
                r.methods.map(methodText).join(' → '),
                r.hits,
                pct(r.rate),
                r.note ?? '',
              ])}
            />
          ) : tab === 'plans' ? (
            <DataTable
              label="嘗試順序分布"
              columns={['嘗試順序', '變體數']}
              rows={(policy.plans ?? []).map((p) => [planText(p.plan), p.count])}
            />
          ) : tab === 'bins' ? (
            <BinsView data={data} arm={arm} />
          ) : (
            <VariantsView data={data} policy={policy} />
          )}
        </MainView>
      }
    />
  )
}

/** 依量測值四分位分組的各方法成功率熱度圖，用來找「成功率開始下滑」的範圍（品質檢查門檻）。 */
function BinsView({ data, arm }: { data: AdaptiveRun; arm: ArmResult }) {
  const [feature, setFeature] = useState(data.feature_names[0] ?? '')
  const bins = arm.bins[feature] ?? []
  const label = (b: Bin) => `${num(b.low)}–${num(b.high)}`
  return (
    <>
      <div className="flex shrink-0 items-end gap-3 px-1 pb-3">
        <Select
          label="量測值"
          value={feature}
          onChange={setFeature}
          options={data.feature_names.map((f) => ({ value: f, label: featureText(f) }))}
        />
      </div>
      {bins.length === 0 ? (
        <EmptyState>沒有正樣本可以分組。</EmptyState>
      ) : (
        <>
          <Heatmap
            label={`各方法在 ${featureText(feature)} 各組的成功率熱度圖`}
            rows={arm.methods}
            rowLabel={methodText}
            left={250}
            cols={bins.map(label)}
            value={(method, col) => {
              const b = bins.find((x) => label(x) === col)
              const rate = b?.[method]
              return (
                b && {
                  rate: rate ?? null,
                  title: `${methodText(method)}・${featureText(feature)} ${col}：${pct(rate)}（${b.n} 張）`,
                }
              )
            }}
          />
          <p className="text-muted mt-2 text-xs">
            只計正樣本，依量測值的四分位數分成四組；同一值很多時組別可能不均。
          </p>
        </>
      )}
    </>
  )
}

/** 每個變體在策略下的嘗試順序、成立的規則、結果與耗時。 */
function VariantsView({ data, policy }: { data: AdaptiveRun; policy: Policy }) {
  const variants = policy.variants ?? []
  return (
    <>
      {policy.truncated && (
        <p className="text-muted px-1 pb-2 text-xs">變體太多，只顯示前 {variants.length} 筆。</p>
      )}
      <DataTable
        label="各影像在策略下的結果"
        columns={['影像', '結果', '成功方法', '嘗試順序', '成立規則', '耗時 ms', ...data.tags]}
        rows={variants.map((v) => [
          <span key="id" className="readout text-xs">
            {v.id}
          </span>,
          <Badge
            key="o"
            tone={
              v.outcome === 'correct' || v.outcome === 'true_negative'
                ? 'ok'
                : v.outcome === 'missed'
                  ? 'accent'
                  : 'danger'
            }
          >
            {outcomeText(v.outcome)}
          </Badge>,
          v.success_rung ? methodText(v.success_rung) : '—',
          <span key="p" className="text-xs">
            {planText(v.plan)}
          </span>,
          v.rules === '' ? '—' : v.rules.split('|').join('、'),
          v.elapsed_ms.toFixed(1),
          ...data.tags.map((t) => String(v[t] ?? '')),
        ])}
      />
    </>
  )
}
