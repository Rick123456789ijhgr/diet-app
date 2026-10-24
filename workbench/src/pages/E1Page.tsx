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
import { EmptyState, MainView, ReadoutBlock, Split, Workspace } from '@/components/layout/Workspace'
import { DataTable, ErrorBox, Metric, MetricGrid } from '@/components/results'
import {
  Badge,
  Button,
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

// 以下型別是本頁自行宣告的後端回應形狀（E1 路由的回應在規格中是自由 JSON：FreeJson），
// 取得時以 `as Promise<unknown> as Promise<…>` 轉型；欄位改名時這裡不會有型別錯誤提醒。

/** GET /dev/e1/runs：結果資料夾、其中各次執行，以及可選的實驗組（arms）與預設勾選的實驗組。 */
interface RunList {
  root: string
  runs: { name: string; path: string }[]
  arms: string[]
  default_arms: string[]
}

/**
 * 一個實驗組（或一個實驗組在某分組值下）的彙整統計，全部由後端 dietai.evaluation 算好。
 * rate／ci_low／ci_high 在 n = 0 時為 null；p_value 是對基準組的 McNemar 檢定，基準組本身沒有。
 * 索引簽章用來容納分組條件欄位（例如 `blur: 'high'`），GroupView 以 `r[group]` 取值。
 */
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

/**
 * 一筆失敗紀錄（某影像在某實驗組下的結果）。outcome 為 FAILURE_KINDS 之一；
 * truth 空字串表示負樣本（影像中沒有條碼）；image 是伺服器本機路徑，檢視時經 useLocalImage 載入。
 * 索引簽章容納各拍攝條件欄位（與 Run.tags 對應），表格逐欄顯示。
 */
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

/**
 * GET /dev/e1/runs/{run_id}：一次執行的完整結果。
 * - overall：以「基準實驗組」為鍵，值為各實驗組的彙整（p 值是對該基準組算的，所以每個基準各一份）。
 * - by_tag：以分組條件為鍵，值為「實驗組 × 該條件各值」的彙整列。
 * - rescues：各實驗組成功於哪一階（rung）的影像數。
 * - attempts：每張影像每一階的嘗試紀錄（欄位不固定，原樣以表格顯示）。
 * - meta.include_test：納入測試集時不可檢視失敗影像（測試集鎖定，見根目錄 CLAUDE.md 規則 7）。
 */
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

/** 快速執行的 SSE 事件：start（產生合成資料後開始）→ 多筆 progress → done（帶新執行的名稱）。 */
type E1Event =
  | { type: 'start'; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; name: string; path: string }

/** 失敗種類（誤讀、漏讀、誤報、執行錯誤），也是「失敗影像」篩選按鈕的順序。 */
const FAILURE_KINDS = ['misread', 'missed', 'false_positive', 'error']
/** 解碼階梯由簡到繁的固定順序，讓「成功階」堆疊長條的顏色與圖例順序固定。 */
const RUNG_ORDER = ['raw', 'gray', 'binarize', 'sharpen', 'denoise', 'deskew', 'multiscale']

/**
 * E1 條碼消融頁。左側面板分兩頁：「執行結果」選資料夾／執行／基準組／分組條件；
 * 「快速執行」以合成條碼經 SSE 跑一次實驗。右側由 RunView 顯示選定執行的結果。
 * 本頁只顯示後端算好的統計（成功率、Wilson 信賴區間、McNemar p 值），不在前端重算。
 */
export function E1Page() {
  const qc = useQueryClient()
  // 結果資料夾：空字串代表用後端預設路徑。打字時以 400 ms 防抖，避免每個字元都重新列出資料夾
  const [root, setRoot] = useState('')
  const debouncedRoot = useDebounced(root, 400)
  // 使用者選的執行；可能不在目前清單中（換資料夾後），實際使用的是下方的 current
  const [runName, setRunName] = useState<string | null>(null)
  // 使用者選的基準組；同理可能不在新執行的實驗組中，實際使用的是下方的 base
  const [baseline, setBaseline] = useState<string | null>(null)
  // 分組條件（tag 名稱）；空字串為不分組
  const [group, setGroup] = useState('')
  // 快速執行勾選的實驗組；null 代表使用者還沒動過，沿用後端的 default_arms
  const [picked, setPicked] = useState<string[] | null>(null)
  const [nCodes, setNCodes] = useState(2)
  // 快速執行走 SSE（POST 同一路徑）；離開頁面時 useStream 會自動取消，後端隨之停止
  const stream = useStream<E1Event>('/workbench/v1/dev/e1/runs')

  // 列出資料夾中的執行。查詢鍵含防抖後的資料夾，換資料夾就是新查詢；signal 讓舊請求被取消
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

  // 載入選定執行的完整結果。已寫入磁碟的執行結果不會再變，所以 staleTime: Infinity 不重新抓取；
  // 沒有任何執行（current 為 null）時不查詢
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
  // 基準組：使用者選的若不在這次執行的實驗組中（或還沒選），退回第一個實驗組
  const base = data && baseline && data.arms.includes(baseline) ? baseline : data?.arms[0]
  const arms = picked ?? list.data?.default_arms ?? []

  // 快速執行：收到 done 時切換到新產生的執行，並讓所有 e1-runs 清單查詢失效以重新列出
  // （前綴比對，不論資料夾）。注意這裡帶的是防抖後的資料夾。
  const quickRun = () =>
    void stream.run({ arms, n_codes: nCodes, root: debouncedRoot || undefined }, (e) => {
      if (e.type === 'done') {
        setRunName(e.name)
        void qc.invalidateQueries({ queryKey: ['e1-runs'] })
      }
    })
  // 最新一筆進度事件（複製後反轉再找，不改動 stream.events 本身）；還沒有進度時為 undefined
  const progress = [...stream.events].reverse().find((e) => e.type === 'progress')

  // 左側控制面板
  const panel = (
    <Tabs defaultValue="runs">
      <div className="bg-card sticky top-0 z-10 p-3 pb-2">
        <TabsList>
          <TabsTrigger value="runs">執行結果</TabsTrigger>
          <TabsTrigger value="quick">快速執行</TabsTrigger>
        </TabsList>
      </div>
      {/* 「執行結果」：選資料夾、執行、基準組、分組條件 */}
      <TabsContent value="runs" className="space-y-3 px-4 pt-2 pb-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">結果資料夾（空白為預設）</span>
          <input
            aria-label="結果資料夾"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder={list.data?.root ?? 'research/experiments/e1_barcode/runs'}
            className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card readout h-7 rounded-lg border px-2 text-xs focus-visible:outline-none"
          />
        </label>
        <Select
          label="執行"
          value={current ?? ''}
          onChange={setRunName}
          options={runs.map((r) => ({ value: r.name, label: r.name }))}
          empty="尚無執行結果"
        />
        {/* 基準組與分組條件依執行內容而定，載入執行後才顯示 */}
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
      {/* 「快速執行」：以合成條碼跑選取的實驗組（SSE 回報進度） */}
      <TabsContent value="quick" className="space-y-3 px-4 pt-2 pb-4 text-sm">
        <p className="text-muted text-xs">
          以合成條碼產生資料（寫到
          e1_barcode/synthetic/）並執行選取的實驗組，結果存到「執行結果」的資料夾。
          合成資料只供驗證流程與觀察趨勢，不可作為結論。
        </p>
        <fieldset>
          <legend className="text-muted mb-1 text-xs">實驗組</legend>
          <div className="flex flex-wrap gap-1.5">
            {/* 膠囊切換按鈕；第一次點選時由 default_arms 複製出 picked，之後就以 picked 為準 */}
            {(list.data?.arms ?? []).map((a) => {
              const on = arms.includes(a)
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(on ? arms.filter((x) => x !== a) : [...arms, a])}
                  className={cn(
                    'readout rounded-lg border px-2 py-0.5 text-xs',
                    on
                      ? 'border-primary bg-primary-soft text-primary-ink'
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
            // 限制在 1–20；清空或非數字時視為 1
            onChange={(e) => setNCodes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            className="border-card-border bg-sunken readout h-6 w-16 rounded-lg border px-1.5 text-right"
          />
        </label>
        {/* 執行中顯示停止鈕與進度條；還沒收到 progress（後端仍在產生合成資料）時，進度條先顯示 5% */}
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
          <p className="text-ok text-xs">完成，已切換到新的執行結果。</p>
        )}
        {stream.error ? <ErrorBox error={stream.error} /> : null}
      </TabsContent>
    </Tabs>
  )

  return (
    <Workspace
      panel={panel}
      title="E1 條碼消融"
      description="各實驗組的成功率與信賴區間、依拍攝條件分組、成功階與失敗影像（research/experiments/e1_barcode）。"
      aside={
        stream.status === 'running' && (
          <Badge tone="primary" aria-live="polite">
            快速執行中…
          </Badge>
        )
      }
    >
      {/* 主區依序判斷：清單錯誤 → 沒有任何執行 → 執行載入錯誤 → 載入中 → 顯示結果 */}
      {list.error ? (
        <div className="p-4">
          <ErrorBox error={list.error} />
        </div>
      ) : !current ? (
        <EmptyState icon={<FlaskConical className="size-8" aria-hidden />}>
          {list.isLoading
            ? '載入中…'
            : '尚無執行結果：在左側「快速執行」，或在終端機執行 make e1-synthetic。'}
        </EmptyState>
      ) : run.error ? (
        <div className="p-4">
          <ErrorBox error={run.error} />
        </div>
      ) : !data || !base ? (
        <EmptyState>載入中…</EmptyState>
      ) : (
        // 換一次執行時重新建立，避免沿用前一次的選取（例如新執行沒有的實驗組）
        <RunView key={data.name} data={data} base={base} group={group} />
      )}
    </Workspace>
  )
}

/**
 * 本頁用的精簡下拉選單（原生 select）。
 * - options 為空時停用，並顯示 empty 作為唯一的佔位選項。
 * - help 以 title 屬性顯示為滑鼠停留提示。
 */
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
        className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card h-7 rounded-lg border px-2 text-xs focus-visible:outline-none"
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

/** 比例轉百分比字串（一位小數）；null／undefined（例如 n = 0 沒有成功率）顯示為「—」。 */
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

/**
 * 一次執行的結果檢視：右側讀數欄（警示、執行資訊、基準組）＋主檢視的四個分頁
 * （整體成功率、依條件分組、成功階、失敗影像）。
 * 父層以 key={data.name} 掛載，換執行時整個重建，分頁與子元件的選取狀態都會重置。
 *
 * @param data 執行結果
 * @param base 基準實驗組（已確認存在於 data.arms）
 * @param group 分組條件；空字串表示不分組
 */
function RunView({ data, base, group }: { data: Run; base: string; group: string }) {
  const [tab, setTab] = useState('overall')
  // 以目前基準組算出的整體彙整（p 值才會是對這個基準組）
  const overall = data.overall[base] ?? []
  // 所有實驗組的誤讀次數加總；誤讀比漏讀危險（會被當成另一個商品），有就顯示紅色警示
  const misreads = overall.reduce((a, r) => a + r.misread, 0)
  const git = data.meta.git
  const readout = (
    <>
      {misreads > 0 && (
        <div
          role="alert"
          className="bg-danger-soft text-danger shrink-0 rounded-[20px] px-4 py-3 text-xs"
        >
          共有 {misreads}{' '}
          次誤讀（檢查碼正確但內容錯誤）：會被當成另一個商品，比漏讀更危險。請在「失敗影像」檢視。
        </div>
      )}
      {data.meta.include_test && (
        <div className="bg-warn-soft text-warn flex shrink-0 items-start gap-1.5 rounded-[20px] px-4 py-3 text-xs">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          此執行納入測試集（正式實驗），失敗影像不提供檢視。
        </div>
      )}
      <ReadoutBlock title="這次執行">
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
      </ReadoutBlock>
      <ReadoutBlock title="基準實驗組">
        <p className="readout text-[13px]">{base}</p>
        <p className="text-muted mt-1 text-xs">McNemar 檢定的比較對象，可在左側切換。</p>
      </ReadoutBlock>
    </>
  )
  return (
    <Split
      readout={readout}
      main={
        <MainView
          // 失敗影像分頁自行切分表格與影像兩塊並各自捲動，因此不讓整個主檢視捲動
          scroll={tab !== 'fail'}
          toolbar={
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
            />
          }
        >
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
                  // 基準組自己不做檢定；其他組的 p 值取三位有效數字，轉回 number 去掉多餘的 0
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
                {/* 堆疊的階依 RUNG_ORDER 排序，只留這次執行實際出現的階；
                    每個實驗組一列，值為 {rung: 影像數} */}
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
        </MainView>
      }
    />
  )
}

/**
 * 依拍攝條件分組的熱度圖：列為實驗組、欄為該條件的各個值，格子顏色為成功率。
 * 滑鼠停留提示列出成功率、正確數／樣本數與誤讀數。
 */
function GroupView({ data, group }: { data: Run; group: string }) {
  // 排除沒有樣本的組合（成功率為 null，畫出來沒有意義）
  const rows = (data.by_tag[group] ?? []).filter((r) => r.n > 0)
  // 欄＝該條件出現過的值，去重後依出現順序排列（未另外排序）；統一轉字串以便比對
  const cols = [...new Set(rows.map((r) => String(r[group])))]
  return (
    <Heatmap
      label={`實驗組與 ${group} 的成功率熱度圖`}
      rows={data.arms}
      cols={cols}
      value={(arm, col) => {
        const r = rows.find((x) => x.arm === arm && String(x[group]) === col)
        // 找不到（這個實驗組在該值下沒有樣本）時回傳 undefined，熱度圖畫成空格
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

/**
 * 失敗影像分頁：上方選實驗組與失敗種類，中間是失敗清單，點選一列後下方左側顯示影像、
 * 右側顯示該影像每一階的嘗試紀錄。納入測試集的執行不顯示影像（測試集鎖定）。
 */
function Failures({ data }: { data: Run }) {
  // 預設看最後一個實驗組；data.arms 若為空，這裡會是 undefined
  const [arm, setArm] = useState(data.arms[data.arms.length - 1]!)
  const [kinds, setKinds] = useState(FAILURE_KINDS)
  const [selected, setSelected] = useState<Failure | null>(null)
  // 換實驗組或篩選條件時清除選取：舊的選取列可能已不在清單中，也避免把別組的嘗試紀錄配到這一組
  useEffect(() => setSelected(null), [arm, kinds])
  const failed = data.failures.filter((f) => f.arm === arm && kinds.includes(f.outcome))
  // 選取影像在目前實驗組下的嘗試紀錄（每一階一列）
  const attempts = selected
    ? data.attempts.filter((a) => a.id === selected.id && a.arm === arm)
    : []
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-end gap-3 px-1 pb-3">
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
                  'h-7 rounded-lg border px-2 text-xs',
                  on
                    ? 'border-danger/50 bg-danger-soft text-danger'
                    : 'border-card-border text-muted',
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
          {/* 失敗清單：沒有選取時撐滿；選取後縮到 38% 高，留空間給下方的影像與嘗試紀錄 */}
          <div className={cn('overflow-auto', selected ? 'max-h-[38%] shrink-0' : 'flex-1')}>
            <table className="w-full text-[13px]" aria-label="失敗影像清單">
              <thead className="bg-card sticky top-0">
                <tr className="text-muted bg-sunken text-left text-xs">
                  {['影像', '結果', '真值', '解出', '成功階', ...data.tags].map((c) => (
                    <th
                      key={c}
                      className="px-2 py-2 font-medium first:rounded-l-xl last:rounded-r-xl"
                    >
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
                      selected?.id === f.id
                        ? 'bg-primary-soft shadow-[inset_3px_0_0_var(--primary)]'
                        : 'hover:bg-hover',
                    )}
                  >
                    <td className="readout px-2 py-1 text-xs">{f.id}</td>
                    <td className="px-2">
                      {/* 漏讀用 accent 色調；誤讀、誤報、錯誤用紅色（danger） */}
                      <Badge tone={f.outcome === 'missed' ? 'accent' : 'danger'}>
                        {outcomeText(f.outcome)}
                      </Badge>
                    </td>
                    <td className="readout px-2 text-xs">{f.truth || '（負樣本）'}</td>
                    <td className="readout px-2 text-xs">{f.decoded || '—'}</td>
                    <td className="px-2">{f.success_rung ? rungText(f.success_rung) : '—'}</td>
                    {data.tags.map((t) => (
                      <td key={t} className="px-2 text-xs">
                        {f[t]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? (
            <div className="grid min-h-0 flex-1 pt-3 lg:grid-cols-[3fr_2fr]">
              {data.meta.include_test ? (
                <EmptyState icon={<Lock className="size-6" aria-hidden />}>
                  測試集已鎖定，不提供影像檢視。
                </EmptyState>
              ) : (
                <FailureImage path={selected.image} id={selected.id} />
              )}
              <div className="overflow-auto pl-4">
                {/* 嘗試紀錄的欄位不固定：以第一列的鍵為欄名，去掉已知的 id、arm，rung 轉中文 */}
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
            </div>
          ) : (
            <p className="text-muted shrink-0 px-1 pt-3 text-xs">
              點選表格列以檢視影像與每一階的嘗試。
            </p>
          )}
        </>
      )}
    </>
  )
}

/**
 * 顯示一張失敗影像：以 useLocalImage 把伺服器本機路徑載入暫存區取得 image_id，再交給 ImageViewer。
 * 影像載入失敗（暫存影像被淘汰、Python 重啟）時呼叫 reload 重新載入（有最短間隔限制）。
 */
function FailureImage({ path, id }: { path: string; id: string }) {
  const image = useLocalImage(path)
  if (image.error)
    return (
      <div className="px-4 pt-2 pb-4">
        <ErrorBox error={image.error} />
      </div>
    )
  if (!image.data) return <EmptyState>載入中…</EmptyState>
  return (
    <ImageViewer
      fill
      src={artifactUrl(image.data.image_id)}
      width={image.data.width}
      height={image.data.height}
      alt={`失敗影像 ${id}`}
      onError={image.reload}
    />
  )
}
