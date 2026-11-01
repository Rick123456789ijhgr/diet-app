// 模組一：參數掃描。一種退化由弱到強：品質檢查看指標在哪個等級越過門檻；
// 條碼以合成樣本對真值評分，比較只用原圖與逐步升級的成功率與誤讀率，並對照品質門檻。
import { Barcode, ChartLine, Gauge, Layers, ScanSearch, Table, TrendingUp } from 'lucide-react'
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
import { orderRungs } from '@/lib/ordering'
import { SWEEP_AXES, axisOf } from '@/lib/sweepAxes'
import { rungText, warningText } from '@/lib/text'

/** 評估對象：品質檢查（用使用者的基準影像）或條碼解碼（用後端產生的合成 EAN-13）。 */
type Target = 'quality' | 'barcode'

// 以下型別是本頁自行宣告的掃描結果形狀（規格中 /dev/sweeps 的回應是自由 JSON：FreeJson），
// 取得後以 'triggers' / 'overall' 欄位判斷是哪一種再轉型。

/** 某一個退化等級的縮圖（後端挑最弱、中間、最強三個等級）。 */
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

/**
 * 品質檢查掃描結果。rows 為每個等級的品質指標；
 * triggers 為「警告代碼 → 首次出現該警告的等級」，整個範圍都沒出現時為 null。
 */
interface QualitySweep {
  axis: string
  levels: number[]
  rows: QualityRow[]
  triggers: Record<string, number | null>
  thumbs: Thumb[]
}

/** E1 的判定代碼：讀對、讀成別的號碼、沒讀出來。 */
type Outcome = 'correct' | 'misread' | 'missed'

/**
 * 條碼掃描結果：比較「只用原圖（raw）」與「逐步升級（ladder）」，一律對真值判定（同 E1）。
 * - rates：每個等級、每種方法的成功率（讀對的樣本數 ÷ 樣本數）與誤讀率。
 * - rung_counts：每個等級中逐步升級讀對於哪一階的樣本數（誤讀不計）。
 * - overall／misread：所有等級與樣本合計的成功率與誤讀率；
 *   first_failure：成功率首次低於 100% 的等級（全部成功為 null）。
 * - quality_rates：每個等級品質檢查不通過的比例；quality_triggers：各警告首次在至少半數樣本出現的等級。
 * - alarms：品質檢查與逐步升級結果的四格對照（該重拍、誤報、漏報、正常），單位為樣本數。
 * - rows：每個等級 × 每個樣本的明細（sample 從 0 起算）。
 */
