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
import { EmptyState, PageHeader, Section, Workspace } from '@/components/layout/Workspace'
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
import { Badge, Card, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useConfigClass, useConfigSchemas } from '@/hooks/useConfigSchemas'
import { syntheticSource, useImagePipeline } from '@/hooks/useImagePipeline'
import { useRenderView } from '@/hooks/useRenderView'
import { asciiPreview, fromBase64, hexPreview } from '@/lib/bytes'
import { rungText } from '@/lib/text'

type Mode = 'barcode' | 'invoice'
type ViewKind = 'hits' | 'rung' | 'steps' | 'bytes'

interface LadderBody {
  ladder: ConfigOverride
  zxing: ConfigOverride
}

type Result = { mode: 'barcode'; data: BarcodeResult } | { mode: 'invoice'; data: InvoiceQrResult }

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

export function BarcodePage() {
  const schemas = useConfigSchemas()
  const ladderSchema = useConfigClass('LadderConfig').schema
  const zxingSchema = useConfigClass('ZxingConfig').schema
  const degradationSchema = useConfigClass('Degradation').schema
  const [mode, setMode] = useState<Mode>('barcode')
  const scene = mode === 'barcode' ? 'ean13' : 'invoice'
  const pipeline = useImagePipeline('ean13')
  const [body, setBody] = useState<LadderBody>({ ladder: {}, zxing: {} })
  const { ladder, zxing } = body
  const [view, setView] = useState<ViewKind>('hits')
  const [attempt, setAttempt] = useState<number | null>(null)
  const image = pipeline.image

  const update = (next: Partial<LadderBody>) => setBody({ ...body, ...next })

  const switchMode = (m: Mode) => {
    setMode(m)
    setAttempt(null)
    if (m === 'barcode' && view === 'bytes') setView('hits')
    if (pipeline.source.kind === 'synthetic') {
      pipeline.setSource(syntheticSource(m === 'barcode' ? 'ean13' : 'invoice'))
    }
  }

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

  const result = analysis.shown?.data
  const attempts: RungAttempt[] = result && result.mode === mode ? result.data.attempts : []
  const defaultAttempt =
    result?.mode === 'barcode' && result.data.success_index >= 0
      ? result.data.success_index
      : attempts.length - 1
  const shownAttempt = Math.max(
    0,
    Math.min(attempt ?? defaultAttempt, Math.max(0, attempts.length - 1)),
  )
  // 物件要穩定，否則每次重繪都會重設防抖計時器
  const variantConfig = useMemo(
    () => ({ ladder: body.ladder, index: shownAttempt }),
    [body.ladder, shownAttempt],
  )
  const variant = useRenderView(
    image?.image_id,
    'ladder_variant',
    variantConfig,
    view === 'rung' && attempts.length > 0,
  )

  const enums = schemas.data?.enums ?? {}
  const configError = analysis.configError
  const panel = (
    <ToolPanel
      paramsLabel="階梯參數"
      changed={Object.keys(ladder).length + Object.keys(zxing).length}
      image={
        <ImageSourcePanel pipeline={pipeline} scene={scene} degradationSchema={degradationSchema} />
      }
      params={
        ladderSchema && zxingSchema ? (
          <div className="space-y-6">
            <LadderControls
              schema={ladderSchema}
              overrides={ladder}
              onChange={(o) => update({ ladder: o })}
              rungs={enums.Rung ?? []}
              formats={(enums.CodeFormat ?? []).filter((f) => f !== 'OTHER')}
              showFormats={mode === 'barcode'}
            />
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

  const views = [
    { value: 'hits' as const, label: withIcon(ScanSearch, '偵測結果') },
    { value: 'rung' as const, label: withIcon(Layers, '各階影像') },
    { value: 'steps' as const, label: withIcon(ListOrdered, '步驟') },
    ...(mode === 'invoice' ? [{ value: 'bytes' as const, label: withIcon(Binary, '位元組') }] : []),
  ]

  return (
    <Workspace panel={panel}>
      <PageHeader
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
      />
      <AnalysisFrame
        pipeline={pipeline}
        analysis={analysis}
        ready={!!ladderSchema && result?.mode === mode}
      >
        {({ data: r, roundTripMs }, img) => {
          const hits: DecodeHit[] =
            r.mode === 'barcode'
              ? r.data.hits
              : ([r.data.left, r.data.right].filter(Boolean) as DecodeHit[])
          const labels =
            r.mode === 'barcode'
              ? r.data.hits.map((h) => h.text)
              : ([r.data.left && 'L', r.data.right && 'R'].filter(Boolean) as string[])
          const base = baseline.shown?.data
          return (
            <>
              {r.mode === 'barcode' ? (
                <>
                  <StatusCard
                    tone={r.data.success ? 'ok' : 'bad'}
                    title={r.data.success ? '解碼成功' : '解碼失敗'}
                    badges={
                      <>
                        {r.data.success_rung && (
                          <Badge tone="primary">{rungText(r.data.success_rung)}</Badge>
                        )}
                        <WarningBadges codes={r.data.warnings} />
                      </>
                    }
                    detail={[
                      img.description,
                      `${img.width}×${img.height} px`,
                      `往返 ${roundTripMs.toFixed(0)} ms`,
                      `只用原圖：${base?.mode === 'barcode' ? (base.data.success ? '成功' : '失敗') : '…'}`,
                    ]}
                  />
                  <MetricGrid>
                    <Metric
                      label="成功於"
                      value={r.data.success_index >= 0 ? `第 ${r.data.success_index + 1} 次` : '—'}
                    />
                    <Metric label="嘗試次數" value={String(r.data.attempts.length)} />
                    <Metric
                      label="條碼內容"
                      value={r.data.hits[0]?.text ?? '—'}
                      help="檢查碼錯誤的 EAN-13 不算成功（可在「階梯參數 → 驗證」關閉）。"
                    />
                  </MetricGrid>
                </>
              ) : (
                <>
                  <StatusCard
                    tone={r.data.left && r.data.right ? 'ok' : 'warn'}
                    title={r.data.left && r.data.right ? '找到左右兩碼' : '結果不完整'}
                    badges={<WarningBadges codes={r.data.warnings} tone="accent" />}
                    detail={[
                      img.description,
                      `${img.width}×${img.height} px`,
                      `往返 ${roundTripMs.toFixed(0)} ms`,
                    ]}
                  />
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
                </>
              )}
              <Section title="檢視">
                <Segmented
                  label="檢視"
                  value={view}
                  onChange={setView}
                  options={views}
                  className="mb-3"
                />
                <Card className="p-3">
                  {view === 'hits' ? (
                    <>
                      <ImageViewer
                        src={artifactUrl(img.image_id)}
                        width={img.width}
                        height={img.height}
                        alt="原圖與偵測到的條碼四角"
                        overlay={(px) =>
                          hits.map((h, i) => (
                            <Quad
                              key={i}
                              points={h.corners}
                              color={FOUND}
                              label={labels[i]}
                              px={px}
                            />
                          ))
                        }
                      />
                      {hits.length > 0 && (
                        <DataTable
                          label="解碼結果"
                          columns={['#', '格式', '內容', '位元組']}
                          rows={hits.map((h, i) => [
                            labels[i] ?? i + 1,
                            h.format,
                            <span className="font-mono text-xs break-all">{h.text}</span>,
                            fromBase64(h.raw).length,
                          ])}
                        />
                      )}
                    </>
                  ) : view === 'steps' ? (
                    <AttemptsTable attempts={r.data.attempts} />
                  ) : view === 'bytes' && r.mode === 'invoice' ? (
                    <div className="space-y-4">
                      {(
                        [
                          ['左碼', r.data.left],
                          ['右碼', r.data.right],
                        ] as const
                      ).map(([label, hit]) => (
                        <div key={label}>
                          <h3 className="mb-1 text-sm font-semibold">{label}</h3>
                          {hit ? (
                            <>
                              <pre className="bg-hover rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
                                {hexPreview(fromBase64(hit.raw))}
                              </pre>
                              <pre className="bg-hover mt-1 rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
                                {asciiPreview(fromBase64(hit.raw))}
                              </pre>
                            </>
                          ) : (
                            <p className="text-muted text-xs">未找到</p>
                          )}
                        </div>
                      ))}
                      <p className="text-muted text-xs">
                        只顯示原始位元組；中文解碼與欄位解析由之後的發票模組負責。
                      </p>
                    </div>
                  ) : (
                    <>
                      <select
                        aria-label="嘗試"
                        value={shownAttempt}
                        onChange={(e) => setAttempt(Number(e.target.value))}
                        className="border-card-border bg-card mb-3 h-8 rounded-md border px-2 text-sm"
                      >
                        {r.data.attempts.map((a, i) => (
                          <option key={i} value={i}>
                            #{i + 1} {rungText(a.rung)}
                          </option>
                        ))}
                      </select>
                      {variant.error ? (
                        <ErrorBox error={variant.error} />
                      ) : !variant.data ? (
                        <EmptyState>載入中…</EmptyState>
                      ) : variant.data.image ? (
                        <>
                          <ImageViewer
                            src={artifactUrl(variant.data.image.image_id)}
                            width={variant.data.image.width}
                            height={variant.data.image.height}
                            alt="送進解碼器的影像版本"
                          />
                          <p className="text-muted mt-2 text-xs">
                            送進解碼器的影像：{variant.data.image.width}×{variant.data.image.height}{' '}
                            px · 參數 {formatParams(variant.data.data?.params)}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted text-sm">
                          此階已略過（{formatParams(variant.data.data?.params)}）。
                        </p>
                      )}
                    </>
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

/** 序列欄位（rungs 等，由 LadderControls 管理）與表單欄位（param()，由 ParamForm 管理）分開處理。 */
function sequences(o: ConfigOverride): ConfigOverride {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => Array.isArray(v)))
}

function scalars(o: ConfigOverride): ConfigOverride {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => !Array.isArray(v)))
}

function formatParams(params: unknown): string {
  const entries = Object.entries((params as Record<string, unknown> | undefined) ?? {})
  return entries.length ? entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('、') : '無'
}

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
