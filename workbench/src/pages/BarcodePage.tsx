// 模組一：條碼與電子發票 QR。逐步升級：依序嘗試各階影像，第一次成功即停止。
import { Barcode, Binary, Layers, ListOrdered, QrCode, ScanSearch } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  api,
  artifactUrl,
  overrideBody,
  unwrap,
  type BarcodeResult,
  type ConfigOverride,
  type DecodeHit,
  type InvoiceQrResult,
  type RungAttempt,
} from '@/api/client'
import { ConfigIO } from '@/components/ConfigIO'
import { ImageSourcePanel } from '@/components/ImageSourcePanel'
import { ImageViewer } from '@/components/ImageViewer'
import { LadderControls } from '@/components/LadderControls'
import {
  EmptyState,
  MainView,
  ReadoutBlock,
  Section,
  Split,
  Workspace,
} from '@/components/layout/Workspace'
import { FOUND, Quad } from '@/components/overlays'
import { ParamForm } from '@/components/ParamForm'
import {
  AnalysisFrame,
  DataTable,
  ErrorBox,
  Metric,
  MetricGrid,
  StatusCard,
  WarningBadges,
} from '@/components/results'
import { ToolPanel } from '@/components/ToolPanel'
import { Badge, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useConfigClass, useConfigSchemas } from '@/hooks/useConfigSchemas'
import { syntheticSource, useImagePipeline } from '@/hooks/useImagePipeline'
import { useRenderView } from '@/hooks/useRenderView'
import { asciiPreview, fromBase64, hexPreview } from '@/lib/bytes'
import { rungText } from '@/lib/text'

/** barcode：商品條碼（EAN-13 等）；invoice：電子發票左右兩個 QR */
type Mode = 'barcode' | 'invoice'
type ViewKind = 'hits' | 'rung' | 'steps' | 'bytes'

/** 頁面的參數狀態：階梯（LadderConfig）與解碼器（ZxingConfig）兩組覆寫，一起作為查詢鍵 */
interface LadderBody {
  ladder: ConfigOverride
  zxing: ConfigOverride
}

/** 帶模式標記的結果，用來辨別結果屬於哪個模式（切換模式後舊結果仍可能在畫面上） */
type Result = { mode: 'barcode'; data: BarcodeResult } | { mode: 'invoice'; data: InvoiceQrResult }

/**
 * 依模式呼叫條碼或發票 QR 路由；兩者請求格式相同（image_id＋ladder＋zxing 覆寫）。
 * `overrideBody`：沒有覆寫時送 undefined，後端視為全部用預設值。
 */
async function runLadder(
  mode: Mode,
  imageId: string,
  b: LadderBody,
  signal: AbortSignal,
): Promise<Result> {
  const body = { image_id: imageId, ladder: overrideBody(b.ladder), zxing: overrideBody(b.zxing) }
  if (mode === 'barcode') {
    return { mode, data: await unwrap(api.POST('/workbench/v1/dev/barcode', { body, signal })) }
  }
  return { mode, data: await unwrap(api.POST('/workbench/v1/dev/invoice-qr', { body, signal })) }
}

/**
 * 條碼與電子發票 QR 工具頁。
 *
 * 資料流：
 * 1. `useImagePipeline` 產生合成條碼／發票或上傳照片，再套用模擬退化，得到 `image`。
 * 2. `analysis`：用目前的階梯與解碼器參數跑完整的逐步升級階梯（`runLadder`）。
 * 3. `baseline`：同樣參數但只嘗試 raw（原圖），作為 E1 消融的對照；只在商品條碼模式啟用。
 * 4. `variant`：「各階影像」分頁中，向後端要某一次嘗試實際送進解碼器的影像（ladder_variant 檢視）。
 *
 * 成功與否、命中的階、警告都來自後端；前端只顯示與切換檢視。
 */
