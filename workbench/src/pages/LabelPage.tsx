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
import { EmptyState, MainView, ReadoutBlock, Split, Workspace } from '@/components/layout/Workspace'
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
import { Badge, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useConfigClass } from '@/hooks/useConfigSchemas'
import { useImagePipeline } from '@/hooks/useImagePipeline'
import { useRenderView } from '@/hooks/useRenderView'
import { valueOf } from '@/lib/config'
import { CORNER_NAMES, mean, quadErrors } from '@/lib/geometry'
import { QUAD_METHOD_TEXT } from '@/lib/text'

type ViewKind = 'located' | 'edges' | 'glare' | 'output' | 'steps'

/** 主檢視的分頁；edges／glare 另向後端要診斷檢視（RenderView）。 */
const VIEWS = [
  { value: 'located' as const, label: withIcon(Crop, '定位') },
  { value: 'edges' as const, label: withIcon(ScanLine, '邊緣') },
  { value: 'glare' as const, label: withIcon(Flashlight, '光斑遮罩') },
  { value: 'output' as const, label: withIcon(FileOutput, '輸出') },
  { value: 'steps' as const, label: withIcon(ListOrdered, '步驟') },
]

/**
 * 營養標示工具頁（`LabelConfig`）。
 *
 * 資料流：
 * 1. `useImagePipeline('nutrition')` 產生合成標示或上傳照片，再套用模擬退化，得到 `image`。
 * 2. `useAnalysis` 以「影像 id＋參數覆寫（防抖後）」呼叫 `/dev/label`，取得四角、定位方法、
 *    光斑比例與輸出影像；參數改變時保留上一次結果並淡化，舊請求經 `signal` 取消。
 * 3. 「邊緣」「光斑遮罩」分頁另外查詢診斷檢視（`useRenderView`），只在分頁開啟時送出。
 *
 * 唯一在前端計算的數字是「四角誤差」（與合成真值比較，`lib/geometry.ts`），屬評測顯示的例外。
 */
