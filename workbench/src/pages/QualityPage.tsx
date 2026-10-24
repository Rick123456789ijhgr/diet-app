// 模組一：品質檢查。疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。
import { BarChart3, Download, ImageIcon, ListOrdered, ScanLine, SunMoon } from 'lucide-react'
import { useState } from 'react'

import { api, artifactUrl, overrideBody, unwrap, type ConfigOverride } from '@/api/client'
import { ConfigIO } from '@/components/ConfigIO'
import { Histogram } from '@/components/Histogram'
import { ImageSourcePanel } from '@/components/ImageSourcePanel'
import { ImageViewer } from '@/components/ImageViewer'
import { EmptyState, MainView, ReadoutBlock, Split, Workspace } from '@/components/layout/Workspace'
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
import { Badge, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useConfigClass } from '@/hooks/useConfigSchemas'
import { useImagePipeline } from '@/hooks/useImagePipeline'
import { useRenderView } from '@/hooks/useRenderView'
import { valueOf } from '@/lib/config'

type ViewKind = 'original' | 'laplacian' | 'exposure' | 'histogram' | 'steps'

/** 主檢視的分頁；laplacian／exposure／histogram 另向後端要診斷檢視（RenderView）。 */
const VIEWS = [
  { value: 'original' as const, label: withIcon(ImageIcon, '原圖') },
  { value: 'laplacian' as const, label: withIcon(ScanLine, '邊緣響應') },
  { value: 'exposure' as const, label: withIcon(SunMoon, '曝光遮罩') },
  { value: 'histogram' as const, label: withIcon(BarChart3, '直方圖') },
  { value: 'steps' as const, label: withIcon(ListOrdered, '步驟') },
]

/**
 * 品質檢查工具頁（`QualityConfig`）。
 *
 * 資料流：
 * 1. `useImagePipeline('label')` 產生或上傳原圖，再套用左側的模擬退化，得到要分析的 `image`。
 * 2. `useAnalysis` 以「影像 id＋參數覆寫（防抖後）」為查詢鍵呼叫 `/dev/quality`；
 *    參數改變時保留上一次結果並淡化，舊請求經 `signal` 取消。
 * 3. 診斷檢視（邊緣響應、曝光遮罩、直方圖）只在該分頁開啟時另外查詢（`useRenderView`）。
 *
 * 通過與否、分數、比例、警告都取自後端回應；前端只把它們與門檻並列顯示。
 */
