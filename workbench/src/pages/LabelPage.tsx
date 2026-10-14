// 模組一：營養標示。定位表格框並透視校正，再處理反光與增強對比。
import { Crop, Download, FileOutput, Flashlight, ListOrdered, ScanLine } from 'lucide-react'
import { useState } from 'react'

import {
  api,
  artifactUrl,
  overrideBody,
  unwrap,
  type ConfigOverride,
  type Point,
} from '@/api/client'
import { ConfigIO } from '@/components/ConfigIO'
import { ImageSourcePanel } from '@/components/ImageSourcePanel'
import { ImageViewer } from '@/components/ImageViewer'
import { EmptyState, PageHeader, Section, Workspace } from '@/components/layout/Workspace'
import { FOUND, Quad, TRUTH } from '@/components/overlays'
import { ParamForm } from '@/components/ParamForm'
import {
  AnalysisFrame,
  DataTable,
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
import { CORNER_NAMES, mean, quadErrors } from '@/lib/geometry'
import { QUAD_METHOD_TEXT } from '@/lib/text'

type ViewKind = 'located' | 'edges' | 'glare' | 'output' | 'steps'

const VIEWS = [
  { value: 'located' as const, label: withIcon(Crop, '定位') },
  { value: 'edges' as const, label: withIcon(ScanLine, '邊緣') },
  { value: 'glare' as const, label: withIcon(Flashlight, '光斑遮罩') },
  { value: 'output' as const, label: withIcon(FileOutput, '輸出') },
  { value: 'steps' as const, label: withIcon(ListOrdered, '步驟') },
]

export function LabelPage() {
  const label = useConfigClass('LabelConfig')
  const degradationSchema = useConfigClass('Degradation').schema
  const pipeline = useImagePipeline('nutrition')
  const [config, setConfig] = useState<ConfigOverride>({})
  const [view, setView] = useState<ViewKind>('located')
  const image = pipeline.image

  const analysis = useAnalysis({
    name: 'label',
    imageId: image?.image_id,
    config,
    run: (imageId, cfg, signal) =>
      unwrap(
        api.POST('/workbench/v1/dev/label', {
          body: { image_id: imageId, config: overrideBody(cfg) },
          signal,
        }),
      ),
  })
  const rendered = useRenderView(
    image?.image_id,
    view === 'glare' ? 'glare_mask' : 'label_edges',
    config,
    view === 'edges' || view === 'glare',
  )

  /** 某組參數的目前值（顯示門檻與說明用）；結果區用算出該結果的那組參數 */
  const valuesOf = (cfg: ConfigOverride) => (name: string) => {
    const f = label.schema?.fields.find((x) => x.name === name)
    return f ? valueOf(f, cfg) : undefined
  }

  const panel = (
    <ToolPanel
      changed={Object.keys(config).length}
      image={
        <ImageSourcePanel
          pipeline={pipeline}
          scene="nutrition"
          degradationSchema={degradationSchema}
        />
      }
      params={
        label.schema ? (
          <ParamForm
            schema={label.schema}
            overrides={config}
            onChange={setConfig}
            invalidField={analysis.configError?.field}
            invalidMessage={analysis.configError?.message}
          />
        ) : (
          <EmptyState>載入參數結構中…</EmptyState>
        )
      }
      io={
        label.schema && <ConfigIO schema={label.schema} overrides={config} onImport={setConfig} />
      }
    />
  )

  return (
    <Workspace panel={panel}>
      <PageHeader
        title="營養標示"
        description="定位表格框並透視校正，再處理反光與增強對比；各段可在「參數」個別關閉。"
        aside={
          (pipeline.pending || analysis.busy) && (
            <Badge tone="primary" aria-live="polite">
              計算中…
            </Badge>
          )
        }
      />
      <AnalysisFrame pipeline={pipeline} analysis={analysis} ready={!!label.schema}>
        {({ data: r, roundTripMs, config: used }, img) => {
          const current = valuesOf(used as ConfigOverride)
          const truth = img.truth?.quad as Point[] | undefined
          const errors = quadErrors(r.quad, truth)
          const glareMax = current('glare_max_ratio') as number
          const pct = (v: number) => `${(v * 100).toFixed(2)}%`
          return (
            <>
              <StatusCard
                tone={r.warnings.length ? 'warn' : 'ok'}
                title={r.warnings.length ? '有警告' : '處理完成'}
                badges={<WarningBadges codes={r.warnings} tone="accent" />}
                detail={[
                  img.description,
                  `輸入 ${img.width}×${img.height} px → 輸出 ${r.image.width}×${r.image.height} px`,
                  `往返 ${roundTripMs.toFixed(0)} ms`,
                ]}
              />
              <MetricGrid>
                <Metric
                  label="定位方法"
                  value={
                    current('enable_rectify') === false
                      ? '未啟用'
                      : r.quad_method
                        ? (QUAD_METHOD_TEXT[r.quad_method] ?? r.quad_method)
                        : '找不到'
                  }
                  help="先找最大的凸四邊形輪廓；失敗時改用 HoughLinesP 求外側四條直線的交點。"
                />
                <Metric
                  label="四角平均誤差"
                  value={errors ? `${mean(errors).toFixed(1)} px` : '—'}
                  delta={
                    errors
                      ? mean(errors) < 10
                        ? '符合驗收（< 10 px）'
                        : '超過驗收（10 px）'
                      : undefined
                  }
                  good={errors ? mean(errors) < 10 : undefined}
                  help="與合成影像真實四角的平均距離（原圖像素）；上傳照片或旋轉、縮小後沒有真值。"
                />
                <Metric
                  label="光斑比例"
                  value={r.glare_ratio < 0 ? '未啟用' : pct(r.glare_ratio)}
                  delta={
                    r.glare_ratio < 0
                      ? undefined
                      : `${r.glare_ratio - glareMax >= 0 ? '+' : '−'}${pct(Math.abs(r.glare_ratio - glareMax))} 相對上限`
                  }
                  good={r.glare_ratio < 0 ? undefined : r.glare_ratio <= glareMax}
                  help={`校正後影像中被判為光斑的面積比例；超過 ${pct(glareMax)} 時不修補、改為警告重拍。`}
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
                  {view === 'located' ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(img.image_id)}
                        width={img.width}
                        height={img.height}
                        alt="找到的表格四角"
                        overlay={(px) => (
                          <>
                            {truth && <Quad points={truth} color={TRUTH} px={px} dashed />}
                            <Quad
                              points={r.quad}
                              color={FOUND}
                              px={px}
                              label={r.quad_method ? QUAD_METHOD_TEXT[r.quad_method] : undefined}
                            />
                          </>
                        )}
                      />
                      <Legend
                        items={[
                          { color: FOUND, label: '找到的四角（實心圓為左上角）' },
                          { color: TRUTH, label: '真實四角（合成影像，虛線）' },
                        ]}
                      />
                      {errors && (
                        <DataTable
                          label="四角各自的誤差"
                          columns={['角', '誤差（px）']}
                          rows={errors.map((e, i) => [CORNER_NAMES[i], e.toFixed(2)])}
                        />
                      )}
                    </>
                  ) : view === 'output' ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(r.image.artifact_id)}
                        width={r.image.width}
                        height={r.image.height}
                        alt="前處理後的營養標示"
                      />
                      <a
                        href={artifactUrl(r.image.artifact_id)}
                        download="workbench_label.png"
                        className="text-primary mt-2 inline-flex items-center gap-1 text-xs hover:underline"
                      >
                        <Download className="size-3.5" aria-hidden />
                        下載 PNG
                      </a>
                    </>
                  ) : view === 'steps' ? (
                    <StepsTable steps={r.steps} />
                  ) : rendered.error ? (
                    <ErrorBox error={rendered.error} />
                  ) : !rendered.data ? (
                    <EmptyState>載入中…</EmptyState>
                  ) : view === 'glare' && rendered.data.data?.enabled === false ? (
                    <p className="text-muted text-sm">光斑步驟未啟用（參數「步驟開關」）。</p>
                  ) : rendered.data.image ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(rendered.data.image.image_id)}
                        width={rendered.data.image.width}
                        height={rendered.data.image.height}
                        alt={view === 'edges' ? '定位用的 Canny 邊緣圖' : '光斑遮罩'}
                      />
                      <p className="text-muted mt-2 text-xs">
                        {view === 'edges'
                          ? `縮小到短邊 ${current('detect_short_side')} px 後的 Canny 邊緣（門檻 ${current('canny_low')}／${current('canny_high')}，已膨脹 3×3）；輪廓與直線都在這張圖上找。`
                          : `紅色為光斑：亮度 ≥ ${current('glare_v_min')} 且飽和度 ≤ ${current('glare_s_max')}，再擴張 ${current('glare_dilate_px')} px；疊在校正後、修補前的影像上。`}
                      </p>
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