interface BarcodeSweep {
  axis: string
  levels: number[]
  rates: { level: number; method: 'raw' | 'ladder'; rate: number; misread: number }[]
  rung_counts: { level: number; rung: string; count: number }[]
  overall: { raw: number; ladder: number }
  misread: { raw: number; ladder: number }
  first_failure: { raw: number | null; ladder: number | null }
  quality_rates: { level: number; rate: number }[]
  quality_triggers: Record<string, number | null>
  alarms: { retake: number; false_alarm: number; missed_alarm: number; ok: number }
  rows: {
    level: number
    sample: number
    truth: string
    raw: Outcome
    ladder: Outcome
    decoded: string
    success_rung: string
    attempts: number
    quality_passed: boolean
    warnings: string[]
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

/** 條碼兩種方法的中文名稱（圖例用）。 */
const METHOD_TEXT = { raw: '只用原圖', ladder: '逐步升級' }
/** 判定代碼的中文（明細表用）。 */
const OUTCOME_TEXT: Record<Outcome, string> = { correct: '正確', misread: '誤讀', missed: '漏讀' }
/** 適用範圍（ADR 0004）：伺服器端的逐步升級只服務無法重拍的靜態照片。 */
const SCOPE_NOTE = '適用：相簿匯入、冷啟動上傳等無法重拍的靜態照片；APP 即時掃描不經此流程。'
/** 比例轉整數百分比（圖表軸與讀數用）。 */
const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * 參數掃描頁：選一種退化（SWEEP_AXES）與範圍，後端在範圍內等距取 n 點逐級退化並評估。
 * - 品質檢查：對基準影像退化後跑品質檢查，看各指標的曲線與在哪個等級首次觸發警告；左側可調 QualityConfig。
 * - 條碼解碼：對合成 EAN-13 樣本退化後解碼並對真值判定，比較只用原圖與逐步升級的成功率與誤讀率；
 *   同一批樣本也跑品質檢查，對照門檻的誤報與漏報。左側可調 LadderConfig／ZxingConfig／QualityConfig。
 * 請求經 useAnalysis（防抖、取消舊請求、保留上一次結果並淡化）。
 */
export function SweepPage() {
  const schemas = useConfigSchemas()
  // 各設定類別的結構（自動產生 ParamForm 用）；載入前為 undefined，相關表單先不顯示
  const quality = useConfigClass('QualityConfig').schema
  const ladderSchema = useConfigClass('LadderConfig').schema
  const zxingSchema = useConfigClass('ZxingConfig').schema
  // 品質掃描的基準影像（以營養標示場景為預設）
  const pipeline = useImagePipeline('label')
  const [target, setTarget] = useState<Target>('quality')
  const [axisKey, setAxisKey] = useState('blur_sigma')
  const axis = axisOf(axisKey)
  // 掃描範圍 [下限, 上限]；換退化種類時由 setAxis 重設為該種類的預設範圍
  const [range, setRange] = useState<[number, number]>([axis.defaultLo, axis.defaultHi])
  // 取點數
  const [n, setN] = useState(9)
  // 條碼掃描的合成樣本設定：每個等級的樣本數、條碼模組寬（像素）、亂數種子
  const [samples, setSamples] = useState({ samples: 5, module_px: 4, seed: 0 })
  // 三組設定覆寫（只帶與預設值不同的欄位）
  const [config, setConfig] = useState<ConfigOverride>({})
  const [ladder, setLadder] = useState<ConfigOverride>({})
  const [zxing, setZxing] = useState<ConfigOverride>({})
  // 品質曲線要畫的指標；view 為主檢視分頁（兩種對象共用，切換對象時重設為 chart）
  const [metric, setMetric] = useState<MetricKey>('blur_score')
  const [view, setView] = useState('chart')
  const image = pipeline.image

  // 送給後端的掃描參數。用 useMemo 讓物件在輸入不變時保持同一參照：
  // useAnalysis 以「防抖後的值 === 目前的值」判斷防抖已跟上，每次 render 都產生新物件就永遠不會送出。
  // 品質掃描帶 image_id 與 QualityConfig；條碼掃描帶樣本設定與 ladder／zxing／config（沒有覆寫時為
  // undefined）。兩種對象共用同一組 QualityConfig 覆寫，切換時門檻不變。
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
            config: overrideBody(config),
          },
    [target, axisKey, range, n, image?.image_id, config, samples, ladder, zxing],
  )
  // 下限必須小於上限；不成立時不送出請求，並在範圍輸入旁顯示錯誤
  // （不在輸入時阻擋：使用者可能先改下限再改上限，中途暫時不成立）
  const rangeError = range[0] < range[1] ? undefined : '下限必須小於上限'
  // 查詢鍵為 [`sweep-${target}`, imageId, 防抖後的 params]，兩種對象的結果各自快取
  const analysis = useAnalysis({
    enabled: !rangeError,
    name: `sweep-${target}`,
    // 條碼掃描用合成樣本，不需要影像
    imageId: target === 'quality' ? image?.image_id : 'synthetic-ean13',
    config: params,
    run: (_id, p, signal) =>
      unwrap(api.POST('/workbench/v1/dev/sweeps', { body: { target, params: p }, signal })),
  })
  // 最近一次成功的結果；剛切換對象時可能仍是另一種對象的結果，下方以欄位判斷後才使用
  const result = analysis.shown?.data
  // 參數不合法時，畫面上的舊結果要淡化（查詢沒有送出，analysis.stale 不會反映）
  const stale = analysis.stale || !!rangeError

  // 換退化種類時一併重設範圍（各種類的單位與可用範圍不同，沿用舊範圍可能超出界限）
  const setAxis = (key: string) => {
    const a = axisOf(key)
    setAxisKey(key)
    setRange([a.defaultLo, a.defaultHi])
  }
  // 切換評估對象：分頁回到圖表（兩種對象的分頁不完全相同，例如條碼才有「成功階」）；
  // 切到條碼時若仍是預設的模糊，改成旋轉角度作為條碼的預設退化
  const switchTarget = (t: Target) => {
    setTarget(t)
    setView('chart')
    if (t === 'barcode' && axisKey === 'blur_sigma') setAxis('rotate_deg')
  }

