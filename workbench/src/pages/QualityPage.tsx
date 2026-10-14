// 模組一：品質檢查。疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。
import { BarChart3, Download, ImageIcon, ListOrdered, ScanLine, SunMoon } from 'lucide-react'
import { useState } from 'react'

import { api, artifactUrl, overrideBody, unwrap, type ConfigOverride } from '@/api/client'
import { ConfigIO } from '@/components/ConfigIO'
import { Histogram } from '@/components/Histogram'
import { ImageSourcePanel } from '@/components/ImageSourcePanel'
import { ImageViewer } from '@/components/ImageViewer'
import { EmptyState, PageHeader, Section, Workspace } from '@/components/layout/Workspace'
import { ParamForm } from '@/components/ParamForm'
import {
  AnalysisFrame,
  ErrorBox,
  Legend,
  Metric,
  MetricGrid,
  StatusCard,
  WarningBadges,
} from '@/components/results'
import { StepsTable } from '@/components/StepsTable'
import { ToolPanel } from '@/components/ToolPanel'
import { Badge, Card, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useConfigClass } from '@/hooks/useConfigSchemas'
import { useImagePipeline } from '@/hooks/useImagePipeline'
import { useRenderView } from '@/hooks/useRenderView'
import { valueOf } from '@/lib/config'

type ViewKind = 'original' | 'laplacian' | 'exposure' | 'histogram' | 'steps'

const VIEWS = [
  { value: 'original' as const, label: withIcon(ImageIcon, '原圖') },
  { value: 'laplacian' as const, label: withIcon(ScanLine, '邊緣響應') },
  { value: 'exposure' as const, label: withIcon(SunMoon, '曝光遮罩') },
  { value: 'histogram' as const, label: withIcon(BarChart3, '直方圖') },
  { value: 'steps' as const, label: withIcon(ListOrdered, '步驟') },
]

