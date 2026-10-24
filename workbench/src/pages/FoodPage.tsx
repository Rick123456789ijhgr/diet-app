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
import {
  EmptyState,
  MainView,
  ReadoutBlock,
  Section,
  Split,
  Workspace,
} from '@/components/layout/Workspace'
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
import { Badge, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useConfigClass } from '@/hooks/useConfigSchemas'
import { useDebounced } from '@/hooks/useDebounced'
import { useImagePipeline } from '@/hooks/useImagePipeline'
import { useRenderView } from '@/hooks/useRenderView'
import { valueOf } from '@/lib/config'

type ViewKind = 'boxes' | 'mask' | 'plates' | 'crops' | 'vlm' | 'steps'

/** 主檢視的分頁；mask 另向後端要診斷檢視，vlm 會另外試算多組長邊上限。 */
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

/** 呼叫 `/dev/food`；主分析、盤緣試算與 VLM 尺寸試算共用。 */
function runFood(imageId: string, cfg: ConfigOverride, signal: AbortSignal): Promise<FoodResult> {
  return unwrap(
    api.POST('/workbench/v1/dev/food', {
      body: { image_id: imageId, config: overrideBody(cfg) },
      signal,
    }),
  )
}

/** 位元組 → KB（1024 進位、取整數） */
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`

/**
 * 食物照片工具頁（`FoodConfig`）。
 *
 * 一頁內有四組查詢，各自只在需要時送出：
 * 1. `analysis`：主分析（切菜框、盤緣、VLM 輸入、步驟），任何分頁都會跑。
 * 2. `plateTrial`：盤緣步驟關閉時，在「盤緣」分頁強制 `enable_plate: true` 試算一次，方便調盤緣參數。
 * 3. `mask`：「前景遮罩」分頁的診斷檢視。
 * 4. `sizes`：「VLM 輸入」分頁對 `VLM_SIDES` 每個長邊上限各跑一次，只看輸出尺寸與 JPEG 大小。
 *
 * 菜數與真值的差、盤緣短長比是前端顯示用的評測／換算；其餘數字都來自後端。
 */
export function FoodPage() {
  const food = useConfigClass('FoodConfig')
  const degradationSchema = useConfigClass('Degradation').schema
  const pipeline = useImagePipeline('food')
  // 只存與預設值不同的欄位（由 ParamForm／ConfigIO 維護）
  const [config, setConfig] = useState<ConfigOverride>({})
  const [view, setView] = useState<ViewKind>('boxes')
  const image = pipeline.image
  // 給 VLM 尺寸試算用的防抖參數（useAnalysis 內部另有自己的防抖）
  const debounced = useDebounced(config)

  const analysis = useAnalysis({ name: 'food', imageId: image?.image_id, config, run: runFood })
  // useMemo 讓物件保持穩定：useAnalysis 以「防抖值 === 目前值」判斷是否可送出，
  // 每次重繪都產生新物件會讓防抖永遠追不上
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
  // 前景遮罩只在該分頁開啟時查詢；用目前參數（config 為 state，本身就是穩定物件）
  const mask = useRenderView(image?.image_id, 'food_mask', config, view === 'mask')
  // 尺寸試算沿用目前的 JPEG 品質（防抖後），讓表格與主分析可比較；結構未載入時暫用 85
  const quality = food.schema
    ? (valueOf(
        food.schema.fields.find((f) => f.name === 'vlm_jpeg_quality')!,
        debounced,
      ) as number)
    : 85
  // 每個候選長邊一個查詢；關掉切菜與盤緣，只算整張影像的縮放壓縮。
  // 查詢鍵含 image_id 與品質，換圖或改品質時重算；未設 placeholderData，重算期間表格顯示「…」。
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
            // 後端回 INVALID_CONFIG 時，在對應欄位旁標出錯誤
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
    <Workspace
      panel={panel}
      title="食物照片"
      description="切出各道菜、偵測盤緣，並把整張與各裁切縮放壓縮成送給 VLM 的大小。"
      aside={
        (pipeline.pending || analysis.busy) && (
          <Badge tone="primary" aria-live="polite">
            計算中…
          </Badge>
        )
      }
    >
      {/* AnalysisFrame 只在影像與結果屬於同一張圖時才呼叫 children，避免舊框疊到新影像上 */}
      <AnalysisFrame pipeline={pipeline} analysis={analysis} ready={!!food.schema}>
        {({ data: r, roundTripMs, config: used }, img) => {
          // 門檻與說明用「算出這個結果的參數」（used），防抖期間才不會與結果對不上
          const current = valuesOf(used as ConfigOverride)
          // 真值只有合成影像才有（FreeJson，需自行斷言型別）；上傳照片時為 undefined
          const truthPlates = img.truth?.plates as Ellipse[] | undefined
          const truthBoxes = img.truth?.plate_boxes as Box[] | undefined
          // VLM 實際會收到的總大小：整張＋所有裁切
          const total = r.whole.num_bytes + r.crops.reduce((a, c) => a + c.num_bytes, 0)
          // 盤緣步驟開啟時用主結果；關閉時改用試算結果（尚未回來則為空陣列）
          const plates = r.plates_enabled ? r.plates : (plateTrial.shown?.data.plates ?? [])
          const readout = (
            <>
              <StatusCard
                tone={r.warnings.length ? 'warn' : 'ok'}
                title={r.warnings.length ? '有警告' : '處理完成'}
                badges={r.warnings.length > 0 && <WarningBadges codes={r.warnings} tone="accent" />}
                detail={[
                  img.description,
                  `輸入 ${img.width}×${img.height} px → VLM ${r.whole.image.width}×${r.whole.image.height} px`,
                  `往返 ${roundTripMs.toFixed(0)} ms`,
                ]}
              />
              <ReadoutBlock title="指標">
                <MetricGrid>
                  {/* delta 為「切出框數 − 真實盤數」，前端評測顯示（負號用 U+2212） */}
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
                    wide
                    label="VLM 大小"
                    value={kb(total)}
                    help={`整張與 ${r.crops.length} 張裁切的 JPEG 總大小（長邊 ≤ ${current('vlm_max_side')} px、品質 ${current('vlm_jpeg_quality')}）。`}
                  />
                </MetricGrid>
              </ReadoutBlock>
              {/* 盤緣明細只在盤緣分頁顯示；短長比 minor/major 越接近 1 越接近正圓（俯拍） */}
              {view === 'plates' && plates.length > 0 && (
                <ReadoutBlock title={r.plates_enabled ? '盤緣橢圓' : '盤緣橢圓（試算）'}>
                  <DataTable
                    label="找到的盤緣橢圓"
                    columns={['中心', '長／短軸', '短長比', '角度']}
                    rows={plates.map((e) => [
                      `${e.cx.toFixed(0)}, ${e.cy.toFixed(0)}`,
                      `${e.major.toFixed(0)}／${e.minor.toFixed(0)}`,
                      (e.minor / e.major).toFixed(2),
                      `${e.angle.toFixed(1)}°`,
                    ])}
                  />
                </ReadoutBlock>
              )}
            </>
          )
          const footer =
            view === 'boxes' ? (
              <Legend
                items={[
                  { color: FOUND, label: '切出的框（已外擴）' },
                  { color: TRUTH, label: '真實盤子的外接框（合成影像，虛線）' },
                ]}
              />
            ) : view === 'mask' ? (
              <>
                紅色為前景：與背景色（四周{' '}
                {((current('bg_border_ratio') as number) * 100).toFixed(1)}% 邊框的中位數）ΔE &gt;{' '}
                {current('bg_distance')}，形態學半徑 {current('morph_px')} px，已縮小到短邊{' '}
                {current('detect_short_side')} px。
              </>
            ) : view === 'plates' ? (
              <Legend
                items={[
                  {
                    color: FOUND,
                    label: `找到 ${plates.length} 個${r.plates_enabled ? '' : '（步驟未啟用，此處僅試算）'}`,
                  },
                  { color: TRUTH, label: '真實盤緣（合成影像，虛線）' },
                ]}
              />
            ) : undefined
          // 主檢視依分頁切換：裁切框 → 前景遮罩 → 盤緣 → 各道菜 → VLM 輸入 → 步驟
          const main =
            view === 'boxes' ? (
              <ImageViewer
                fill
                src={artifactUrl(img.image_id)}
                width={img.width}
                height={img.height}
                alt="切出的各道菜"
                // 疊圖座標為原圖像素；px 讓線寬與標籤維持固定的螢幕大小。真值先畫、找到的在上層
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
            ) : view === 'mask' ? (
              mask.error ? (
                <div className="p-4">
                  <ErrorBox error={mask.error} />
                </div>
              ) : !mask.data?.image ? (
                <EmptyState>載入中…</EmptyState>
              ) : (
                <ImageViewer
                  fill
                  src={artifactUrl(mask.data.image.image_id)}
                  width={mask.data.image.width}
                  height={mask.data.image.height}
                  alt="切菜用的前景遮罩"
                />
              )
            ) : view === 'plates' ? (
              <ImageViewer
                fill
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
            ) : view === 'crops' ? (
              r.crops.length === 0 ? (
                <EmptyState>沒有裁切：切菜未啟用或切不出任何框。VLM 只會收到整張影像。</EmptyState>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                  {r.crops.map((c, i) => {
                    // 假設 crops 與 dishes 依相同順序一一對應（第 i 張裁切來自第 i 個框）
                    const b = r.dishes[i]
                    return (
                      <figure
                        key={c.image.artifact_id}
                        className="bg-sunken overflow-hidden rounded-2xl"
                      >
                        <div className="viewport-grid rounded-t-2xl">
                          <img
                            src={artifactUrl(c.image.artifact_id)}
                            alt={`第 ${i + 1} 道菜`}
                            className="aspect-square w-full object-contain"
                          />
                        </div>
                        <figcaption className="text-muted flex justify-between gap-2 px-3 py-1.5 text-xs">
                          <span className="text-ink font-medium">#{i + 1}</span>
                          <span className="readout truncate">
                            {b && `${b.x},${b.y} ${b.w}×${b.h}`} · {kb(c.num_bytes)}
                          </span>
                        </figcaption>
                      </figure>
                    )
                  })}
                </div>
              )
            ) : view === 'vlm' ? (
              <>
                {/* 不用 fill：以實際尺寸顯示，下方還要放尺寸試算表 */}
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
                <Section title="尺寸試算" className="mt-5">
                  <DataTable
                    label="不同長邊上限下的輸出尺寸與 JPEG 大小"
                    columns={['長邊上限', '輸出尺寸', 'JPEG', '像素數（MP）']}
                    // sizes 與 VLM_SIDES 同順序；尚未回來的列顯示「…」
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
                </Section>
              </>
            ) : (
              <StepsTable steps={r.steps} />
            )
          // 影像型分頁撐滿主檢視；各道菜、VLM 輸入、步驟改為可捲動
          const isImage = view === 'boxes' || view === 'mask' || view === 'plates'
          return (
            <Split
              readout={readout}
              main={
                <MainView
                  scroll={!isImage}
                  footer={footer}
                  toolbar={
                    <Segmented label="檢視" value={view} onChange={setView} options={VIEWS} />
                  }
                >
                  {main}
                </MainView>
              }
            />
          )
        }}
      </AnalysisFrame>
    </Workspace>
  )
}
