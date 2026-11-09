// 模組一・找最佳流程（實驗一）：四個步驟，一次只顯示一個步驟的畫面。
//   1 選擇圖片 → 2 逐張確認真值 → 3 比較方法（每個方法都執行）→ 4 結論（可用 Python 工具把原始照片改名成條碼號碼）
// 真值推定、判定、貪婪選擇與統計一律由後端（dietai.evaluation.best_flow 與 methods）計算，前端只顯示。
// 後端流程不變：先執行（POST /dev/best-flow/runs），執行完再把人工確認的真值一次送出（PUT .../truth）。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, History, Play, RotateCcw, Square } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { api, unwrap } from '@/api/client'
import { PageHeader } from '@/components/layout/Workspace'
import { Stepper } from '@/components/layout/Stepper'
import { ErrorBox } from '@/components/results'
import { Dialog } from '@/components/ui/Dialog'
import { Badge, Button } from '@/components/ui/primitives'
import { useStream } from '@/hooks/useStream'
import { truthsOf, uploadIds } from '@/lib/barcodeTruth'
import { cn } from '@/lib/cn'
import { progressPercent } from '@/lib/number'

import { useItems, useUploads } from './bestflow/items'
import { PickStep, type Source } from './bestflow/PickStep'
import { ResultStep } from './bestflow/ResultStep'
import { TruthStep } from './bestflow/TruthStep'
import { criteriaQuery, DEFAULT_CRITERIA, type RunEvent, type RunList } from './bestflow/types'
import { RootInput } from './shared'

const STEPS = [
  { id: 'pick', title: '選擇圖片' },
  { id: 'truth', title: '確認真值' },
  { id: 'run', title: '比較方法' },
  { id: 'result', title: '結論' },
] as const
type StepId = (typeof STEPS)[number]['id']
const order = (s: StepId) => STEPS.findIndex((x) => x.id === s)

/** 比較方法這一步的進度：上傳中、執行中（進度由 SSE 事件得知）、寫入真值中。 */
type Phase = { kind: 'upload'; done: number; total: number } | { kind: 'truth' } | null

