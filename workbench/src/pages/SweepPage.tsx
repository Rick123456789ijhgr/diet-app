// 模組一：參數掃描。一種退化由弱到強：品質檢查看指標在哪個等級越過門檻；
// 條碼比較只用原圖與逐步升級的成功率。
import { Barcode, ChartLine, Layers, ScanSearch, Table, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api, artifactUrl, overrideBody, unwrap, type ConfigOverride } from '@/api/client'
import { LineChart, PALETTE, StackedBars } from '@/components/charts'
import { ConfigIO } from '@/components/ConfigIO'
import { ImageSourcePanel } from '@/components/ImageSourcePanel'
import { LadderControls } from '@/components/LadderControls'
import { EmptyState, MainView, ReadoutBlock, Split, Workspace } from '@/components/layout/Workspace'
import { ParamForm } from '@/components/ParamForm'
import { DataTable, ErrorBox, Metric, MetricGrid } from '@/components/results'
import { ToolPanel } from '@/components/ToolPanel'
import { Badge, DraftNumberInput, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useConfigClass, useConfigSchemas } from '@/hooks/useConfigSchemas'
import { useImagePipeline } from '@/hooks/useImagePipeline'
import { cn } from '@/lib/cn'
import { valueOf } from '@/lib/config'
import { SWEEP_AXES, axisOf } from '@/lib/sweepAxes'
import { rungText, warningText } from '@/lib/text'

type Target = 'quality' | 'barcode'

interface Thumb {
  level: number
  image_id: string
  width: number
  height: number
}

interface QualityRow {
  level: number
  blur_score: number
  mean_brightness: number
  dark_ratio: number
  bright_ratio: number
  resolution_ok: boolean
  passed: boolean
  warnings: string[]
}

interface QualitySweep {
  axis: string
  levels: number[]
  rows: QualityRow[]
  triggers: Record<string, number | null>
  thumbs: Thumb[]
}

interface BarcodeSweep {
  axis: string
  levels: number[]
  rates: { level: number; method: 'raw' | 'ladder'; rate: number }[]
  rung_counts: { level: number; rung: string; count: number }[]
  overall: { raw: number; ladder: number }
  first_failure: { raw: number | null; ladder: number | null }
  rows: {
    level: number
    sample: number
    raw: boolean
    ladder: boolean
    success_rung: string
    attempts: number
  }[]
  thumbs: Thumb[]
}

/** 圖表指標 → （欄位, 對應的門檻欄位, 門檻種類） */
const METRICS = {
  blur_score: { label: '模糊分數', threshold: 'blur_min', kind: '下限' },
  dark_ratio: { label: '過暗比例', threshold: 'dark_ratio_max', kind: '上限' },
  bright_ratio: { label: '過亮比例', threshold: 'bright_ratio_max', kind: '上限' },
  mean_brightness: { label: '平均亮度', threshold: null, kind: '' },
} as const
type MetricKey = keyof typeof METRICS

const METHOD_TEXT = { raw: '只用原圖', ladder: '逐步升級' }
const pct = (v: number) => `${Math.round(v * 100)}%`

