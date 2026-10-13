// 工具頁結果區的共用元件：分析框架（載入、錯誤、淡化）、狀態列、指標卡、錯誤框。
import { CircleAlert, CircleCheck, ImageIcon, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { ApiError, type ImageRef } from '@/api/client'
import { EmptyState } from '@/components/layout/Workspace'
import { Badge, Card } from '@/components/ui/primitives'
import type { ImagePipeline } from '@/hooks/useImagePipeline'
import type { Analysis, Timed } from '@/hooks/useAnalysis'
import { cn } from '@/lib/cn'
import { errorText, warningText } from '@/lib/text'

/**
 * 處理「尚未選檔／整體失敗／載入中」，結果出來後呈現 children。
 * 參數不合法或重新計算時保留上一次的結果並淡化，錯誤顯示在上方。
 */
export function AnalysisFrame<T>({
  pipeline,
  analysis,
  ready = true,
  children,
}: {
  pipeline: ImagePipeline
  analysis: Analysis<T>
  /** 其他前置條件（例如參數結構已載入） */
  ready?: boolean
  children: (result: Timed<T>, image: ImageRef) => ReactNode
}) {
  const { shown, query, configError, stale } = analysis
  const image = pipeline.image
  const fatal = [pipeline.base.error, pipeline.degraded.error].find(
    (e) => e && !(e instanceof ApiError && e.code === 'INVALID_CONFIG'),
  )
  if (pipeline.noFile) {
    return (
      <EmptyState icon={<ImageIcon className="size-8" aria-hidden />}>
        在左側「影像」選擇要上傳的照片。
      </EmptyState>
    )
  }
  if (!image || !shown || !ready) {
    const err = fatal ?? query.error
    return err ? <ErrorBox error={err} /> : <EmptyState>載入中…</EmptyState>
  }
  const other = fatal ?? (query.error && !configError ? query.error : undefined)
  return (
    <>
      {other && <ErrorBox error={other} className="mb-4" />}
      {configError && (
        <ErrorBox error={configError} className="mb-4" hint="請在左側參數修正標紅的欄位。" />
      )}
      <div className={cn('transition-opacity', stale && 'opacity-60')}>
        {children(shown, image)}
      </div>
    </>
  )
}

export type Tone = 'ok' | 'warn' | 'bad'

/** 結果狀態列：圖示、標題、徽章（警告等）、右側說明。 */
export function StatusCard({
  tone,
  title,
  badges,
  detail,
}: {
  tone: Tone
  title: string
  badges?: ReactNode
  detail: string[]
}) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'warn' ? TriangleAlert : CircleAlert
  const color = tone === 'ok' ? 'text-primary' : tone === 'warn' ? 'text-accent' : 'text-danger'
  return (
    <Card
      className={cn(
        'mb-4 flex flex-wrap items-center gap-3 px-4 py-3',
        tone === 'ok'
          ? 'border-primary/40'
          : tone === 'warn'
            ? 'border-accent/40'
            : 'border-danger/40',
      )}
    >
      <Icon className={cn('size-5', color)} aria-hidden />
      <span className={cn('font-semibold', color)} role="status">
        {title}
      </span>
      {badges}
      <span className="text-muted tabular ml-auto text-xs">{detail.join(' · ')}</span>
    </Card>
  )
}

/** 警告代碼的徽章（中文）。 */
export function WarningBadges({
  codes,
  tone = 'danger',
}: {
  codes: string[]
  tone?: 'danger' | 'accent'
}) {
  return (
    <>
      {codes.map((w) => (
        <Badge key={w} tone={tone}>
          {warningText(w)}
        </Badge>
      ))}
    </>
  )
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">{children}</div>
  )
}

/** 指標卡；good 為 undefined 時說明文字不上色。 */
export function Metric({
  label,
  value,
  delta,
  good,
  help,
}: {
  label: string
  value: string
  delta?: string
  good?: boolean
  help?: string
}) {
  return (
    <Card className="px-4 py-3" title={help}>
      <div className="text-muted text-xs">{label}</div>
      <div className="tabular mt-1 truncate text-2xl font-semibold">{value}</div>
      {delta && (
        <div
          className={cn(
            'tabular mt-1 text-xs',
            good === undefined ? 'text-muted' : good ? 'text-primary' : 'text-danger',
          )}
        >
          {delta}
        </div>
      )}
    </Card>
  )
}

export function ErrorBox({
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

/** 圖例：色塊＋文字。 */
export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <p className="text-muted mt-2 flex flex-wrap gap-4 text-xs">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </p>
  )
}

/** 簡單表格（中文表頭）。 */
export function DataTable({
  label,
  columns,
  rows,
}: {
  label: string
  columns: string[]
  rows: ReactNode[][]
}) {
  return (
    <table className="mt-3 w-full text-sm" aria-label={label}>
      <thead>
        <tr className="text-muted border-card-border border-b text-left text-xs">
          {columns.map((c) => (
            <th key={c} className="py-2 pr-3 font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-card-border border-b last:border-0">
            {r.map((cell, j) => (
              <td key={j} className="tabular py-1.5 pr-3 align-top">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