  // 掃描設定（兩種對象共用）：退化種類、範圍、點數；條碼另有合成樣本設定
  const sweepControls = (
    <div className="space-y-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">退化種類</span>
        <select
          aria-label="退化種類"
          value={axisKey}
          onChange={(e) => setAxis(e.target.value)}
          className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card h-7 rounded-lg border px-2 text-xs focus-visible:outline-none"
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
              aria-invalid={rangeError ? true : undefined}
              aria-describedby={rangeError ? 'sweep-range-error' : undefined}
              // 超出該退化種類的可用範圍時回傳 undefined，DraftNumberInput 不提交；
              // 下限是否小於上限另由 rangeError 檢查
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
      {rangeError && (
        <p id="sweep-range-error" role="alert" className="text-danger text-xs">
          {rangeError}
        </p>
      )}
      <p className="text-muted text-xs">
        可用範圍 {axis.lo}–{axis.hi}；在範圍內等距取點。
      </p>
      {target === 'barcode' && (
        <div className="border-card-border space-y-2 border-t pt-3">
          <p className="text-muted text-xs">
            樣本為合成
            EAN-13，內容各不相同；成功率為讀對的樣本數除以樣本數，讀成別的號碼另計為誤讀。
          </p>
          <p className="text-muted text-xs">{SCOPE_NOTE}</p>
          <div className="flex items-end gap-2">
            {/* [欄位, 標籤, 最小值, 最大值]；輸入四捨五入成整數並限制在範圍內 */}
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

  // 左側面板依評估對象切換：品質＝掃描設定＋基準影像／QualityConfig；
  // 條碼＝掃描設定／階梯參數（LadderConfig＋ZxingConfig）＋品質門檻（QualityConfig，對照用）
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
        changed={
          Object.keys(ladder).length + Object.keys(zxing).length + Object.keys(config).length
        }
        image={sweepControls}
        params={
          ladderSchema &&
          zxingSchema &&
          quality && (
            <div className="space-y-6">
              <LadderControls
                schema={ladderSchema}
                overrides={ladder}
                onChange={setLadder}
                rungs={schemas.data?.enums.Rung ?? []}
                formats={(schemas.data?.enums.CodeFormat ?? []).filter((f) => f !== 'OTHER')}
                showFormats
              />
              {/* LadderConfig 的序列欄位（陣列值，例如階梯順序、格式）由上方 LadderControls 編輯，
                  其餘純量欄位由 ParamForm 編輯：傳入時濾掉陣列欄位，回寫時再把陣列欄位合併回去，
                  兩個元件才不會互相覆蓋對方的設定 */}
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
              {/* 後端回 INVALID_CONFIG 時各表單都傳入；只有含該欄位的表單會標紅 */}
              <ParamForm
                schema={zxingSchema}
                overrides={zxing}
                onChange={setZxing}
                invalidField={analysis.configError?.field}
                invalidMessage={analysis.configError?.message}
              />
              {/* 品質門檻不影響解碼，只用來對照「該不該請使用者重拍」（結果的品質門檻檢視） */}
              <div className="border-card-border space-y-2 border-t pt-4">
                <h3 className="text-sm font-semibold">品質門檻（對照用）</h3>
                <ParamForm
                  schema={quality}
                  overrides={config}
                  onChange={setConfig}
                  invalidField={analysis.configError?.field}
                  invalidMessage={analysis.configError?.message}
                />
              </div>
            </div>
          )
        }
        // 匯出入涵蓋 LadderConfig、ZxingConfig 與 QualityConfig 三組設定，各自匯出、匯入
        io={
          ladderSchema &&
          zxingSchema &&
          quality && (
            <div className="space-y-8">
              <ConfigIO
                title="階梯設定"
                schema={ladderSchema}
                overrides={ladder}
                onImport={setLadder}
              />
              <ConfigIO
                title="解碼器設定"
                schema={zxingSchema}
                overrides={zxing}
                onImport={setZxing}
              />
              <ConfigIO title="品質門檻" schema={quality} overrides={config} onImport={setConfig} />
            </div>
          )
        }
      />
    )

  // 依目前對象與結果的特徵欄位決定要顯示哪一種；切換對象後、新結果回來前兩者皆為 undefined，
  // 不會把另一種對象的舊結果套上錯誤的檢視
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
      description="一種退化由弱到強：品質檢查看指標在哪個等級越過門檻；條碼對真值評分，比較只用原圖與逐步升級的成功率與誤讀率，並對照品質門檻。"
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
        {/* 沒有可顯示的結果時：有錯誤就只顯示上方錯誤，否則顯示計算中；
            有結果時，參數已改或請求進行中則淡化舊結果（analysis.stale） */}
        {!qualityResult && !barcodeResult ? (
          !analysis.query.error && <EmptyState>計算中…</EmptyState>
        ) : (
          <div className={cn('min-h-0 flex-1 transition-opacity', stale && 'opacity-60')}>
            {qualityResult && quality ? (
              <QualityResultView
                r={qualityResult}
                // 標籤用算出這份結果的退化種類，而不是畫面上最新選的
                axisLabel={axisOf(qualityResult.axis).label}
                metric={metric}
                setMetric={setMetric}
                view={view}
                setView={setView}
                threshold={(name) => {
                  // 門檻用算出這條曲線的那組參數，而不是畫面上最新的參數。
                  // 欄位對不上（後端改名）時回傳 undefined，不畫門檻線，而不是崩潰
                  const field = quality.fields.find((f) => f.name === name)
                  if (!field) return undefined
                  const used =
                    (analysis.shown?.config as { config?: ConfigOverride } | undefined)?.config ??
                    {}
                  return { value: valueOf(field, used) as number, label: field.label }
                }}
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
          <figure key={t.image_id} className="bg-sunken overflow-hidden rounded-2xl">
            <div className="viewport-grid">
              <img
                src={artifactUrl(t.image_id)}
                alt={`${axisLabel} ${Number(t.level.toPrecision(3))} 的影像`}
                className="h-28 w-full object-contain"
              />
            </div>
            <figcaption className="text-muted tabular px-3 py-1.5 text-xs">
              {axisLabel} = {Number(t.level.toPrecision(3))}
            </figcaption>
          </figure>
        ))}
      </div>
    </ReadoutBlock>
  )
}

/**
 * 品質檢查掃描的結果檢視：讀數欄為各警告首次觸發的等級與縮圖；
 * 主檢視為所選指標隨退化等級變化的折線（附門檻線）或逐等級明細表。
 *
 * @param threshold 依欄位名稱取門檻值與中文欄位名稱；由父層提供「算出這份結果時」的參數值，
 *   欄位不存在時回傳 undefined（不畫門檻線）
 */
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
  threshold: (name: string) => { value: number; label: string } | undefined
}) {
  const m = METRICS[metric]
  const t = m.threshold ? threshold(m.threshold) : undefined
  // 比例類指標的 y 軸固定 0–1 並顯示百分比；其他指標由圖表依資料自動決定範圍
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
                // 有對應門檻的指標畫一條水平門檻線（平均亮度沒有單一門檻，不畫）；
                // 標籤用表單結構中的中文欄位名稱
                thresholds={t ? [{ y: t.value, label: `${t.label}（${m.kind}）= ${t.value}` }] : []}
              />
            </>
          )}
        </MainView>
      }
    />
  )
}