export function SweepPage() {
  const schemas = useConfigSchemas()
  const quality = useConfigClass('QualityConfig').schema
  const ladderSchema = useConfigClass('LadderConfig').schema
  const zxingSchema = useConfigClass('ZxingConfig').schema
  const pipeline = useImagePipeline('label')
  const [target, setTarget] = useState<Target>('quality')
  const [axisKey, setAxisKey] = useState('blur_sigma')
  const axis = axisOf(axisKey)
  const [range, setRange] = useState<[number, number]>([axis.defaultLo, axis.defaultHi])
  const [n, setN] = useState(9)
  const [samples, setSamples] = useState({ samples: 5, module_px: 4, seed: 0 })
  const [config, setConfig] = useState<ConfigOverride>({})
  const [ladder, setLadder] = useState<ConfigOverride>({})
  const [zxing, setZxing] = useState<ConfigOverride>({})
  const [metric, setMetric] = useState<MetricKey>('blur_score')
  const [view, setView] = useState('chart')
  const image = pipeline.image

  const params = useMemo(
    () =>
      target === 'quality'
        ? { axis: axisKey, lo: range[0], hi: range[1], n, image_id: image?.image_id, config }
        : {
            axis: axisKey,
            lo: range[0],
            hi: range[1],
            n,
            ...samples,
            ladder: overrideBody(ladder),
            zxing: overrideBody(zxing),
          },
    [target, axisKey, range, n, image?.image_id, config, samples, ladder, zxing],
  )
  const analysis = useAnalysis({
    name: `sweep-${target}`,
    // 條碼掃描用合成樣本，不需要影像
    imageId: target === 'quality' ? image?.image_id : 'synthetic-ean13',
    config: params,
    run: (_id, p, signal) =>
      unwrap(api.POST('/workbench/v1/dev/sweeps', { body: { target, params: p }, signal })),
  })
  const result = analysis.shown?.data

  const setAxis = (key: string) => {
    const a = axisOf(key)
    setAxisKey(key)
    setRange([a.defaultLo, a.defaultHi])
  }
  const switchTarget = (t: Target) => {
    setTarget(t)
    setView('chart')
    if (t === 'barcode' && axisKey === 'blur_sigma') setAxis('rotate_deg')
  }

  const sweepControls = (
    <div className="space-y-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">退化種類</span>
        <select
          aria-label="退化種類"
          value={axisKey}
          onChange={(e) => setAxis(e.target.value)}
          className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card h-7 rounded-[3px] border px-2 text-xs focus-visible:outline-none"
        >
          {SWEEP_AXES.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2">
        {(['下限', '上限'] as const).map((label, i) => (
          <div key={label} className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{label}</span>
            <DraftNumberInput
              aria-label={`範圍${label}`}
              step={axis.step}
              value={range[i]!}
              parse={(t) => {
                const v = Number(t)
                return v >= axis.lo && v <= axis.hi ? v : undefined
              }}
              onCommit={(v) => setRange(i === 0 ? [v, range[1]] : [range[0], v])}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted">點數</span>
          <DraftNumberInput
            aria-label="點數"
            value={n}
            parse={(t) => {
              const v = Math.round(Number(t))
              return v >= 3 && v <= 30 ? v : undefined
            }}
            onCommit={setN}
          />
        </div>
      </div>
      <p className="text-muted text-xs">
        可用範圍 {axis.lo}–{axis.hi}；在範圍內等距取點。
      </p>
      {target === 'barcode' && (
        <div className="border-card-border space-y-2 border-t pt-3">
          <p className="text-muted text-xs">
            樣本為合成 EAN-13，內容各不相同；成功率為成功樣本數除以樣本數。
          </p>
          <div className="flex items-end gap-2">
            {(
              [
                ['samples', '樣本數', 1, 30],
                ['module_px', '模組寬', 1, 12],
                ['seed', '種子', 0, 10000],
              ] as const
            ).map(([key, label, lo, hi]) => (
              <div key={key} className="flex flex-col gap-1 text-xs">
                <span className="text-muted">{label}</span>
                <DraftNumberInput
                  aria-label={label}
                  value={samples[key]}
                  parse={(t) => {
                    const v = Math.round(Number(t))
                    return v >= lo && v <= hi ? v : undefined
                  }}
                  onCommit={(v) => setSamples({ ...samples, [key]: v })}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const panel =
    target === 'quality' ? (
      <ToolPanel
        changed={Object.keys(config).length}
        image={
          <div className="space-y-5">
            {sweepControls}
            <div className="border-card-border border-t pt-4">
              <h3 className="mb-2 text-sm font-semibold">基準影像</h3>
              <ImageSourcePanel pipeline={pipeline} scene="label" />
            </div>
          </div>
        }
        params={
          quality && (
            <ParamForm
              schema={quality}
              overrides={config}
              onChange={setConfig}
              invalidField={analysis.configError?.field}
              invalidMessage={analysis.configError?.message}
            />
          )
        }
        io={quality && <ConfigIO schema={quality} overrides={config} onImport={setConfig} />}
      />
    ) : (
      <ToolPanel
        imageLabel="掃描"
        paramsLabel="階梯參數"
        changed={Object.keys(ladder).length + Object.keys(zxing).length}
        image={sweepControls}
        params={
          ladderSchema &&
          zxingSchema && (
            <div className="space-y-6">
              <LadderControls
                schema={ladderSchema}
                overrides={ladder}
                onChange={setLadder}
                rungs={schemas.data?.enums.Rung ?? []}
                formats={(schemas.data?.enums.CodeFormat ?? []).filter((f) => f !== 'OTHER')}
                showFormats
              />
              <ParamForm
                schema={ladderSchema}
                overrides={Object.fromEntries(
                  Object.entries(ladder).filter(([, v]) => !Array.isArray(v)),
                )}
                onChange={(o) =>
                  setLadder({
                    ...o,
                    ...Object.fromEntries(
                      Object.entries(ladder).filter(([, v]) => Array.isArray(v)),
                    ),
                  })
                }
                invalidField={analysis.configError?.field}
                invalidMessage={analysis.configError?.message}
              />
              <ParamForm schema={zxingSchema} overrides={zxing} onChange={setZxing} />
            </div>
          )
        }
        io={
          ladderSchema && <ConfigIO schema={ladderSchema} overrides={ladder} onImport={setLadder} />
        }
      />
    )

  const qualityResult =
    target === 'quality' && result && 'triggers' in result
      ? (result as unknown as QualitySweep)
      : undefined
  const barcodeResult =
    target === 'barcode' && result && 'overall' in result
      ? (result as unknown as BarcodeSweep)
      : undefined

  return (
    <Workspace
      panel={panel}
      title="參數掃描"
      description="一種退化由弱到強：品質檢查看指標在哪個等級越過門檻；條碼比較只用原圖與逐步升級的成功率。"
      aside={
        <div className="flex items-center gap-2">
          {(pipeline.pending || analysis.busy) && (
            <Badge tone="primary" aria-live="polite">
              計算中…
            </Badge>
          )}
          <Segmented
            label="評估對象"
            value={target}
            onChange={switchTarget}
            options={[
              { value: 'quality', label: withIcon(ScanSearch, '品質檢查') },
              { value: 'barcode', label: withIcon(Barcode, '條碼解碼') },
            ]}
          />
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {analysis.query.error && (
          <div className="border-card-border shrink-0 border-b p-3">
            <ErrorBox
              error={analysis.query.error}
              hint={analysis.configError ? '請在左側參數修正標紅的欄位。' : undefined}
            />
          </div>
        )}
        {!qualityResult && !barcodeResult ? (
          !analysis.query.error && <EmptyState>計算中…</EmptyState>
        ) : (
          <div className={cn('min-h-0 flex-1 transition-opacity', analysis.stale && 'opacity-60')}>
            {qualityResult && quality ? (
              <QualityResultView
                r={qualityResult}
                // 標籤用算出這份結果的退化種類，而不是畫面上最新選的
                axisLabel={axisOf(qualityResult.axis).label}
                metric={metric}
                setMetric={setMetric}
                view={view}
                setView={setView}
                threshold={(name) =>
                  // 門檻用算出這條曲線的那組參數，而不是畫面上最新的參數
                  valueOf(
                    quality.fields.find((f) => f.name === name)!,
                    (analysis.shown?.config as { config?: ConfigOverride } | undefined)?.config ??
                      {},
                  ) as number
                }
              />
            ) : barcodeResult ? (
              <BarcodeResultView
                r={barcodeResult}
                axisLabel={axisOf(barcodeResult.axis).label}
                view={view}
                setView={setView}
              />
            ) : null}
          </div>
        )}
      </div>
    </Workspace>
  )
}

/** 最弱、中間、最強三個等級的縮圖（讀數欄，直向排列）。 */
function Thumbs({ thumbs, axisLabel }: { thumbs: Thumb[]; axisLabel: string }) {
  return (
    <ReadoutBlock title="退化樣本">
      <div className="space-y-2">
        {thumbs.map((t) => (
          <figure key={t.image_id} className="border-card-border rounded-[3px] border">
            <div className="viewport-grid rounded-t-[2px]">
              <img
                src={artifactUrl(t.image_id)}
                alt={`${axisLabel} ${Number(t.level.toPrecision(3))} 的影像`}
                className="h-28 w-full object-contain"
              />
            </div>
            <figcaption className="text-muted border-card-border readout border-t px-2 py-1 text-[11px]">
              {axisLabel} = {Number(t.level.toPrecision(3))}
            </figcaption>
          </figure>
        ))}
      </div>
    </ReadoutBlock>
  )
}

function QualityResultView({
  r,
  axisLabel,
  metric,
  setMetric,
  view,
  setView,
  threshold,
}: {
  r: QualitySweep
  axisLabel: string
  metric: MetricKey
  setMetric: (m: MetricKey) => void
  view: string
  setView: (v: string) => void
  threshold: (name: string) => number
}) {
  const m = METRICS[metric]
  const isRatio = metric === 'dark_ratio' || metric === 'bright_ratio'
  return (
    <Split
      readout={
        <>
          <ReadoutBlock title="首次觸發的等級">
            <MetricGrid>
              {Object.entries(r.triggers).map(([code, level]) => (
                <Metric
                  key={code}
                  label={warningText(code)}
                  value={level === null ? '未觸發' : `≥ ${Number(level.toPrecision(3))}`}
                  help={`${axisLabel}達到此等級時首次出現「${warningText(code)}」。`}
                />
              ))}
            </MetricGrid>
          </ReadoutBlock>
          <Thumbs thumbs={r.thumbs} axisLabel={axisLabel} />
        </>
      }
      main={
        <MainView
          scroll
          toolbar={
            <>
              <Segmented
                label="檢視"
                value={view}
                onChange={setView}
                options={[
                  { value: 'chart', label: withIcon(ChartLine, '指標曲線') },
                  { value: 'table', label: withIcon(Table, '明細') },
                ]}
              />
              {view !== 'table' && (
                <Segmented
                  label="圖表指標"
                  value={metric}
                  onChange={setMetric}
                  options={(Object.keys(METRICS) as MetricKey[]).map((k) => ({
                    value: k,
                    label: METRICS[k].label,
                  }))}
                />
              )}
            </>
          }
        >
          {view === 'table' ? (
            <DataTable
              label="每個退化等級的品質檢查結果"
              columns={['等級', '模糊分數', '平均亮度', '過暗比例', '過亮比例', '通過', '警告']}
              rows={r.rows.map((row) => [
                Number(row.level.toPrecision(4)),
                row.blur_score.toFixed(0),
                row.mean_brightness.toFixed(0),
                `${(row.dark_ratio * 100).toFixed(1)}%`,
                `${(row.bright_ratio * 100).toFixed(1)}%`,
                row.passed ? '是' : '否',
                row.warnings.map(warningText).join('、') || '—',
              ])}
            />
          ) : (
            <>
              <LineChart
                label={`${m.label}隨${axisLabel}變化的折線圖`}
                xLabel={axisLabel}
                yFormat={isRatio ? pct : undefined}
                yDomain={isRatio ? [0, 1] : undefined}
                series={[
                  {
                    name: m.label,
                    color: PALETTE[0]!,
                    points: r.rows.map((row) => ({ x: row.level, y: row[metric] })),
                  },
                ]}
                thresholds={
                  m.threshold
                    ? [
                        {
                          y: threshold(m.threshold),
                          label: `${m.threshold}（${m.kind}）= ${threshold(m.threshold)}`,
                        },
                      ]
                    : []
                }
              />
            </>
          )}
        </MainView>
      }
    />
  )
}

function BarcodeResultView({
  r,
  axisLabel,
  view,
  setView,
}: {
  r: BarcodeSweep
  axisLabel: string
  view: string
  setView: (v: string) => void
}) {
  const fail = (v: number | null) =>
    v === null ? '全部成功' : `首次失敗於 ${Number(v.toPrecision(3))}`
  const gain = r.overall.ladder - r.overall.raw
  const rungs = [...new Set(r.rung_counts.map((c) => c.rung))]
  return (
    <Split
      readout={
        <>
          <ReadoutBlock title="整體成功率">
            <MetricGrid>
              <Metric
                label="只用原圖"
                value={pct(r.overall.raw)}
                delta={fail(r.first_failure.raw)}
                help="所有等級與樣本的整體成功率；首次失敗為成功率首次低於 100% 的等級。"
              />
              <Metric
                label="逐步升級"
                value={pct(r.overall.ladder)}
                delta={fail(r.first_failure.ladder)}
              />
              <Metric
                label="提升"
                value={`${gain >= 0 ? '+' : '−'}${pct(Math.abs(gain))}`}
                good={gain > 0 ? true : gain < 0 ? false : undefined}
                delta="逐步升級減只用原圖"
                wide
              />
            </MetricGrid>
          </ReadoutBlock>
          <Thumbs thumbs={r.thumbs} axisLabel={axisLabel} />
        </>
      }
      main={
        <MainView
          scroll
          toolbar={
            <Segmented
              label="檢視"
              value={view}
              onChange={setView}
              options={[
                { value: 'chart', label: withIcon(TrendingUp, '成功率') },
                { value: 'rung', label: withIcon(Layers, '成功階') },
                { value: 'table', label: withIcon(Table, '明細') },
              ]}
            />
          }
        >
          {view === 'table' ? (
            <DataTable
              label="每個等級與樣本的解碼結果"
              columns={['等級', '樣本', '只用原圖', '逐步升級', '成功階', '嘗試次數']}
              rows={r.rows.map((row) => [
                Number(row.level.toPrecision(4)),
                row.sample + 1,
                row.raw ? '成功' : '失敗',
                row.ladder ? '成功' : '失敗',
                row.success_rung ? rungText(row.success_rung) : '—',
                row.attempts,
              ])}
            />
          ) : view === 'rung' ? (
            rungs.length === 0 ? (
              <EmptyState>逐步升級沒有任何成功的樣本。</EmptyState>
            ) : (
              <StackedBars
                label="各等級中逐步升級成功於哪一階的樣本數"
                keys={rungs}
                keyLabel={rungText}
                rows={r.levels.map((level) => ({
                  label: `${axisLabel} ${Number(level.toPrecision(3))}`,
                  values: Object.fromEntries(
                    r.rung_counts.filter((c) => c.level === level).map((c) => [c.rung, c.count]),
                  ),
                }))}
              />
            )
          ) : (
            <>
              <LineChart
                label={`兩種方法的成功率隨${axisLabel}變化`}
                xLabel={axisLabel}
                yDomain={[0, 1]}
                yFormat={pct}
                series={(['raw', 'ladder'] as const).map((method, i) => ({
                  name: METHOD_TEXT[method],
                  color: PALETTE[i]!,
                  dashed: method === 'raw',
                  points: r.rates
                    .filter((x) => x.method === method)
                    .map((x) => ({ x: x.level, y: x.rate })),
                }))}
              />
            </>
          )}
        </MainView>
      }
    />
  )
}
