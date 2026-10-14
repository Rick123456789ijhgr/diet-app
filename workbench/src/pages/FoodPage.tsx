// 模組一：食物照片。切出各道菜、偵測盤緣，並把整張與各裁切縮放壓縮成送給 VLM 的大小。
import { useQueries } from '@tanstack/react-query'
import { Circle, Crop, LayoutGrid, ListOrdered, Minimize2, Shapes } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  api,
  artifactUrl,
  overrideBody,
  unwrap,
  type Box,
  type ConfigOverride,
  type Ellipse,
  type FoodResult,
} from '@/api/client'
import { ConfigIO } from '@/components/ConfigIO'
import { ImageSourcePanel } from '@/components/ImageSourcePanel'
import { ImageViewer } from '@/components/ImageViewer'
import { EmptyState, PageHeader, Section, Workspace } from '@/components/layout/Workspace'
import { EllipseShape, FOUND, Rect, TRUTH } from '@/components/overlays'
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
import { useDebounced } from '@/hooks/useDebounced'
import { useImagePipeline } from '@/hooks/useImagePipeline'
import { useRenderView } from '@/hooks/useRenderView'
import { valueOf } from '@/lib/config'

type ViewKind = 'boxes' | 'mask' | 'plates' | 'crops' | 'vlm' | 'steps'

const VIEWS = [
  { value: 'boxes' as const, label: withIcon(Crop, '裁切框') },
  { value: 'mask' as const, label: withIcon(Shapes, '前景遮罩') },
  { value: 'plates' as const, label: withIcon(Circle, '盤緣') },
  { value: 'crops' as const, label: withIcon(LayoutGrid, '各道菜') },
  { value: 'vlm' as const, label: withIcon(Minimize2, 'VLM 輸入') },
  { value: 'steps' as const, label: withIcon(ListOrdered, '步驟') },
]

/** E2 事前試算的候選長邊（只供觀察，最終由 E2 實驗決定） */
const VLM_SIDES = [384, 512, 768, 1024, 1536, 2048]