/**
 * 條碼掃描的結果檢視：讀數欄為兩種方法的整體成功率、誤讀率、首次失敗等級與提升幅度，
 * 以及品質門檻與逐步升級結果的四格對照；主檢視為成功率與誤讀率折線、各等級的成功階堆疊長條、
 * 品質門檻對照（成功率與品質不通過率疊在同一張圖），或逐樣本明細表。
 */
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
  // 逐步升級相對只用原圖的提升（百分點，可為負；顯示時自行加正負號）
  const gain = r.overall.ladder - r.overall.raw
  // 結果中出現過的成功階，依 RUNG_ORDER 排序（與 E1 頁相同；不在其中的新階接在最後）
  const rungs = orderRungs(r.rung_counts.map((c) => c.rung))
  // 某方法某指標（成功率或誤讀率）隨等級變化的點
  const points = (method: 'raw' | 'ladder', key: 'rate' | 'misread') =>
    r.rates.filter((x) => x.method === method).map((x) => ({ x: x.level, y: x[key] }))
  const total = r.rows.length
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
                help="所有等級與樣本中讀對的比例；首次失敗為成功率首次低於 100% 的等級。"
              />
              <Metric
                label="逐步升級"
                value={pct(r.overall.ladder)}
                delta={fail(r.first_failure.ladder)}
              />
              {(['raw', 'ladder'] as const).map((m) => (
                <Metric
                  key={m}
                  label={`誤讀・${METHOD_TEXT[m]}`}
                  value={pct(r.misread[m])}
                  good={r.misread[m] > 0 ? false : undefined}
                  help="解出檢查碼正確、但不是真值的號碼；比讀不出來更糟，因為使用者不會發現。"
                />
              ))}
              <Metric
                label="提升"
                value={`${gain >= 0 ? '+' : '−'}${pct(Math.abs(gain))}`}
                good={gain > 0 ? true : gain < 0 ? false : undefined}
                delta="逐步升級減只用原圖"
                wide
              />
            </MetricGrid>
          </ReadoutBlock>
          <ReadoutBlock title="品質門檻對照">
            <MetricGrid>
              <Metric
                label="該重拍"
                value={`${r.alarms.retake} / ${total}`}
                help="品質檢查不通過，且逐步升級讀不對：請使用者重拍是對的。"
              />
              <Metric
                label="正常"
                value={`${r.alarms.ok} / ${total}`}
                help="品質檢查通過，且逐步升級讀對。"
              />
              <Metric
                label="誤報"
                value={`${r.alarms.false_alarm} / ${total}`}
                good={r.alarms.false_alarm > 0 ? false : undefined}
                help="品質檢查不通過，但逐步升級其實讀對了：門檻太嚴，不必要地請使用者重拍。"
              />
              <Metric
                label="漏報"
                value={`${r.alarms.missed_alarm} / ${total}`}
                good={r.alarms.missed_alarm > 0 ? false : undefined}
                help="品質檢查通過，但逐步升級讀不對：門檻太鬆，該提醒卻沒提醒。"
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
                { value: 'quality', label: withIcon(Gauge, '品質門檻') },
                { value: 'table', label: withIcon(Table, '明細') },
              ]}
            />
          }
        >
          {view === 'table' ? (
            <DataTable
              label="每個等級與樣本的解碼結果"
              columns={[
                '等級',
                '樣本',
                '真值',
                '只用原圖',
                '逐步升級',
                '解出內容',
                '成功階',
                '品質',
              ]}
              rows={r.rows.map((row) => [
                Number(row.level.toPrecision(4)),
                row.sample + 1, // 樣本編號從 1 起顯示
                row.truth,
                OUTCOME_TEXT[row.raw],
                OUTCOME_TEXT[row.ladder],
                // 與真值相同時不重複列出 13 位數字，表格才放得下；不同（誤讀）時才顯示解出的號碼
                row.decoded === row.truth ? '同真值' : row.decoded || '—',
                row.success_rung ? rungText(row.success_rung) : '—',
                row.quality_passed ? '通過' : row.warnings.map(warningText).join('、'),
              ])}
            />
          ) : view === 'rung' ? (
            rungs.length === 0 ? (
              <EmptyState>逐步升級沒有任何讀對的樣本。</EmptyState>
            ) : (
              <StackedBars
                label="各等級中逐步升級讀對於哪一階的樣本數"
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
          ) : view === 'quality' ? (
            <div className="space-y-4">
              <p className="text-muted text-xs">
                門檻設得好時，品質不通過率應在逐步升級的成功率下滑處才開始上升：太早上升是誤報（白白請使用者重拍），
                太晚是漏報。請先調好前處理，再依此調整左側的品質門檻。
              </p>
              <LineChart
                label={`逐步升級成功率與品質不通過率隨${axisLabel}變化`}
                xLabel={axisLabel}
                yDomain={[0, 1]}
                yFormat={pct}
                series={[
                  { name: '逐步升級成功率', color: PALETTE[1]!, points: points('ladder', 'rate') },
                  {
                    name: '品質不通過率',
                    color: PALETTE[3]!,
                    dashed: true,
                    points: r.quality_rates.map((q) => ({ x: q.level, y: q.rate })),
                  },
                ]}
              />
              <ReadoutBlock title="各警告首次在半數樣本出現的等級">
                <MetricGrid>
                  {Object.entries(r.quality_triggers).map(([code, level]) => (
                    <Metric
                      key={code}
                      label={warningText(code)}
                      value={level === null ? '未觸發' : `≥ ${Number(level.toPrecision(3))}`}
                      help={`${axisLabel}達到此等級時，至少半數樣本出現「${warningText(code)}」。`}
                    />
                  ))}
                </MetricGrid>
              </ReadoutBlock>
            </div>
          ) : (
            <LineChart
              label={`兩種方法的成功率與誤讀率隨${axisLabel}變化`}
              xLabel={axisLabel}
              yDomain={[0, 1]}
              yFormat={pct}
              // 成功率：只用原圖（PALETTE[0]）與逐步升級（PALETTE[1]）；誤讀率接著取 PALETTE[2]、[3]。
              // 只用原圖一律為虛線
              series={(['rate', 'misread'] as const).flatMap((key, k) =>
                (['raw', 'ladder'] as const).map((method, i) => ({
                  name: key === 'rate' ? METHOD_TEXT[method] : `誤讀・${METHOD_TEXT[method]}`,
                  color: PALETTE[k * 2 + i]!,
                  dashed: method === 'raw',
                  points: points(method, key),
                })),
              )}
            />
          )}
        </MainView>
      }
    />
  )
}