export function LabelPage() {
  const label = useConfigClass('LabelConfig')
  const degradationSchema = useConfigClass('Degradation').schema
  const pipeline = useImagePipeline('nutrition')
  // 只存與預設值不同的欄位（由 ParamForm／ConfigIO 維護）
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
  // 邊緣與光斑兩個分頁共用一個查詢；其他分頁時 enabled 為 false，view 名稱只是佔位。
  // useRenderView 只在同一種檢視之間沿用舊結果，切換 edges↔glare 時不會閃出另一種影像。
  const rendered = useRenderView(
    image?.image_id,
    view === 'glare' ? 'glare_mask' : 'label_edges',
    config,
    view === 'edges' || view === 'glare',
  )

  /** 某組參數的目前值（顯示門檻與說明用）；結果區用算出該結果的那組參數 */
  // 未覆寫時回到結構中的預設值；結構未載入或欄位不存在時回傳 undefined
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
            // 後端回 INVALID_CONFIG 時，在對應欄位旁標出錯誤
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
    <Workspace
      panel={panel}
      title="營養標示"
      description="定位表格框並透視校正，再處理反光與增強對比；各段可在「參數」個別關閉。"
      aside={
        (pipeline.pending || analysis.busy) && (
          <Badge tone="primary" aria-live="polite">
            計算中…
          </Badge>
        )
      }
    >
      {/* AnalysisFrame 只在影像與結果屬於同一張圖時才呼叫 children，避免舊四角疊到新影像上 */}
      <AnalysisFrame pipeline={pipeline} analysis={analysis} ready={!!label.schema}>
        {({ data: r, roundTripMs, config: used }, img) => {
          // 門檻與說明用「算出這個結果的參數」（used），防抖期間才不會與結果對不上
          const current = valuesOf(used as ConfigOverride)
          // 只有合成影像帶真值四角；上傳照片或經旋轉、縮放退化後沒有，errors 為 null
          const truth = img.truth?.quad as Point[] | undefined
          const errors = quadErrors(r.quad, truth)
          const glareMax = current('glare_max_ratio') as number
          const pct = (v: number) => `${(v * 100).toFixed(2)}%`
          const readout = (
            <>
              <StatusCard
                tone={r.warnings.length ? 'warn' : 'ok'}
                title={r.warnings.length ? '有警告' : '處理完成'}
                badges={r.warnings.length > 0 && <WarningBadges codes={r.warnings} tone="accent" />}
                detail={[
                  img.description,
                  `輸入 ${img.width}×${img.height} px → 輸出 ${r.image.width}×${r.image.height} px`,
                  `往返 ${roundTripMs.toFixed(0)} ms`,
                ]}
              />
              <ReadoutBlock title="指標">
                <MetricGrid>
                  {/* 定位方法：校正關閉 → 未啟用；有 quad_method → 中文名稱（無對應時顯示原代碼）；否則找不到 */}
                  <Metric
                    wide
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
                  {/* glare_ratio 為負值代表光斑步驟未啟用（規格約定為 -1） */}
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
              </ReadoutBlock>
              {errors && (
                <ReadoutBlock title="四角誤差">
                  <DataTable
                    label="四角各自的誤差"
                    columns={['角', '誤差（px）']}
                    rows={errors.map((e, i) => [CORNER_NAMES[i], e.toFixed(2)])}
                  />
                </ReadoutBlock>
              )}
            </>
          )
          // 除了步驟表，其餘分頁都是撐滿的影像
          const isImage = view !== 'steps'
          return (
            <Split
              readout={readout}
              main={
                <MainView
                  scroll={!isImage}
                  toolbar={
                    <>
                      <Segmented label="檢視" value={view} onChange={setView} options={VIEWS} />
                      <span className="flex-1" />
                      {/* 輸出分頁才提供下載前處理後的 PNG */}
                      {view === 'output' && (
                        <a
                          href={artifactUrl(r.image.artifact_id)}
                          download="workbench_label.png"
                          className="text-primary-ink inline-flex items-center gap-1 text-xs hover:underline"
                        >
                          <Download className="size-3.5" aria-hidden />
                          下載 PNG
                        </a>
                      )}
                    </>
                  }
                  footer={
                    view === 'located' ? (
                      <Legend
                        items={[
                          { color: FOUND, label: '找到的四角（實心圓為左上角）' },
                          { color: TRUTH, label: '真實四角（合成影像，虛線）' },
                        ]}
                      />
                    ) : view === 'edges' ? (
                      `縮小到短邊 ${current('detect_short_side')} px 後的 Canny 邊緣（門檻 ${current('canny_low')}／${current('canny_high')}，已膨脹 3×3）；輪廓與直線都在這張圖上找。`
                    ) : view === 'glare' && rendered.data?.data?.enabled !== false ? (
                      // 條件中的 enabled !== false：光斑步驟關閉時主檢視已顯示「未啟用」，就不顯示門檻說明
                      `紅色為光斑：亮度 ≥ ${current('glare_v_min')} 且飽和度 ≤ ${current('glare_s_max')}，再擴張 ${current('glare_dilate_px')} px；疊在校正後、修補前的影像上。`
                    ) : undefined
                  }
                >
                  {/* 主檢視：定位疊圖 → 輸出 → 步驟表 → 診斷檢視（錯誤／載入中／未啟用／影像） */}
                  {view === 'located' ? (
                    <ImageViewer
                      fill
                      src={artifactUrl(img.image_id)}
                      width={img.width}
                      height={img.height}
                      alt="找到的表格四角"
                      // 疊圖座標為原圖像素（SVG 與影像同尺寸），px 用來把線寬換算成固定的螢幕粗細；
                      // 真值先畫、找到的後畫，重疊時找到的在上層
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
                  ) : view === 'output' ? (
                    <ImageViewer
                      fill
                      src={artifactUrl(r.image.artifact_id)}
                      width={r.image.width}
                      height={r.image.height}
                      alt="前處理後的營養標示"
                    />
                  ) : view === 'steps' ? (
                    <StepsTable steps={r.steps} />
                  ) : rendered.error ? (
                    <div className="p-4">
                      <ErrorBox error={rendered.error} />
                    </div>
                  ) : !rendered.data ? (
                    <EmptyState>載入中…</EmptyState>
                  ) : view === 'glare' && rendered.data.data?.enabled === false ? (
                    <EmptyState>光斑步驟未啟用（參數「步驟開關」）。</EmptyState>
                  ) : rendered.data.image ? (
                    <ImageViewer
                      fill
                      src={artifactUrl(rendered.data.image.image_id)}
                      width={rendered.data.image.width}
                      height={rendered.data.image.height}
                      alt={view === 'edges' ? '定位用的 Canny 邊緣圖' : '光斑遮罩'}
                    />
                  ) : (
                    <EmptyState>沒有影像</EmptyState>
                  )}
                </MainView>
              }
            />
          )
        }}
      </AnalysisFrame>
    </Workspace>
  )
}