function runFood(imageId: string, cfg: ConfigOverride, signal: AbortSignal): Promise<FoodResult> {
  return unwrap(
    api.POST('/workbench/v1/dev/food', {
      body: { image_id: imageId, config: overrideBody(cfg) },
      signal,
    }),
  )
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`

export function FoodPage() {
  const food = useConfigClass('FoodConfig')
  const degradationSchema = useConfigClass('Degradation').schema
  const pipeline = useImagePipeline('food')
  const [config, setConfig] = useState<ConfigOverride>({})
  const [view, setView] = useState<ViewKind>('boxes')
  const image = pipeline.image
  const debounced = useDebounced(config)

  const analysis = useAnalysis({ name: 'food', imageId: image?.image_id, config, run: runFood })
  const plateConfig = useMemo(() => ({ ...config, enable_plate: true }), [config])
  const platesOff = analysis.shown?.data.plates_enabled === false
  // 盤緣步驟關閉時，在「盤緣」檢視仍試算一次（不影響輸出），方便調參
  const plateTrial = useAnalysis({
    name: 'food-plate-trial',
    imageId: image?.image_id,
    config: plateConfig,
    run: runFood,
    enabled: view === 'plates' && platesOff,
  })
  const mask = useRenderView(image?.image_id, 'food_mask', config, view === 'mask')
  const quality = food.schema
    ? (valueOf(
        food.schema.fields.find((f) => f.name === 'vlm_jpeg_quality')!,
        debounced,
      ) as number)
    : 85
  const sizes = useQueries({
    queries: VLM_SIDES.map((side) => ({
      queryKey: ['food-vlm-size', image?.image_id, side, quality],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        runFood(
          image!.image_id,
          {
            enable_crop: false,
            enable_plate: false,
            vlm_max_side: side,
            vlm_jpeg_quality: quality,
          },
          signal,
        ),
      enabled: !!image && view === 'vlm',
    })),
  })

  /** 某組參數的目前值（顯示門檻與說明用）；結果區用算出該結果的那組參數 */
  const valuesOf = (cfg: ConfigOverride) => (name: string) => {
    const f = food.schema?.fields.find((x) => x.name === name)
    return f ? valueOf(f, cfg) : undefined
  }

  const panel = (
    <ToolPanel
      changed={Object.keys(config).length}
      image={
        <ImageSourcePanel pipeline={pipeline} scene="food" degradationSchema={degradationSchema} />
      }
      params={
        food.schema ? (
          <ParamForm
            schema={food.schema}
            overrides={config}
            onChange={setConfig}
            invalidField={analysis.configError?.field}
            invalidMessage={analysis.configError?.message}
          />
        ) : (
          <EmptyState>載入參數結構中…</EmptyState>
        )
      }
      io={food.schema && <ConfigIO schema={food.schema} overrides={config} onImport={setConfig} />}
    />
  )

  return (
    <Workspace panel={panel}>
      <PageHeader
        title="食物照片"
        description="切出各道菜、偵測盤緣，並把整張與各裁切縮放壓縮成送給 VLM 的大小。"
        aside={
          (pipeline.pending || analysis.busy) && (
            <Badge tone="primary" aria-live="polite">
              計算中…
            </Badge>
          )
        }
      />
      <AnalysisFrame pipeline={pipeline} analysis={analysis} ready={!!food.schema}>
        {({ data: r, roundTripMs, config: used }, img) => {
          const current = valuesOf(used as ConfigOverride)
          const truthPlates = img.truth?.plates as Ellipse[] | undefined
          const truthBoxes = img.truth?.plate_boxes as Box[] | undefined
          const total = r.whole.num_bytes + r.crops.reduce((a, c) => a + c.num_bytes, 0)
          const plates = r.plates_enabled ? r.plates : (plateTrial.shown?.data.plates ?? [])
          return (
            <>
              <StatusCard
                tone={r.warnings.length ? 'warn' : 'ok'}
                title={r.warnings.length ? '有警告' : '處理完成'}
                badges={<WarningBadges codes={r.warnings} tone="accent" />}
                detail={[
                  img.description,
                  `輸入 ${img.width}×${img.height} px → VLM ${r.whole.image.width}×${r.whole.image.height} px`,
                  `往返 ${roundTripMs.toFixed(0)} ms`,
                ]}
              />
              <MetricGrid>
                <Metric
                  label="菜數"
                  value={r.dishes_enabled ? String(r.dishes.length) : '未啟用'}
                  delta={
                    r.dishes_enabled && truthPlates
                      ? `${r.dishes.length - truthPlates.length >= 0 ? '+' : '−'}${Math.abs(r.dishes.length - truthPlates.length)} 相對真值`
                      : undefined
                  }
                  help="切出的框數；合成影像會與真實盤數比較。相鄰或接觸的盤子會併成一個框。"
                />
                <Metric
                  label="盤緣"
                  value={r.plates_enabled ? String(r.plates.length) : '未啟用'}
                  help="在左側「參數 → 步驟開關」開啟盤緣橢圓（選做）。"
                />
                <Metric
                  label="VLM 大小"
                  value={kb(total)}
                  help={`整張與 ${r.crops.length} 張裁切的 JPEG 總大小（長邊 ≤ ${current('vlm_max_side')} px、品質 ${current('vlm_jpeg_quality')}）。`}
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
                  {view === 'boxes' ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(img.image_id)}
                        width={img.width}
                        height={img.height}
                        alt="切出的各道菜"
                        overlay={(px) => (
                          <>
                            {truthBoxes?.map((b, i) => (
                              <Rect key={`t${i}`} box={b} color={TRUTH} px={px} dashed />
                            ))}
                            {r.dishes.map((b, i) => (
                              <Rect key={i} box={b} color={FOUND} label={`#${i + 1}`} px={px} />
                            ))}
                          </>
                        )}
                      />
                      <Legend
                        items={[
                          { color: FOUND, label: '切出的框（已外擴）' },
                          { color: TRUTH, label: '真實盤子的外接框（合成影像，虛線）' },
                        ]}
                      />
                    </>
                  ) : view === 'mask' ? (
                    mask.error ? (
                      <ErrorBox error={mask.error} />
                    ) : !mask.data?.image ? (
                      <EmptyState>載入中…</EmptyState>
                    ) : (
                      <>
                        <ImageViewer
                          src={artifactUrl(mask.data.image.image_id)}
                          width={mask.data.image.width}
                          height={mask.data.image.height}
                          alt="切菜用的前景遮罩"
                        />
                        <p className="text-muted mt-2 text-xs">
                          紅色為前景：與背景色（四周{' '}
                          {((current('bg_border_ratio') as number) * 100).toFixed(1)}%
                          邊框的中位數）ΔE &gt; {current('bg_distance')}，形態學半徑{' '}
                          {current('morph_px')} px，已縮小到短邊 {current('detect_short_side')} px。
                        </p>
                      </>
                    )
                  ) : view === 'plates' ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(img.image_id)}
                        width={img.width}
                        height={img.height}
                        alt="盤緣橢圓"
                        overlay={(px) => (
                          <>
                            {truthPlates?.map((e, i) => (
                              <EllipseShape key={`t${i}`} e={e} color={TRUTH} px={px} dashed />
                            ))}
                            {plates.map((e, i) => (
                              <EllipseShape key={i} e={e} color={FOUND} px={px} />
                            ))}
                          </>
                        )}
                      />
                      <Legend
                        items={[
                          {
                            color: FOUND,
                            label: `找到 ${plates.length} 個${r.plates_enabled ? '' : '（步驟未啟用，此處僅試算）'}`,
                          },
                          { color: TRUTH, label: '真實盤緣（合成影像，虛線）' },
                        ]}
                      />
                      {plates.length > 0 && (
                        <DataTable
                          label="找到的盤緣橢圓"
                          columns={['中心', '長軸（px）', '短軸（px）', '短長比', '角度（°）']}
                          rows={plates.map((e) => [
                            `(${e.cx.toFixed(0)}, ${e.cy.toFixed(0)})`,
                            e.major.toFixed(1),
                            e.minor.toFixed(1),
                            (e.minor / e.major).toFixed(2),
                            e.angle.toFixed(1),
                          ])}
                        />
                      )}
                    </>
                  ) : view === 'crops' ? (
                    r.crops.length === 0 ? (
                      <p className="text-muted text-sm">
                        沒有裁切：切菜未啟用或切不出任何框。VLM 只會收到整張影像。
                      </p>
                    ) : (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                        {r.crops.map((c, i) => {
                          const b = r.dishes[i]
                          return (
                            <figure key={c.image.artifact_id}>
                              <img
                                src={artifactUrl(c.image.artifact_id)}
                                alt={`第 ${i + 1} 道菜`}
                                className="bg-hover w-full rounded-md object-contain"
                              />
                              <figcaption className="text-muted tabular mt-1 text-xs">
                                #{i + 1}
                                {b && ` (${b.x}, ${b.y}) ${b.w}×${b.h}`} · {kb(c.num_bytes)}
                              </figcaption>
                            </figure>
                          )
                        })}
                      </div>
                    )
                  ) : view === 'vlm' ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(r.whole.image.artifact_id)}
                        width={r.whole.image.width}
                        height={r.whole.image.height}
                        alt="VLM 實際收到的整張影像"
                      />
                      <p className="text-muted mt-2 text-xs">
                        VLM 實際收到的 JPEG：{r.whole.image.width}×{r.whole.image.height} px、
                        {kb(r.whole.num_bytes)}（縮放 ×{r.whole.scale.toFixed(3)}）。
                      </p>
                      <h3 className="mt-4 text-sm font-semibold">尺寸試算</h3>
                      <DataTable
                        label="不同長邊上限下的輸出尺寸與 JPEG 大小"
                        columns={['長邊上限', '輸出尺寸', 'JPEG', '像素數（MP）']}
                        rows={VLM_SIDES.map((side, i) => {
                          const w = sizes[i]?.data?.whole
                          return [
                            side,
                            w ? `${w.image.width}×${w.image.height}` : '…',
                            w ? kb(w.num_bytes) : '…',
                            w ? ((w.image.width * w.image.height) / 1e6).toFixed(2) : '…',
                          ]
                        })}
                      />
                      <p className="text-muted mt-2 text-xs">
                        最終尺寸由 E2 實驗依準確率決定；這裡只列出檔案大小的變化。
                      </p>
                    </>
                  ) : (
                    <StepsTable steps={r.steps} />
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