/**
 * 找最佳流程（實驗結果頁的預設模式）。狀態都留在這裡，切換步驟（以及切到「進階」再回來）都不會遺失。
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
  const [step, setStep] = useState<StepId>('pick')
  const [dir, setDir] = useState<'forward' | 'back'>('forward')
  const goto = (to: StepId) => {
    setDir(order(to) >= order(step) ? 'forward' : 'back')
    setStep(to)
  }

  const [source, setSource] = useState<Source>('upload')
  const { items, add, remove, clear, answer } = useItems()
  const upload = useUploads()
  const [cursor, setCursor] = useState(0)
  const [folder, setFolder] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA)
  const [runName, setRunName] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>(null)
  const [uploadError, setUploadError] = useState<unknown>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const stopUpload = useRef(false)
  const stream = useStream<RunEvent>('/workbench/v1/dev/best-flow/runs')
  const busy = phase !== null || stream.status === 'running'

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

  const answered = items.filter((i) => i.answer).length
  const cursorSafe = Math.min(cursor, Math.max(items.length - 1, 0))

  const start = async () => {
    setUploadError(null)
    setSaveError(null)
    setDir('forward')
    setStep('run')
    let body: Record<string, unknown>
    let truths: Record<string, string> = {}
    if (source === 'folder') {
      body = { folder, recursive, root: root || undefined }
    } else {
      // 逐張上傳（確認真值時已上傳的直接沿用），取得 image_id 後才開始執行
      stopUpload.current = false
      const ids: string[] = []
      setPhase({ kind: 'upload', done: 0, total: items.length })
      try {
        for (const it of items) {
          if (stopUpload.current) {
            setPhase(null)
            return
          }
          ids.push((await upload(it)).image_id)
          setPhase({ kind: 'upload', done: ids.length, total: items.length })
        }
      } catch (err) {
        setUploadError(err)
        setPhase(null)
        return
      }
      setPhase(null)
      body = { image_ids: ids, root: root || undefined }
      // 執行裡的圖片 ID 就是原檔名（同名的加 #2）；依真值改原始照片的檔名交給 Python 工具
      truths = truthsOf(
        uploadIds(items.map((i) => i.file.name)),
        items.map((i) => i.answer),
      )
    }
    const finished: { name?: string } = {}
    await stream.run(body, (e) => {
      if (e.type === 'done') finished.name = e.name
    })
    if (!finished.name) return // 出錯或停止：留在這一步顯示原因
    const name = finished.name
    if (Object.keys(truths).length > 0) {
      setPhase({ kind: 'truth' })
      try {
        await unwrap(
          api.PUT('/workbench/v1/dev/best-flow/runs/{run_id}/truth', {
            params: { path: { run_id: name }, query: criteriaQuery(root, criteria) },
            body: { truths },
          }),
        )
      } catch (err) {
        setSaveError(err)
      }
      setPhase(null)
    }
    void qc.invalidateQueries({ queryKey: ['e1-runs'] })
    void qc.invalidateQueries({ queryKey: ['best-flow-run', debouncedRoot, name] })
    setRunName(name)
    setDir('forward')
    setStep('result')
  }

  const openRun = (name: string) => {
    setSaveError(null)
    setRunName(name)
    goto('result')
  }

  const canGo = (s: StepId) => {
    if (busy) return false
    if (s === 'pick') return true
    if (s === 'truth') return source === 'upload' && items.length > 0
    if (s === 'result') return runName !== null
    return false // 比較方法只能按「開始比較」進入
  }

  // 換步驟時把焦點移到新畫面的標題（確認真值由號碼輸入框自己取得焦點）
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (step !== 'truth') heading.current?.focus()
  }, [step])

  const startButton = (
    <Button
      variant="primary"
      disabled={source === 'folder' ? folder.trim() === '' : items.length === 0}
      onClick={() => void start()}
    >
      <Play className="size-4" aria-hidden />
      開始比較
    </Button>
  )

  let screen: ReactNode
  let footer: ReactNode
  if (step === 'pick') {
    screen = (
      <PickStep
        source={source}
        setSource={setSource}
        items={items}
        onAdd={add}
        onRemove={remove}
        onClear={clear}
        folder={folder}
        setFolder={setFolder}
        recursive={recursive}
        setRecursive={setRecursive}
      />
    )
    footer = (
      <>
        {runs[0] && (
          <p className="text-muted min-w-0 truncate text-xs">
            最近一次：<span className="readout">{runs[0].name}</span>
            <button
              type="button"
              onClick={() => openRun(runs[0]!.name)}
              className="text-ink ml-2 font-medium underline underline-offset-2"
            >
              查看結論
            </button>
          </p>
        )}
        <div className="ml-auto">
          {source === 'folder' ? (
            startButton
          ) : (
            <Button variant="primary" disabled={items.length === 0} onClick={() => goto('truth')}>
              下一步：逐張確認真值
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </>
    )
  } else if (step === 'truth') {
    screen = (
      <TruthStep
        items={items}
        cursor={cursorSafe}
        setCursor={setCursor}
        onAnswer={answer}
        upload={upload}
      />
    )
    footer = (
      <>
        <Button variant="ghost" onClick={() => goto('pick')}>
          <ArrowLeft className="size-4" aria-hidden />
          上一步
        </Button>
        <p className="text-muted min-w-0 flex-1 text-center text-xs" aria-live="polite">
          已確認 <span className="text-ink readout font-semibold">{answered}</span>／{items.length}{' '}
          張{answered < items.length && `；其餘 ${items.length - answered} 張交給程式推定`}
        </p>
        {startButton}
      </>
    )
  } else if (step === 'run') {
    screen = (
      <RunScreen
        phase={phase}
        events={stream.events}
        error={uploadError ?? stream.error}
        cancelled={stream.status === 'cancelled'}
      />
    )
    footer = busy ? (
      <Button
        className="ml-auto"
        disabled={phase?.kind === 'truth'}
        onClick={() => {
          stopUpload.current = true
          stream.cancel()
        }}
      >
        <Square className="size-4" aria-hidden />
        停止
      </Button>
    ) : (
      <Button variant="ghost" onClick={() => goto(source === 'upload' ? 'truth' : 'pick')}>
        <ArrowLeft className="size-4" aria-hidden />
        上一步
      </Button>
    )
  } else {
    screen = runName ? (
      <ResultStep
        runName={runName}
        root={debouncedRoot}
        criteria={criteria}
        setCriteria={setCriteria}
        saveError={saveError}
      />
    ) : null
    footer = (
      <>
        <p className="text-muted min-w-0 truncate text-xs">
          這次執行：<span className="readout">{runName}</span>
        </p>
        <Button className="ml-auto" onClick={() => goto('pick')}>
          <RotateCcw className="size-4" aria-hidden />
          用其他圖片再比一次
        </Button>
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col pr-3 pb-3">
      <PageHeader
        title="找最佳流程"
        description="選圖片、逐張確認條碼真值，再比較各種前處理方法，選出讀得最多又不增加誤讀的流程。"
        aside={
          <div className="flex items-center gap-2">
            {busy && (
              <Badge tone="primary" aria-live="polite">
                執行中…
              </Badge>
            )}
            <PastRuns
              runs={runs}
              current={runName}
              root={root}
              setRoot={setRoot}
              placeholder={list.data?.root}
              error={list.error}
              disabled={busy}
              onOpen={openRun}
            />
            {switcher}
          </div>
        }
      />
      <section
        aria-label="找最佳流程的步驟"
        className="bg-card shadow-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px]"
      >
        <div className="border-card-border flex shrink-0 items-center gap-3 overflow-x-auto border-b px-4 py-2.5">
          <Stepper
            steps={STEPS}
            current={step}
            done={(s) => order(s) < order(step) && !(s === 'truth' && source === 'folder')}
            canGo={canGo}
            onSelect={goto}
            className="flex-1"
          />
        </div>
        <div
          key={step}
          className={cn('min-h-0 flex-1', dir === 'forward' ? 'wb-step-forward' : 'wb-step-back')}
        >
          <h2 ref={heading} tabIndex={-1} className="sr-only">
            {STEPS[order(step)]!.title}
          </h2>
          {screen}
        </div>
        <footer className="border-card-border flex shrink-0 items-center gap-3 border-t px-5 py-3">
          {footer}
        </footer>
      </section>
    </div>
  )
}

/** 比較方法：進度條與目前在做什麼；出錯或停止時說明原因。 */
function RunScreen({
  phase,
  events,
  error,
  cancelled,
}: {
  phase: Phase
  events: RunEvent[]
  error: unknown
  cancelled: boolean
}) {
  const progress = [...events].reverse().find((e) => e.type === 'progress')
  const p = progress?.type === 'progress' ? progress : null
  const [label, done, total] =
    phase?.kind === 'upload'
      ? ['上傳圖片', phase.done, phase.total]
      : phase?.kind === 'truth'
        ? ['寫入你確認的真值', 1, 1]
        : p
          ? ['每張圖都用全部前處理方法各解碼一次', p.done, p.total]
          : ['準備中', 0, 0]
  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorBox error={error} />
      </div>
    )
  }
  if (cancelled) {
    return (
      <div className="text-muted flex h-full items-center justify-center p-8 text-sm">
        已停止，沒有留下這次的結果。回上一步可以重新開始。
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8">
      <p className="readout text-[40px] leading-none font-semibold tracking-tight">
        {total > 0 ? `${done}／${total}` : '…'}
      </p>
      <div className="w-full max-w-md">
        <div
          role="progressbar"
          aria-label={label}
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total || undefined}
          className="bg-hover h-2 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full transition-[width] duration-300"
            style={{ width: `${total > 0 ? progressPercent(done, total) : 4}%` }}
          />
        </div>
        <p className="text-ink-2 mt-2 text-center text-[13px]">{label}</p>
      </div>
      <p className="text-muted max-w-md text-center text-xs leading-relaxed">
        包含多尺度與疊加流程，一張圖約需數秒。可以先去看其他頁面，回來時進度還在。
      </p>
    </div>
  )
}