export function QualityPage() {
  const quality = useConfigClass('QualityConfig')
  const degradationSchema = useConfigClass('Degradation').schema
  const pipeline = useImagePipeline('label')
  const [config, setConfig] = useState<ConfigOverride>({})
  const [view, setView] = useState<ViewKind>('original')
  const image = pipeline.image

  const analysis = useAnalysis({
    name: 'quality',
    imageId: image?.image_id,
    config,
    run: (imageId, cfg, signal) =>
      unwrap(
        api.POST('/workbench/v1/dev/quality', {
          body: { image_id: imageId, config: overrideBody(cfg) },
          signal,
        }),
      ),
  })

  // 影像型檢視需要目前的參數（例如過暗灰階）；直方圖只看影像
  const imageView = view === 'laplacian' || view === 'exposure'
  const rendered = useRenderView(
    image?.image_id,
    imageView ? view : 'histogram',
    imageView ? config : null,
    imageView || view === 'histogram',
  )

  /** 參數目前的值（顯示門檻用） */
  /** 某組參數的目前值（顯示門檻與說明用）；結果區用算出該結果的那組參數 */
  const valuesOf = (cfg: ConfigOverride) => (name: string) => {
    const f = quality.schema?.fields.find((x) => x.name === name)
    return f ? (valueOf(f, cfg) as number) : NaN
  }

  const panel = (
    <ToolPanel
      changed={Object.keys(config).length}
      image={
        <ImageSourcePanel pipeline={pipeline} scene="label" degradationSchema={degradationSchema} />
      }
      params={
        quality.schema ? (
          <ParamForm
            schema={quality.schema}
            overrides={config}
            onChange={setConfig}
            invalidField={analysis.configError?.field}
            invalidMessage={analysis.configError?.message}
          />
        ) : quality.error ? (
          <ErrorBox error={quality.error} />
        ) : (
          <EmptyState>載入參數結構中…</EmptyState>
        )
      }
      io={
        quality.schema && (
          <ConfigIO schema={quality.schema} overrides={config} onImport={setConfig} />
        )
      }
    />
  )

  return (
    <Workspace panel={panel}>
      <PageHeader
        title="品質檢查"
        description="疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。"
        aside={
          (pipeline.pending || analysis.busy) && (
            <Badge tone="primary" aria-live="polite">
              計算中…
            </Badge>
          )
        }
      />
      <AnalysisFrame pipeline={pipeline} analysis={analysis} ready={!!quality.schema}>
        {({ data: result, roundTripMs, config: used }, img) => {
          const current = valuesOf(used as ConfigOverride)
          const short = Math.min(img.width, img.height)
          const pct = (v: number) => `${(v * 100).toFixed(1)}%`
          const signed = (v: number, f: (v: number) => string) =>
            (v >= 0 ? '+' : '−') + f(Math.abs(v))
          return (
            <>
              <StatusCard
                tone={result.passed ? 'ok' : 'bad'}
                title={result.passed ? '通過品質檢查' : '未通過'}
                badges={<WarningBadges codes={result.warnings} />}
                detail={[
                  img.description,
                  `${img.width}×${img.height} px`,
                  `平均亮度 ${result.mean_brightness.toFixed(0)}`,
                  `往返 ${roundTripMs.toFixed(0)} ms`,
                ]}
              />
              <MetricGrid>
                <Metric
                  label="模糊分數"
                  value={result.blur_score.toFixed(0)}
                  delta={`${signed(result.blur_score - current('blur_min'), (v) => v.toFixed(0))} 相對下限 ${current('blur_min')}`}
                  good={result.blur_score >= current('blur_min')}
                  help={`拉普拉斯變異數（縮放到短邊 ${current('blur_short_side')} px）；越低越模糊。`}
                />
                <Metric
                  label="短邊"
                  value={`${short} px`}
                  delta={`${signed(short - current('min_short_side'), String)} 相對下限 ${current('min_short_side')}`}
                  good={result.resolution_ok}
                />
                <Metric
                  label="過暗比例"
                  value={pct(result.dark_ratio)}
                  delta={`${signed(result.dark_ratio - current('dark_ratio_max'), pct)} 相對上限`}
                  good={result.dark_ratio <= current('dark_ratio_max')}
                  help={`灰階 < ${current('dark_level')} 的像素比例；上限 ${pct(current('dark_ratio_max'))}。`}
                />
                <Metric
                  label="過亮比例"
                  value={pct(result.bright_ratio)}
                  delta={`${signed(result.bright_ratio - current('bright_ratio_max'), pct)} 相對上限`}
                  good={result.bright_ratio <= current('bright_ratio_max')}
                  help={`灰階 > ${current('bright_level')} 的像素比例；上限 ${pct(current('bright_ratio_max'))}。`}
                />
              </MetricGrid>
              <Section title="檢視">
                <Segmented
                  label="檢視"
                  value={view}
                  onChange={setView}
                  options={VIEWS}
                  className="mb-3"
                />
                <Card className="p-3">
                  {view === 'steps' ? (
                    <StepsTable steps={result.steps} />
                  ) : view === 'original' ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(img.image_id)}
                        width={img.width}
                        height={img.height}
                        alt="輸入影像"
                      />
                      <a
                        href={artifactUrl(img.image_id)}
                        download="workbench_input.jpg"
                        className="text-primary mt-2 inline-flex items-center gap-1 text-xs hover:underline"
                      >
                        <Download className="size-3.5" aria-hidden />
                        下載影像（JPEG）
                      </a>
                    </>
                  ) : rendered.error ? (
                    <ErrorBox error={rendered.error} />
                  ) : !rendered.data ? (
                    <EmptyState>載入中…</EmptyState>
                  ) : view === 'histogram' ? (
                    <Histogram
                      counts={(rendered.data.data?.counts as number[] | undefined) ?? []}
                      thresholds={[
                        {
                          value: current('dark_level'),
                          label: '過暗灰階',
                          color: 'var(--primary)',
                        },
                        {
                          value: current('bright_level'),
                          label: '過亮灰階',
                          color: 'var(--danger)',
                        },
                      ]}
                    />
                  ) : rendered.data.image ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(rendered.data.image.image_id)}
                        width={rendered.data.image.width}
                        height={rendered.data.image.height}
                        alt={view === 'laplacian' ? '拉普拉斯響應熱度圖' : '過暗與過亮像素遮罩'}
                      />
                      {view === 'laplacian' ? (
                        <p className="text-muted mt-2 text-xs">
                          縮放到短邊 {current('blur_short_side')} px
                          後的拉普拉斯響應強度，越亮代表邊緣越銳利；模糊分數就是這張圖的變異數。
                        </p>
                      ) : (
                        <Legend
                          items={[
                            {
                              color: 'rgb(0 80 255)',
                              label: `過暗（灰階 < ${current('dark_level')}）`,
                            },
                            {
                              color: 'rgb(255 0 0)',
                              label: `過亮（灰階 > ${current('bright_level')}）`,
                            },
                          ]}
                        />
                      )}
                    </>
                  ) : (
                    <EmptyState>沒有影像</EmptyState>
                  )}
                </Card>
              </Section>
            </>
          )
        }}
      </AnalysisFrame>
    </Workspace>
  )
}