export function BarcodePage() {
  const schemas = useConfigSchemas()
  const ladderSchema = useConfigClass('LadderConfig').schema
  const zxingSchema = useConfigClass('ZxingConfig').schema
  const degradationSchema = useConfigClass('Degradation').schema
  const [mode, setMode] = useState<Mode>('barcode')
  // 合成場景隨模式切換；pipeline 的初始場景固定為 ean13（初始模式為 barcode），之後由 switchMode 換
  const scene = mode === 'barcode' ? 'ean13' : 'invoice'
  const pipeline = useImagePipeline('ean13')
  const [body, setBody] = useState<LadderBody>({ ladder: {}, zxing: {} })
  const { ladder, zxing } = body
  const [view, setView] = useState<ViewKind>('hits')
  // 「各階影像」分頁選的嘗試序號；null 表示跟隨預設（成功的那一次或最後一次）
  const [attempt, setAttempt] = useState<number | null>(null)
  const image = pipeline.image

  // 只更新其中一組覆寫（ladder 或 zxing），另一組保留
  const update = (next: Partial<LadderBody>) => setBody({ ...body, ...next })

  // 切換模式：重設選的嘗試；商品條碼沒有「位元組」分頁，需退回偵測結果；
  // 合成來源要換成對應場景，上傳的照片則保留不動
  const switchMode = (m: Mode) => {
    setMode(m)
    setAttempt(null)
    if (m === 'barcode' && view === 'bytes') setView('hits')
    if (pipeline.source.kind === 'synthetic') {
      pipeline.setSource(syntheticSource(m === 'barcode' ? 'ean13' : 'invoice'))
    }
  }

  // 查詢鍵名稱用 mode，兩種模式的結果分開快取
  const analysis = useAnalysis({
    name: mode,
    imageId: image?.image_id,
    config: body,
    run: (id, b, signal) => runLadder(mode, id, b, signal),
  })
  // 只用原圖的對照（E1 的基準）：同樣的參數，但只嘗試 raw
  const baseline = useAnalysis({
    name: 'barcode-raw',
    imageId: image?.image_id,
    config: body,
    run: (id, b, signal) =>
      runLadder('barcode', id, { ...b, ladder: { ...b.ladder, rungs: ['raw'] } }, signal),
    enabled: mode === 'barcode',
  })

  // shown 在計算中或出錯時沿用上一次結果，可能還是切換前模式的結果，所以要比對 mode
  const result = analysis.shown?.data
  const attempts: RungAttempt[] = result && result.mode === mode ? result.data.attempts : []
  // 預設顯示成功的那一次；發票模式或全部失敗時顯示最後一次
  const defaultAttempt =
    result?.mode === 'barcode' && result.data.success_index >= 0
      ? result.data.success_index
      : attempts.length - 1
  // 夾在 [0, attempts.length - 1]：換參數後嘗試次數可能變少，舊的選擇會超出範圍
  const shownAttempt = Math.max(
    0,
    Math.min(attempt ?? defaultAttempt, Math.max(0, attempts.length - 1)),
  )
  // 物件要穩定，否則每次重繪都會重設防抖計時器
  const variantConfig = useMemo(
    () => ({ ladder: body.ladder, index: shownAttempt }),
    [body.ladder, shownAttempt],
  )
  // 只在「各階影像」分頁且已有嘗試紀錄時查詢
  const variant = useRenderView(
    image?.image_id,
    'ladder_variant',
    variantConfig,
    view === 'rung' && attempts.length > 0,
  )

  // Rung、CodeFormat 等列舉值由參數結構提供，不在前端寫死
  const enums = schemas.data?.enums ?? {}
  const configError = analysis.configError
  const panel = (
    <ToolPanel
      paramsLabel="階梯參數"
      // 兩組參數的覆寫數合計，顯示在「階梯參數」標籤旁
      changed={Object.keys(ladder).length + Object.keys(zxing).length}
      image={
        <ImageSourcePanel pipeline={pipeline} scene={scene} degradationSchema={degradationSchema} />
      }
      params={
        ladderSchema && zxingSchema ? (
          <div className="space-y-6">
            {/* 序列欄位（rungs 順序、formats）由 LadderControls 管理；OTHER 不是可選的條碼格式 */}
            <LadderControls
              schema={ladderSchema}
              overrides={ladder}
              onChange={(o) => update({ ladder: o })}
              rungs={enums.Rung ?? []}
              formats={(enums.CodeFormat ?? []).filter((f) => f !== 'OTHER')}
              showFormats={mode === 'barcode'}
            />
            {/* 純量欄位交給 ParamForm；回寫時要把序列欄位合併回去，否則會被覆蓋掉 */}
            <ParamForm
              schema={ladderSchema}
              overrides={scalars(ladder)}
              onChange={(o) => update({ ladder: { ...o, ...sequences(ladder) } })}
              invalidField={configError?.field}
              invalidMessage={configError?.message}
            />
            <div className="border-card-border border-t pt-4">
              <h3 className="mb-1 text-sm font-semibold">解碼器（zxing-cpp）</h3>
              <p className="text-muted mb-3 text-xs">E1 消融時可全部關閉，量測階梯本身的貢獻。</p>
              <ParamForm
                schema={zxingSchema}
                overrides={zxing}
                onChange={(o) => update({ zxing: o })}
              />
            </div>
          </div>
        ) : (
          <EmptyState>載入參數結構中…</EmptyState>
        )
      }
      // 匯入／匯出只處理階梯參數（不含 zxing）
      io={
        ladderSchema && (
          <ConfigIO
            schema={ladderSchema}
            overrides={ladder}
            onImport={(o) => update({ ladder: o })}
          />
        )
      }
    />
  )

  // 「位元組」分頁只在發票模式出現（商品條碼不需要看原始位元組）
  const views = [
    { value: 'hits' as const, label: withIcon(ScanSearch, '偵測結果') },
    { value: 'rung' as const, label: withIcon(Layers, '各階影像') },
    { value: 'steps' as const, label: withIcon(ListOrdered, '步驟') },
    ...(mode === 'invoice' ? [{ value: 'bytes' as const, label: withIcon(Binary, '位元組') }] : []),
  ]

  return (
    <Workspace
      panel={panel}
      title="條碼與發票 QR"
      description="逐步升級：依序嘗試原圖、灰階、二值化、去雜訊、旋轉校正、多尺度、銳化，第一次成功即停止。"
      aside={
        <div className="flex items-center gap-2">
          {(pipeline.pending || analysis.busy) && (
            <Badge tone="primary" aria-live="polite">
              計算中…
            </Badge>
          )}
          <Segmented
            label="模式"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'barcode', label: withIcon(Barcode, '商品條碼') },
              { value: 'invoice', label: withIcon(QrCode, '電子發票 QR') },
            ]}
          />
        </div>
      }
    >
      {/* ready 額外要求結果屬於目前模式，切換模式後不會用舊模式的結果畫畫面 */}
      <AnalysisFrame
        pipeline={pipeline}
        analysis={analysis}
        ready={!!ladderSchema && result?.mode === mode}
      >
        {({ data: r, roundTripMs }, img) => {
          // 統一成命中清單：條碼模式為所有 hits；發票模式為找到的左、右碼（未找到者略過）。
          // labels 與 hits 一一對應：條碼用內容文字，發票用 L／R
          const hits: DecodeHit[] =
            r.mode === 'barcode'
              ? r.data.hits
              : ([r.data.left, r.data.right].filter(Boolean) as DecodeHit[])
          const labels =
            r.mode === 'barcode'
              ? r.data.hits.map((h) => h.text)
              : ([r.data.left && 'L', r.data.right && 'R'].filter(Boolean) as string[])
          // 只用原圖的對照結果；還沒回來或不是條碼結果時顯示「…」
          const base = baseline.shown?.data
          const readout = (
            <>
              {/* 讀數欄：條碼與發票的狀態卡、指標不同，解碼結果表共用 */}
              {r.mode === 'barcode' ? (
                <>
                  <StatusCard
                    tone={r.data.success ? 'ok' : 'bad'}
                    title={r.data.success ? '解碼成功' : '解碼失敗'}
                    badges={
                      (r.data.success_rung || r.data.warnings.length > 0) && (
                        <>
                          {r.data.success_rung && (
                            <Badge tone="primary">{rungText(r.data.success_rung)}</Badge>
                          )}
                          <WarningBadges codes={r.data.warnings} />
                        </>
                      )
                    }
                    detail={[
                      img.description,
                      `${img.width}×${img.height} px`,
                      `往返 ${roundTripMs.toFixed(0)} ms`,
                      `只用原圖：${base?.mode === 'barcode' ? (base.data.success ? '成功' : '失敗') : '…'}`,
                    ]}
                  />
                  <ReadoutBlock title="指標">
                    <MetricGrid>
                      <Metric
                        label="成功於"
                        value={
                          r.data.success_index >= 0 ? `第 ${r.data.success_index + 1} 次` : '—'
                        }
                      />
                      <Metric label="嘗試次數" value={String(r.data.attempts.length)} />
                      <Metric
                        wide
                        label="條碼內容"
                        value={r.data.hits[0]?.text ?? '—'}
                        help="檢查碼錯誤的 EAN-13 不算成功（可在「階梯參數 → 驗證」關閉）。"
                      />
                    </MetricGrid>
                  </ReadoutBlock>
                </>
              ) : (
                <>
                  <StatusCard
                    tone={r.data.left && r.data.right ? 'ok' : 'warn'}
                    title={r.data.left && r.data.right ? '找到左右兩碼' : '結果不完整'}
                    badges={
                      r.data.warnings.length > 0 && (
                        <WarningBadges codes={r.data.warnings} tone="accent" />
                      )
                    }
                    detail={[
                      img.description,
                      `${img.width}×${img.height} px`,
                      `往返 ${roundTripMs.toFixed(0)} ms`,
                    ]}
                  />
                  <ReadoutBlock title="指標">
                    <MetricGrid>
                      {(
                        [
                          ['左碼', r.data.left],
                          ['右碼', r.data.right],
                        ] as const
                      ).map(([label, hit]) => (
                        <Metric
                          key={label}
                          label={label}
                          value={hit ? `${fromBase64(hit.raw).length} bytes` : '未找到'}
                        />
                      ))}
                      <Metric label="嘗試次數" value={String(r.data.attempts.length)} />
                    </MetricGrid>
                  </ReadoutBlock>
                </>
              )}
              {hits.length > 0 && (
                <ReadoutBlock title="解碼結果">
                  <DataTable
                    label="解碼結果"
                    columns={['#', '格式', '內容', '位元組']}
                    // 第一欄：條碼模式（label 即內容）顯示序號，發票模式顯示 L／R
                    rows={hits.map((h, i) => [
                      labels[i] === h.text ? i + 1 : (labels[i] ?? i + 1),
                      h.format,
                      <span className="readout text-xs break-all">{h.text}</span>,
                      fromBase64(h.raw).length,
                    ])}
                  />
                </ReadoutBlock>
              )}
            </>
          )
          // 主檢視依分頁切換：偵測結果 → 步驟 → 位元組（僅發票）→ 各階影像（錯誤／載入中／影像／略過）
          const main =
            view === 'hits' ? (
              <ImageViewer
                fill
                src={artifactUrl(img.image_id)}
                width={img.width}
                height={img.height}
                alt="原圖與偵測到的條碼四角"
                // 疊圖座標為原圖像素，四角取自解碼器回報的 corners；px 讓線寬維持固定的螢幕大小
                overlay={(px) =>
                  hits.map((h, i) => (
                    <Quad key={i} points={h.corners} color={FOUND} label={labels[i]} px={px} />
                  ))
                }
              />
            ) : view === 'steps' ? (
              <AttemptsTable attempts={r.data.attempts} />
            ) : view === 'bytes' && r.mode === 'invoice' ? (
              <div className="space-y-4">
                {/* 原始位元組的十六進位與 ASCII 預覽（raw 為 base64） */}
                {(
                  [
                    ['左碼', r.data.left],
                    ['右碼', r.data.right],
                  ] as const
                ).map(([label, hit]) => (
                  <Section key={label} title={label}>
                    {hit ? (
                      <>
                        <pre className="bg-sunken border-card-border readout rounded-lg border p-2 text-xs whitespace-pre-wrap">
                          {hexPreview(fromBase64(hit.raw))}
                        </pre>
                        <pre className="bg-sunken border-card-border readout mt-1 rounded-lg border p-2 text-xs whitespace-pre-wrap">
                          {asciiPreview(fromBase64(hit.raw))}
                        </pre>
                      </>
                    ) : (
                      <p className="text-muted text-xs">未找到</p>
                    )}
                  </Section>
                ))}
                <p className="text-muted text-xs">
                  只顯示原始位元組；中文解碼與欄位解析由之後的發票模組負責。
                </p>
              </div>
            ) : variant.error ? (
              <div className="p-4">
                <ErrorBox error={variant.error} />
              </div>
            ) : !variant.data ? (
              <EmptyState>載入中…</EmptyState>
            ) : variant.data.image ? (
              <ImageViewer
                fill
                src={artifactUrl(variant.data.image.image_id)}
                width={variant.data.image.width}
                height={variant.data.image.height}
                alt="送進解碼器的影像版本"
              />
            ) : (
              // 後端沒有回影像：代表這一階被略過，顯示當時的參數說明原因
              <EmptyState>此階已略過（{formatParams(variant.data.data?.params)}）。</EmptyState>
            )
          return (
            <Split
              readout={readout}
              main={
                <MainView
                  scroll={view === 'steps' || view === 'bytes'}
                  toolbar={
                    <>
                      <Segmented label="檢視" value={view} onChange={setView} options={views} />
                      {/* 各階影像分頁：選要看第幾次嘗試 */}
                      {view === 'rung' && (
                        <select
                          aria-label="嘗試"
                          value={shownAttempt}
                          onChange={(e) => setAttempt(Number(e.target.value))}
                          className="border-card-border bg-card h-7 rounded-lg border px-2 text-xs"
                        >
                          {r.data.attempts.map((a, i) => (
                            <option key={i} value={i}>
                              #{i + 1} {rungText(a.rung)}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  }
                  footer={
                    view === 'rung' && variant.data?.image ? (
                      <>
                        送進解碼器的影像：{variant.data.image.width}×{variant.data.image.height} px
                        · 參數 {formatParams(variant.data.data?.params)}
                      </>
                    ) : undefined
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

/** 序列欄位（rungs 等，由 LadderControls 管理）與表單欄位（param()，由 ParamForm 管理）分開處理。 */
function sequences(o: ConfigOverride): ConfigOverride {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => Array.isArray(v)))
}

/** 只留純量欄位（非陣列），交給 ParamForm。 */
function scalars(o: ConfigOverride): ConfigOverride {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => !Array.isArray(v)))
}

/** 把後端回報的參數物件格式化成「k=v、k=v」；沒有參數時顯示「無」。 */
function formatParams(params: unknown): string {
  const entries = Object.entries((params as Record<string, unknown> | undefined) ?? {})
  return entries.length ? entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('、') : '無'
}

/**
 * 「步驟」分頁：列出每一次嘗試的階、耗時、命中內容與被拒絕的命中（例如 EAN-13 檢查碼錯誤）。
 */
function AttemptsTable({ attempts }: { attempts: RungAttempt[] }) {
  return (
    <DataTable
      label="各階嘗試的結果與耗時"
      columns={['#', '階', '耗時（ms）', '結果', '不採用', '參數']}
      rows={attempts.map((a, i) => [
        i + 1,
        rungText(a.rung),
        a.elapsed_ms.toFixed(1),
        a.skipped ? '略過' : a.hits.map((h) => h.text).join('、') || '—',
        a.rejected.map((h) => `${h.format} ${h.text}`).join('、') || '—',
        <span className="text-muted font-mono text-xs">{formatParams(a.params)}</span>,
      ])}
    />
  )
}