/** 過去的執行（彈窗）：換結果資料夾、打開某次執行的結論。 */
function PastRuns({
  runs,
  current,
  root,
  setRoot,
  placeholder,
  error,
  disabled,
  onOpen,
}: {
  runs: { name: string; path: string }[]
  current: string | null
  root: string
  setRoot: (v: string) => void
  placeholder?: string
  error: unknown
  disabled: boolean
  onOpen: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="過去的執行"
      description="打開以前的結論，或換一個結果資料夾。"
      trigger={
        <Button size="sm" disabled={disabled}>
          <History className="size-3.5" aria-hidden />
          過去的執行
        </Button>
      }
    >
      <div className="space-y-4">
        <RootInput value={root} onChange={setRoot} placeholder={placeholder} />
        {error ? <ErrorBox error={error} /> : null}
        {runs.length === 0 ? (
          <p className="text-muted text-xs">這個資料夾裡還沒有找最佳流程的執行。</p>
        ) : (
          <ul aria-label="執行清單" className="divide-card-border divide-y">
            {runs.map((r) => (
              <li key={r.name}>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(r.name)
                    setOpen(false)
                  }}
                  className="hover:bg-hover focus-visible:ring-primary/40 flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="readout min-w-0 flex-1 truncate text-[13px]">{r.name}</span>
                  {r.name === current && <Badge tone="primary">正在看</Badge>}
                  <ArrowRight className="text-muted size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
