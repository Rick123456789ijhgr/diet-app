// 模組一：品質檢查。疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  CircleAlert,
  CircleCheck,
  Download,
  ImageIcon,
  ListOrdered,
  ScanLine,
  SlidersHorizontal,
  SunMoon,
  ArrowLeftRight,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import {
  api,
  ApiError,
  artifactUrl,
  overrideBody,
  unwrap,
  type ConfigOverride,
  type ImageRef,
  type QualityResult,
} from '@/api/client'
import { ConfigIO } from '@/components/ConfigIO'
import { Histogram } from '@/components/Histogram'
import { ImageSourcePanel } from '@/components/ImageSourcePanel'
import { ImageViewer } from '@/components/ImageViewer'
import { EmptyState, PageHeader, Section, Workspace } from '@/components/layout/Workspace'
import { ParamForm } from '@/components/ParamForm'
import { StepsTable } from '@/components/StepsTable'
import {
  Badge,
  Card,
  Segmented,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives'
import { useConfigClass } from '@/hooks/useConfigSchemas'
import { useDebounced } from '@/hooks/useDebounced'
import { useImagePipeline } from '@/hooks/useImagePipeline'
import { useLastDefined } from '@/hooks/useLastDefined'
import { cn } from '@/lib/cn'
import { valueOf } from '@/lib/config'
import { errorText, warningText } from '@/lib/text'

type ViewKind = 'original' | 'laplacian' | 'exposure' | 'histogram' | 'steps'

const VIEWS: { value: ViewKind; label: ReactNode }[] = [
  { value: 'original', label: withIcon(ImageIcon, '原圖') },
  { value: 'laplacian', label: withIcon(ScanLine, '邊緣響應') },
  { value: 'exposure', label: withIcon(SunMoon, '曝光遮罩') },
  { value: 'histogram', label: withIcon(BarChart3, '直方圖') },
  { value: 'steps', label: withIcon(ListOrdered, '步驟') },
]

function withIcon(Icon: typeof ImageIcon, text: string) {
  return (
    <>
      <Icon className="size-4" aria-hidden />
      {text}
    </>
  )
}

interface Timed<T> {
  data: T
  roundTripMs: number
}

async function timed<T>(p: Promise<T>): Promise<Timed<T>> {
  const start = performance.now()
  const data = await p
  return { data, roundTripMs: performance.now() - start }
}

export function QualityPage() {
  const quality = useConfigClass('QualityConfig')
  const degradationSchema = useConfigClass('Degradation').schema
  const pipeline = useImagePipeline()
  const [config, setConfig] = useState<ConfigOverride>({})
  const [view, setView] = useState<ViewKind>('original')
  const debouncedConfig = useDebounced(config)
  const image = pipeline.image
  const noFile = pipeline.source.kind === 'upload' && pipeline.source.file.size === 0

  const result = useQuery({
    queryKey: ['quality', image?.image_id, debouncedConfig],
    queryFn: ({ signal }) =>
      timed(
        unwrap(
          api.POST('/workbench/v1/dev/quality', {
            body: { image_id: image!.image_id, config: overrideBody(debouncedConfig) },
            signal,
          }),
        ),
      ),
    enabled: !!image && !noFile,
    placeholderData: keepPreviousData,
  })

  // 影像型檢視需要目前的參數（例如過暗灰階）；直方圖只看影像
  const needsView = view === 'laplacian' || view === 'exposure' || view === 'histogram'
  const viewConfig = view === 'histogram' ? null : debouncedConfig
  const rendered = useQuery({
    queryKey: ['view', image?.image_id, view, viewConfig],
    queryFn: ({ signal }) =>
      unwrap(
        api.POST('/workbench/v1/dev/views', {
          body: {
            image_id: image!.image_id,
            view: view as 'laplacian' | 'exposure' | 'histogram',
            config: viewConfig ? overrideBody(viewConfig) : undefined,
          },
          signal,
        }),
      ),
    enabled: !!image && needsView && !noFile,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === view ? prev : undefined), // 換檢視時不沿用別種檢視的結果
  })

  const configError = asConfigError(result.error)
  // 參數不合法等錯誤時，保留上一次成功的結果並淡化
  const shown = useLastDefined(result.data)
  const busy = pipeline.pending || config !== debouncedConfig || result.isFetching
  const stale = busy || !!result.error

  const panel = (
    <Tabs defaultValue="image">
      <TabsList className="mb-4">
        <TabsTrigger value="image">
          <ImageIcon className="size-4" aria-hidden />
          影像
        </TabsTrigger>
        <TabsTrigger value="params">
          <SlidersHorizontal className="size-4" aria-hidden />
          參數
          {Object.keys(config).length > 0 && (
            <Badge tone="accent">{Object.keys(config).length}</Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="io">
          <ArrowLeftRight className="size-4" aria-hidden />
          匯出入
        </TabsTrigger>
      </TabsList>
      <TabsContent value="image">
        <ImageSourcePanel
          source={pipeline.source}
          onSourceChange={pipeline.setSource}
          degradationSchema={degradationSchema}
          degradation={pipeline.degradation}
          onDegradationChange={pipeline.setDegradation}
          degradationError={pipeline.degraded.error}
        />
      </TabsContent>
      <TabsContent value="params">
        {quality.schema ? (
          <ParamForm
            schema={quality.schema}
            overrides={config}
            onChange={setConfig}
            invalidField={configError?.field}
            invalidMessage={configError?.message}
          />
        ) : (
          <SchemaState error={quality.error} />
        )}
      </TabsContent>
      <TabsContent value="io">
        {quality.schema && (
          <ConfigIO schema={quality.schema} overrides={config} onImport={setConfig} />
        )}
      </TabsContent>
    </Tabs>
  )

  const fatal = firstError(quality.error, pipeline.base.error, pipeline.degraded.error)
  /** 參數目前的值（顯示門檻用）；只在參數結構載入後呼叫 */
  const current = (name: string) => {
    const f = quality.schema?.fields.find((x) => x.name === name)
    if (!f) throw new Error(`QualityConfig 沒有欄位 ${name}`)
    return valueOf(f, config) as number
  }

  return (
    <Workspace panel={panel}>
      <PageHeader
        title="品質檢查"
        description="疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。"
        aside={
          busy ? (
            <Badge tone="primary" aria-live="polite">
              計算中…
            </Badge>
          ) : undefined
        }
      />
      {noFile ? (
        <EmptyState icon={<ImageIcon className="size-8" aria-hidden />}>
          在左側「影像」選擇要上傳的照片。
        </EmptyState>
      ) : fatal && !image ? (
        <ErrorBox error={fatal} />
      ) : !image || !shown || !quality.schema ? (
        result.error ? (
          <ErrorBox error={result.error} />
        ) : (
          <EmptyState>載入中…</EmptyState>
        )
      ) : (
        <>
          {(fatal || (result.error && !configError)) && (
            <ErrorBox error={fatal ?? result.error} className="mb-4" />
          )}
          {configError && (
            <ErrorBox
              error={configError}
              className="mb-4"
              hint="請在左側「參數」修正標紅的欄位。"
            />
          )}
          <div className={cn('transition-opacity', stale && 'opacity-60')}>
            <StatusLine image={image} result={shown.data} roundTripMs={shown.roundTripMs} />
            <Metrics
              result={shown.data}
              image={image}
              blurMin={current('blur_min')}
              blurShortSide={current('blur_short_side')}
              minShortSide={current('min_short_side')}
              darkLevel={current('dark_level')}
              darkMax={current('dark_ratio_max')}
              brightLevel={current('bright_level')}
              brightMax={current('bright_ratio_max')}
            />
            <Section title="檢視">
              <Segmented
                label="檢視"
                value={view}
                onChange={setView}
                options={VIEWS}
                className="mb-3"
              />
              <Card className="p-3">
                <ViewBody
                  view={view}
                  image={image}
                  result={shown.data}
                  rendered={rendered.data}
                  renderError={rendered.error}
                  darkLevel={current('dark_level')}
                  brightLevel={current('bright_level')}
                  blurShortSide={current('blur_short_side')}
                />
              </Card>
            </Section>
          </div>
        </>
      )}
    </Workspace>
  )
}

function asConfigError(err: unknown): ApiError | undefined {
  return err instanceof ApiError && err.code === 'INVALID_CONFIG' ? err : undefined
}

function firstError(...errs: unknown[]): unknown {
  return errs.find((e) => e && !(e instanceof ApiError && e.code === 'INVALID_CONFIG'))
}

function StatusLine({
  image,
  result,
  roundTripMs,
}: {
  image: ImageRef
  result: QualityResult
  roundTripMs: number
}) {
  return (
    <Card
      className={cn(
        'mb-4 flex flex-wrap items-center gap-3 px-4 py-3',
        result.passed ? 'border-primary/40' : 'border-danger/40',
      )}
    >
      {result.passed ? (
        <CircleCheck className="text-primary size-5" aria-hidden />
      ) : (
        <CircleAlert className="text-danger size-5" aria-hidden />
      )}
      <span
        className={cn('font-semibold', result.passed ? 'text-primary' : 'text-danger')}
        role="status"
      >
        {result.passed ? '通過品質檢查' : '未通過'}
      </span>
      {result.warnings.map((w) => (
        <Badge key={w} tone="danger">
          {warningText(w)}
        </Badge>
      ))}
      <span className="text-muted tabular ml-auto text-xs">
        {[
          image.description,
          `${image.width}×${image.height} px`,
          `平均亮度 ${result.mean_brightness.toFixed(0)}`,
          `往返 ${roundTripMs.toFixed(0)} ms`,
        ].join(' · ')}
      </span>
    </Card>
  )
}

function Metrics(props: {
  result: QualityResult
  image: ImageRef
  blurMin: number
  blurShortSide: number
  minShortSide: number
  darkLevel: number
  darkMax: number
  brightLevel: number
  brightMax: number
}) {
  const { result, image } = props
  const short = Math.min(image.width, image.height)
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const signed = (v: number, f: (v: number) => string) => (v >= 0 ? '+' : '−') + f(Math.abs(v))
  return (
    <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
      <Metric
        label="模糊分數"
        value={result.blur_score.toFixed(0)}
        delta={`${signed(result.blur_score - props.blurMin, (v) => v.toFixed(0))} 相對下限 ${props.blurMin}`}
        good={result.blur_score >= props.blurMin}
        help={`拉普拉斯變異數（縮放到短邊 ${props.blurShortSide} px）；越低越模糊。`}
      />
      <Metric
        label="短邊"
        value={`${short} px`}
        delta={`${signed(short - props.minShortSide, String)} 相對下限 ${props.minShortSide}`}
        good={result.resolution_ok}
      />
      <Metric
        label="過暗比例"
        value={pct(result.dark_ratio)}
        delta={`${signed(result.dark_ratio - props.darkMax, pct)} 相對上限`}
        good={result.dark_ratio <= props.darkMax}
        help={`灰階 < ${props.darkLevel} 的像素比例；上限 ${pct(props.darkMax)}。`}
      />
      <Metric
        label="過亮比例"
        value={pct(result.bright_ratio)}
        delta={`${signed(result.bright_ratio - props.brightMax, pct)} 相對上限`}
        good={result.bright_ratio <= props.brightMax}
        help={`灰階 > ${props.brightLevel} 的像素比例；上限 ${pct(props.brightMax)}。`}
      />
    </div>
  )
}

function Metric({
  label,
  value,
  delta,
  good,
  help,
}: {
  label: string
  value: string
  delta: string
  good: boolean
  help?: string
}) {
  return (
    <Card className="px-4 py-3" title={help}>
      <div className="text-muted text-xs">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      <div className={cn('tabular mt-1 text-xs', good ? 'text-primary' : 'text-danger')}>
        {delta}
      </div>
    </Card>
  )
}

function ViewBody({
  view,
  image,
  result,
  rendered,
  renderError,
  darkLevel,
  brightLevel,
  blurShortSide,
}: {
  view: ViewKind
  image: ImageRef
  result: QualityResult
  rendered?: { image?: ImageRef; data?: Record<string, unknown> }
  renderError: unknown
  darkLevel: number
  brightLevel: number
  blurShortSide: number
}) {
  if (view === 'steps') return <StepsTable steps={result.steps} />
  if (view === 'original') {
    return (
      <>
        <ImageViewer
          src={artifactUrl(image.image_id)}
          width={image.width}
          height={image.height}
          alt="輸入影像"
        />
        <a
          href={artifactUrl(image.image_id)}
          download="workbench_input.jpg"
          className="text-primary mt-2 inline-flex items-center gap-1 text-xs hover:underline"
        >
          <Download className="size-3.5" aria-hidden />
          下載影像（JPEG）
        </a>
      </>
    )
  }
  if (renderError) return <ErrorBox error={renderError} />
  if (!rendered) return <EmptyState>載入中…</EmptyState>
  if (view === 'histogram') {
    const counts = (rendered.data?.counts as number[] | undefined) ?? []
    return (
      <Histogram
        counts={counts}
        thresholds={[
          { value: darkLevel, label: '過暗灰階', color: 'var(--primary)' },
          { value: brightLevel, label: '過亮灰階', color: 'var(--danger)' },
        ]}
      />
    )
  }
  const img = rendered.image
  if (!img) return <EmptyState>沒有影像</EmptyState>
  return (
    <>
      <ImageViewer
        src={artifactUrl(img.image_id)}
        width={img.width}
        height={img.height}
        alt={view === 'laplacian' ? '拉普拉斯響應熱度圖' : '過暗與過亮像素遮罩'}
      />
      <p className="text-muted mt-2 text-xs">
        {view === 'laplacian' ? (
          `縮放到短邊 ${blurShortSide} px 後的拉普拉斯響應強度，越亮代表邊緣越銳利；模糊分數就是這張圖的變異數。`
        ) : (
          <>
            <span style={{ color: 'rgb(0 80 255)' }}>■</span> 過暗（灰階 &lt; {darkLevel}）
            <span className="ml-4" style={{ color: 'rgb(255 0 0)' }}>
              ■
            </span>{' '}
            過亮（灰階 &gt; {brightLevel}）
          </>
        )}
      </p>
    </>
  )
}

function SchemaState({ error }: { error: unknown }) {
  return error ? <ErrorBox error={error} /> : <EmptyState>載入參數結構中…</EmptyState>
}

function ErrorBox({
  error,
  hint,
  className,
}: {
  error: unknown
  hint?: string
  className?: string
}) {
  const e = error instanceof ApiError ? error : undefined
  return (
    <div
      role="alert"
      className={cn(
        'border-danger/40 bg-danger-soft rounded-lg border px-4 py-3 text-sm',
        className,
      )}
    >
      <div className="text-danger font-semibold">
        {e ? errorText(e.code) : '發生錯誤'}
        {e?.field && `（${e.field}）`}
      </div>
      <div className="text-muted mt-0.5 text-xs break-all">
        {e?.message ?? String(error)}
        {hint && <span className="ml-1">{hint}</span>}
      </div>
    </div>
  )
}
