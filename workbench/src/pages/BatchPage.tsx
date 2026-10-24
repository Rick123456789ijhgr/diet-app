// 模組一：資料夾批次。對本機資料夾的照片逐張做品質檢查（SSE 逐張回報），
// 看目前門檻下的通過率與分數分布；點選表格列可檢視單張。
import { BarChart3, Download, FolderOpen, Play, Square, Table, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { artifactUrl, overrideBody, type ConfigOverride } from '@/api/client'
import { BarList, ValueHistogram } from '@/components/charts'
import { ConfigIO } from '@/components/ConfigIO'
import { ImageViewer } from '@/components/ImageViewer'
import { EmptyState, MainView, ReadoutBlock, Split, Workspace } from '@/components/layout/Workspace'
import { ParamForm } from '@/components/ParamForm'
import { ErrorBox, Metric, MetricGrid } from '@/components/results'
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
import { useConfigClass } from '@/hooks/useConfigSchemas'
import { useLocalImage } from '@/hooks/useLocalImage'
import { useRenderView } from '@/hooks/useRenderView'
import { useStream } from '@/hooks/useStream'
import { cn } from '@/lib/cn'
import { valueOf } from '@/lib/config'
import { warningText } from '@/lib/text'

// 以下型別是本頁自行宣告的 SSE 事件形狀（規格中只定義請求 BatchRequest）。

/**
 * 一張影像的品質檢查結果。讀取失敗時 error 為錯誤訊息，其餘指標欄位不存在（所以皆為選填）；
 * error 為 null 表示成功。index 為處理順序，作為表格列的 key 與選取比對。
 */
interface Row {
  type: 'row'
  index: number
  file: string
  path: string
  short_side?: number
  blur_score?: number
  mean_brightness?: number
  dark_ratio?: number
  bright_ratio?: number
  resolution_ok?: boolean
  passed?: boolean
  warnings?: string[]
  error: string | null
}

/** 全部處理完後的彙整（被取消時不會收到）。pass_rate 由後端計算，可能為 null（顯示「—」）。 */
interface Summary {
  type: 'summary'
  count: number
  ok: number
  failed: number
  pass_rate: number | null
  warning_counts: Record<string, number>
}

/** SSE 事件順序：start（總張數）→ 每張一筆 row → summary。 */
type BatchEvent = { type: 'start'; total: number; folder: string } | Row | Summary

/** 「分數分布」可選的指標 → （中文標籤, 對應的 QualityConfig 門檻欄位；平均亮度沒有單一門檻）。 */
const DIST = {
  blur_score: { label: '模糊分數', threshold: 'blur_min' },
  dark_ratio: { label: '過暗比例', threshold: 'dark_ratio_max' },
  bright_ratio: { label: '過亮比例', threshold: 'bright_ratio_max' },
  mean_brightness: { label: '平均亮度', threshold: null },
} as const
type DistKey = keyof typeof DIST

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** 表格最多顯示的列數（幾千張時逐列繪製會拖慢畫面；完整結果在 CSV） */
const MAX_TABLE_ROWS = 500

/** 按下時才產生 CSV（不在每次收到新的一張時重建） */
function downloadCsv(rows: Row[]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'quality_batch.csv'
  a.click()
  // 點擊後立即釋放物件 URL，避免累積記憶體
  URL.revokeObjectURL(url)
}

/**
 * 把批次結果轉成 CSV 字串（中文欄名）。
 * - 每格都以雙引號包起並把內部的 " 轉成 ""，路徑或錯誤訊息含逗號、換行時也不會錯欄。
 * - undefined／null 輸出為空字串（讀取失敗的列沒有指標）。
 * - 開頭加 UTF-8 BOM、換行用 CRLF，讓 Excel 直接開啟時能正確辨識中文。
 */
function toCsv(rows: Row[]): string {
  const head = [
    '檔案',
    '路徑',
    '短邊',
    '模糊分數',
    '平均亮度',
    '過暗比例',
    '過亮比例',
    '解析度通過',
    '通過',
    '警告',
    '錯誤',
  ]
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((r) =>
    [
      r.file,
      r.path,
      r.short_side,
      r.blur_score,
      r.mean_brightness,
      r.dark_ratio,
      r.bright_ratio,
      r.resolution_ok,
      r.passed,
      (r.warnings ?? []).join(' '),
      r.error,
    ]
      .map(cell)
      .join(','),
  )
  return '﻿' + [head.map(cell).join(','), ...lines].join('\r\n')
}

/**
 * 資料夾批次頁：對伺服器本機資料夾內的照片逐張做品質檢查，結果經 SSE 逐張回報。
 * 主檢視有三個分頁：每張結果（可點選檢視單張）、分數分布（附門檻線）、警告次數。
 * 與其他工具頁不同，參數修改後不會自動重算（整批可能數千張），要按「執行」才以新參數重跑。
 */
export function BatchPage() {
  const quality = useConfigClass('QualityConfig').schema
  const [folder, setFolder] = useState('')
  const [limit, setLimit] = useState(500)
  const [recursive, setRecursive] = useState(false)
  // 目前表單上的參數覆寫
  const [config, setConfig] = useState<ConfigOverride>({})
  // 最近一次執行時使用的參數；門檻線與單張診斷檢視用它，才會與表格中的結果一致
  const [ranWith, setRanWith] = useState<ConfigOverride | null>(null)
  const [view, setView] = useState('table')
  const [dist, setDist] = useState<DistKey>('blur_score')
  const [selected, setSelected] = useState<Row | null>(null)
  // SSE 串流；useStream 每 100 ms 才把累積的事件更新到畫面，離開頁面時自動取消
  const stream = useStream<BatchEvent>('/workbench/v1/dev/batches')

  // 由事件清單推導各種狀態（每次重繪重新篩選；事件以 100 ms 批次更新，所以成本可接受）
  const start = stream.events.find((e) => e.type === 'start')
  const rows = stream.events.filter((e): e is Row => e.type === 'row')
  const summary = stream.events.find((e): e is Summary => e.type === 'summary')
  // 成功讀取的影像；分布圖與警告比例只用這些，讀取失敗的不計入
  const ok = rows.filter((r) => r.error === null)
  const running = stream.status === 'running'

  // 開始一次新的批次：清掉舊的選取（舊列已不存在），並記下這次使用的參數
  const run = () => {
    setSelected(null)
    setRanWith(config)
    void stream.run({ folder, limit, recursive, config: overrideBody(config) })
  }
  // 依欄位名稱取門檻值：優先用執行時的參數，尚未執行時用表單目前的參數；
  // 沒有對應門檻（或設定結構尚未載入）時回傳 undefined，分布圖就不畫門檻線
  const threshold = (name: string | null) => {
    const f = name ? quality?.fields.find((x) => x.name === name) : undefined
    return f ? (valueOf(f, ranWith ?? config) as number) : undefined
  }

  const panel = (
    <Tabs defaultValue="folder">
      <div className="bg-card sticky top-0 z-10 p-3 pb-2">
        <TabsList>
          <TabsTrigger value="folder">{withIcon(FolderOpen, '資料夾')}</TabsTrigger>
          <TabsTrigger value="params">
            參數
            {Object.keys(config).length > 0 && (
              <Badge tone="primary">{Object.keys(config).length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="io">匯出入</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="folder" className="px-4 pt-2 pb-4">
        <form
          className="space-y-3 text-sm"
          // 用 form 讓輸入框按 Enter 也能執行；路徑空白時不送出
          onSubmit={(e) => {
            e.preventDefault()
            if (folder.trim()) run()
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs">資料夾（伺服器本機路徑）</span>
            <input
              aria-label="資料夾"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="..\research\data\splits\dev"
              className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card readout h-7 rounded-lg border px-2 text-xs focus-visible:outline-none"
            />
          </label>
          <p className="text-muted text-xs">
            相對於 ai/ 或絕對路徑。splits/test 會被拒絕（測試集鎖定）。
          </p>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted">最多張數</span>
              <input
                aria-label="最多張數"
                type="number"
                min={1}
                max={5000}
                value={limit}
                // 限制在 1–5000；清空或非數字時視為 1
                onChange={(e) => setLimit(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
                className="border-card-border bg-sunken readout h-6 w-20 rounded-lg border px-1.5 text-right"
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
              />
              包含子資料夾
            </label>
          </div>
          {running ? (
            <Button variant="outline" className="w-full" onClick={stream.cancel}>
              <Square className="size-4" aria-hidden />
              停止
            </Button>
          ) : (
            <Button type="submit" variant="primary" className="w-full" disabled={!folder.trim()}>
              <Play className="size-4" aria-hidden />
              執行
            </Button>
          )}
        </form>
      </TabsContent>
      <TabsContent value="params" className="px-4 pt-2 pb-4">
        {quality && <ParamForm schema={quality} overrides={config} onChange={setConfig} />}
      </TabsContent>
      <TabsContent value="io" className="px-4 pt-2 pb-4">
        {quality && <ConfigIO schema={quality} overrides={config} onImport={setConfig} />}
      </TabsContent>
    </Tabs>
  )

  const total = start?.type === 'start' ? start.total : 0
  // 執行後參數又被修改：提示使用者目前畫面上的結果是舊參數算的。
  // 以 JSON 字串比較內容（物件參照每次編輯都會變）
  const changed = ranWith !== null && JSON.stringify(ranWith) !== JSON.stringify(config)

  // 每張結果表格；只畫前 MAX_TABLE_ROWS 列。讀取失敗的列以一格合併顯示錯誤，且不可選取
  const table = (
    <table className="w-full text-[13px]" aria-label="每張影像的品質檢查結果">
      <thead className="bg-card sticky top-0">
        <tr className="text-muted bg-sunken text-left text-xs">
          {['檔案', '模糊分數', '過暗', '過亮', '短邊', '通過', '警告'].map((c) => (
            <th key={c} className="px-2 py-2 font-medium first:rounded-l-xl last:rounded-r-xl">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, MAX_TABLE_ROWS).map((r) => (
          <tr
            key={r.index}
            onClick={() => r.error === null && setSelected(r)}
            aria-selected={selected?.index === r.index}
            className={cn(
              'border-card-border tabular cursor-pointer border-b last:border-0',
              selected?.index === r.index
                ? 'bg-primary-soft shadow-[inset_3px_0_0_var(--primary)]'
                : 'hover:bg-hover',
            )}
          >
            <td className="px-2 py-1">{r.file}</td>
            {r.error !== null ? (
              <td colSpan={6} className="text-danger px-2 py-1 text-xs">
                {r.error}
              </td>
            ) : (
              <>
                <td className="readout px-2 text-xs">{r.blur_score?.toFixed(0)}</td>
                <td className="readout px-2 text-xs">{pct(r.dark_ratio ?? 0)}</td>
                <td className="readout px-2 text-xs">{pct(r.bright_ratio ?? 0)}</td>
                <td className="readout px-2 text-xs">{r.short_side}</td>
                <td className={cn('px-2', r.passed ? 'text-ok' : 'text-danger')}>
                  {r.passed ? '通過' : '未通過'}
                </td>
                <td className="px-2 text-xs">
                  {(r.warnings ?? []).map(warningText).join('、') || '—'}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <Workspace
      panel={panel}
      title="資料夾批次"
      description="對資料夾內的照片批次執行品質檢查，看目前門檻下的通過率與分數分布；點選表格列可檢視單張。"
      aside={
        running ? (
          <Badge tone="primary" aria-live="polite">
            處理中 {rows.length} / {total} 張
          </Badge>
        ) : changed ? (
          <Badge tone="warn">參數已修改，按「執行」以新的參數重新計算。</Badge>
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* 進度條：已收到的列數 ÷ start 事件的總張數（還沒收到 start 時為 0%） */}
        {running && (
          <div
            className="bg-card mx-1 mb-3 h-1.5 shrink-0 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="處理進度"
            aria-valuenow={rows.length}
            aria-valuemax={total}
          >
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${total ? (rows.length / total) * 100 : 0}%` }}
            />
          </div>
        )}
        {stream.error ? (
          <div className="border-card-border shrink-0 border-b p-3">
            <ErrorBox error={stream.error} />
          </div>
        ) : null}
        {/* 尚未執行 → 提示；資料夾沒有影像 → 提示；其餘（執行中、完成、取消、錯誤）顯示已收到的結果 */}
        {stream.status === 'idle' ? (
          <EmptyState icon={<FolderOpen className="size-8" aria-hidden />}>
            在左側「資料夾」輸入路徑後按「執行」。
          </EmptyState>
        ) : start && total === 0 ? (
          <EmptyState>資料夾中沒有影像。</EmptyState>
        ) : (
          <div className="min-h-0 flex-1">
            <Split
              readout={
                <ReadoutBlock title="彙整">
                  {/* 完成後用後端 summary；執行中或被取消（沒有 summary）時張數暫用已收到的列數，
                      通過率與警告次數則等 summary 才顯示 */}
                  <MetricGrid>
                    <Metric label="張數" value={String(summary?.count ?? rows.length)} />
                    <Metric
                      label="通過率"
                      value={summary?.pass_rate != null ? pct(summary.pass_rate) : '—'}
                    />
                    {Object.entries(summary?.warning_counts ?? {}).map(([code, n]) => (
                      <Metric key={code} label={warningText(code)} value={String(n)} />
                    ))}
                    {summary && summary.failed > 0 && (
                      <Metric label="讀取失敗" value={String(summary.failed)} good={false} />
                    )}
                  </MetricGrid>
                </ReadoutBlock>
              }
              main={
                <MainView
                  // 每張結果分頁自行切分表格與單張檢視並各自捲動，因此不讓整個主檢視捲動
                  scroll={view !== 'table'}
                  toolbar={
                    <>
                      <Segmented
                        label="檢視"
                        value={view}
                        onChange={setView}
                        options={[
                          { value: 'table', label: withIcon(Table, '每張結果') },
                          { value: 'dist', label: withIcon(BarChart3, '分數分布') },
                          { value: 'warn', label: withIcon(TriangleAlert, '警告次數') },
                        ]}
                      />
                      {view === 'dist' && (
                        <Segmented
                          label="指標"
                          value={dist}
                          onChange={setDist}
                          options={(Object.keys(DIST) as DistKey[]).map((k) => ({
                            value: k,
                            label: DIST[k].label,
                          }))}
                        />
                      )}
                      <span className="flex-1" />
                      {view === 'table' && (
                        <button
                          type="button"
                          onClick={() => downloadCsv(rows)}
                          className="text-primary-ink inline-flex items-center gap-1 text-xs hover:underline"
                        >
                          <Download className="size-3.5" aria-hidden />
                          下載 CSV
                        </button>
                      )}
                    </>
                  }
                  footer={
                    view === 'table' && rows.length > MAX_TABLE_ROWS
                      ? `只顯示前 ${MAX_TABLE_ROWS} 張；完整結果請下載 CSV。`
                      : undefined
                  }
                >
                  {view === 'dist' ? (
                    // 只用成功讀取的影像；門檻取執行時的參數（見 threshold）
                    <ValueHistogram
                      label={`${DIST[dist].label}的分布與目前門檻`}
                      xLabel={DIST[dist].label}
                      values={ok.map((r) => r[dist] ?? 0)}
                      threshold={threshold(DIST[dist].threshold)}
                    />
                  ) : view === 'warn' ? (
                    // 長條長度＝出現該警告的張數 ÷ 成功讀取的張數；警告次數來自 summary，完成前為空
                    <BarList
                      label="各警告的張數"
                      rows={Object.entries(summary?.warning_counts ?? {}).map(([code, n]) => ({
                        label: warningText(code),
                        value: ok.length ? n / ok.length : 0,
                        note: `（${n} 張）`,
                      }))}
                    />
                  ) : (
                    <>
                      <div
                        className={cn(
                          'overflow-auto',
                          selected ? 'max-h-[40%] shrink-0' : 'flex-1',
                        )}
                      >
                        {table}
                      </div>
                      {selected ? (
                        <Detail row={selected} config={ranWith ?? config} />
                      ) : (
                        <p className="text-muted shrink-0 px-1 pt-3 text-xs">
                          點選一列即可在下方檢視該影像。
                        </p>
                      )}
                    </>
                  )}
                </MainView>
              }
            />
          </div>
        )}
      </div>
    </Workspace>
  )
}

/**
 * 單張檢視：載入選取列的原圖，並可切換到後端產生的診斷檢視
 * （邊緣響應＝Laplacian，對應模糊分數；曝光遮罩，對應過暗／過亮比例）。
 *
 * @param row 選取的結果列（必為成功讀取的列）
 * @param config 算出這批結果時的參數，讓診斷檢視與表格數字一致
 */
function Detail({ row, config }: { row: Row; config: ConfigOverride }) {
  // 把伺服器本機路徑載入暫存區取得 image_id
  const image = useLocalImage(row.path)
  const [view, setView] = useState<'original' | 'laplacian' | 'exposure'>('original')
  // hook 不能條件式呼叫，所以一律呼叫：看原圖時以 enabled = false 停用查詢，
  // 檢視名稱暫填 'laplacian' 只是為了滿足型別
  const rendered = useRenderView(
    image.data?.image_id,
    view === 'original' ? 'laplacian' : view,
    config,
    view !== 'original',
  )
  // 目前要顯示的影像：原圖或診斷檢視的輸出；尚未載入時為 undefined
  const shown = view === 'original' ? image.data : rendered.data?.image
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 py-2.5">
        <h3 className="readout truncate text-xs font-medium">{row.file}</h3>
        <Segmented
          label="單張檢視"
          value={view}
          onChange={setView}
          options={[
            { value: 'original', label: '原圖' },
            { value: 'laplacian', label: '邊緣響應' },
            { value: 'exposure', label: '曝光遮罩' },
          ]}
        />
      </div>
      {image.error || rendered.error ? (
        <div className="px-4 pt-2 pb-4">
          <ErrorBox error={image.error ?? rendered.error} />
        </div>
      ) : !shown ? (
        <EmptyState>載入中…</EmptyState>
      ) : (
        <ImageViewer
          fill
          src={artifactUrl(shown.image_id)}
          width={shown.width}
          height={shown.height}
          alt={`${row.file}（${view}）`}
          // 暫存影像被淘汰或 Python 重啟時重新載入
          onError={image.reload}
        />
      )}
    </div>
  )
}