export function QualityPage() {
  const quality = useConfigClass('QualityConfig')
  const degradationSchema = useConfigClass('Degradation').schema
  const pipeline = useImagePipeline('label')
  // 只存與預設值不同的欄位（由 ParamForm／ConfigIO 維護）
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
  // 原圖與步驟分頁不需要診斷檢視（enabled 為 false）；此時 view 名稱填 'histogram' 只是佔位。
  // 直方圖傳 null 參數，查詢鍵就不會因參數改變而重新請求。
  const rendered = useRenderView(
    image?.image_id,
    imageView ? view : 'histogram',
    imageView ? config : null,
    imageView || view === 'histogram',
  )

  /** 參數目前的值（顯示門檻用） */
  /** 某組參數的目前值（顯示門檻與說明用）；結果區用算出該結果的那組參數 */
  // 未覆寫時回到結構中的預設值；結構未載入或欄位不存在時回傳 NaN（顯示會變成 NaN）
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
            // 後端回 INVALID_CONFIG 時，在對應欄位旁標出錯誤
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

  // 影像管線或分析任一方還在計算（含防抖等待中）就顯示「計算中…」
  const busy = (pipeline.pending || analysis.busy) && (
    <Badge tone="primary" aria-live="polite">
      計算中…
    </Badge>
  )

  return (
    <Workspace
      panel={panel}
      title="品質檢查"
      description="疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。"
      aside={busy}
    >
      {/* AnalysisFrame 只在影像與結果屬於同一張圖時才呼叫 children，避免舊結果配新影像 */}
      <AnalysisFrame pipeline={pipeline} analysis={analysis} ready={!!quality.schema}>
        {({ data: result, roundTripMs, config: used }, img) => {
          // 門檻用「算出這個結果的參數」（used），而非畫面上最新的 config，否則防抖期間門檻與結果不一致
          const current = valuesOf(used as ConfigOverride)
          const short = Math.min(img.width, img.height)
          const pct = (v: number) => `${(v * 100).toFixed(1)}%`
          // 帶正負號的差值；負號用數學減號「−」（U+2212），與其他頁面的 delta 一致
          const signed = (v: number, f: (v: number) => string) =>
            (v >= 0 ? '+' : '−') + f(Math.abs(v))
          // 影像型檢視撐滿主檢視；直方圖與步驟表改為可捲動
          const isImage = view === 'original' || view === 'laplacian' || view === 'exposure'
          return (
            <Split
              main={
                <MainView
                  scroll={!isImage}
                  toolbar={
                    <>
                      <Segmented label="檢視" value={view} onChange={setView} options={VIEWS} />
                      <span className="flex-1" />
                      {/* 下載的是退化後、實際送去分析的影像 */}
                      <a
                        href={artifactUrl(img.image_id)}
                        download="workbench_input.jpg"
                        className="text-primary-ink inline-flex items-center gap-1 text-xs hover:underline"
                      >
                        <Download className="size-3.5" aria-hidden />
                        下載影像（JPEG）
                      </a>
                    </>
                  }
                  footer={
                    view === 'laplacian' ? (
                      <>
                        縮放到短邊 {current('blur_short_side')} px
                        後的拉普拉斯響應強度，越亮代表邊緣越銳利；模糊分數就是這張圖的變異數。
                      </>
                    ) : view === 'exposure' ? (
                      // 圖例顏色寫死，是為了對應後端畫進遮罩影像的藍、紅兩色（不是主題色）
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
                    ) : undefined
                  }
                >
                  {/* 主檢視：步驟表 → 原圖 → 診斷檢視（錯誤／載入中／直方圖／影像） */}
                  {view === 'steps' ? (
                    <StepsTable steps={result.steps} />
                  ) : view === 'original' ? (
                    <ImageViewer
                      fill
                      src={artifactUrl(img.image_id)}
                      width={img.width}
                      height={img.height}
                      alt="輸入影像"
                    />
                  ) : rendered.error ? (
                    <div className="p-4">
                      <ErrorBox error={rendered.error} />
                    </div>
                  ) : !rendered.data ? (
                    <EmptyState>載入中…</EmptyState>
                  ) : view === 'histogram' ? (
                    // 直方圖為資料型檢視：後端回 data.counts（各灰階的像素數），前端只負責畫
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
                    <ImageViewer
                      fill
                      src={artifactUrl(rendered.data.image.image_id)}
                      width={rendered.data.image.width}
                      height={rendered.data.image.height}
                      alt={view === 'laplacian' ? '拉普拉斯響應熱度圖' : '過暗與過亮像素遮罩'}
                    />
                  ) : (
                    <EmptyState>沒有影像</EmptyState>
                  )}
                </MainView>
              }
              readout={
                <>
                  <StatusCard
                    tone={result.passed ? 'ok' : 'bad'}
                    title={result.passed ? '通過品質檢查' : '未通過'}
                    badges={result.warnings.length > 0 && <WarningBadges codes={result.warnings} />}
                    detail={[
                      img.description,
                      `${img.width}×${img.height} px`,
                      `平均亮度 ${result.mean_brightness.toFixed(0)}`,
                      `往返 ${roundTripMs.toFixed(0)} ms`,
                    ]}
                  />
                  {/* 各指標：數值來自後端；delta 只是「數值 − 門檻」的顯示，good 決定綠／紅 */}
                  <ReadoutBlock title="指標">
                    <MetricGrid>
                      <Metric
                        label="模糊分數"
                        value={result.blur_score.toFixed(0)}
                        delta={`${signed(result.blur_score - current('blur_min'), (v) => v.toFixed(0))} 相對下限 ${current('blur_min')}`}
                        good={result.blur_score >= current('blur_min')}
                        help={`拉普拉斯變異數（縮放到短邊 ${current('blur_short_side')} px）；越低越模糊。`}
                      />
                      {/* 短邊直接取影像尺寸；是否通過用後端的 resolution_ok */}
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
                  </ReadoutBlock>
                </>
              }
            />
          )
        }}
      </AnalysisFrame>
    </Workspace>
  )
}
