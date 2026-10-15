// 工具頁結果區的共用元件：分析框架（載入、錯誤、淡化）、狀態、讀數格、錯誤框、圖例、表格。
import { CircleAlert, CircleCheck, ImageIcon, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { ApiError, type ImageRef } from '@/api/client'
import { EmptyState } from '@/components/layout/Workspace'
import { Badge } from '@/components/ui/primitives'
import type { ImagePipeline } from '@/hooks/useImagePipeline'
import type { Analysis, Timed } from '@/hooks/useAnalysis'
import { useLastDefined } from '@/hooks/useLastDefined'
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
  // 影像與結果必須來自同一張圖：換圖後新結果回來前，繼續顯示上一組（淡化），
  // 不把舊結果（例如四角、偵測框）疊到新影像上
  const pair = useLastDefined(
    shown && image && shown.imageId === image.image_id ? { result: shown, image } : undefined,
  )
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
  if (!pair || !ready) {
    const err = fatal ?? query.error
    return err ? (
      <div className="p-4">
        <ErrorBox error={err} />
      </div>
    ) : (
      <EmptyState>載入中…</EmptyState>
    )
  }
  const other = fatal ?? (query.error && !configError ? query.error : undefined)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {(other || configError) && (
        <div className="border-card-border shrink-0 space-y-2 border-b p-3">
          {other && <ErrorBox error={other} />}
          {configError && <ErrorBox error={configError} hint="請在左側參數修正標紅的欄位。" />}
        </div>
      )}
      <div
        className={cn(
          'min-h-0 flex-1 transition-opacity',
          (stale || pair.image !== image || pair.result !== shown) && 'opacity-60',
        )}
      >
        {children(pair.result, pair.image)}
      </div>
    </div>
  )
}

export type Tone = 'ok' | 'warn' | 'bad'

/**
 * 結果狀態（讀數欄最上方）：左側色條＋圖示＋標題，下方為徽章與逐行說明。
 * 狀態一律有圖示與文字，不單靠顏色。
 */
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
  return (
    <div
      className={cn(
        'border-card-border border-b border-l-[3px] px-3 py-3',
        tone === 'ok'
          ? 'border-l-ok-mark bg-ok-soft/60'
          : tone === 'warn'
            ? 'border-l-warn-mark bg-warn-soft/60'
            : 'border-l-danger-mark bg-danger-soft/60',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2',
          tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-danger',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="text-[14px] font-semibold" role="status">
          {title}
        </span>
      </div>
      {badges && <div className="mt-2 flex flex-wrap gap-1">{badges}</div>}
      <ul className="text-ink-2 mt-2 space-y-0.5 text-xs">
        {detail.map((d) => (
          <li key={d} className="tabular break-all">
            {d}
          </li>
        ))}
      </ul>
    </div>
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

/** 讀數格：細線格子排列，讀數欄裡兩欄、主檢視裡依寬度增加欄數。 */
export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="border-card-border grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] border-t border-l">
      {children}
    </div>
  )
}

/** 一格讀數：標籤、等寬數值、與門檻的差距；good 為 undefined 時差距不上色。 */
export function Metric({
  label,
  value,
  delta,
  good,
  help,
  wide,
}: {
  label: string
  value: string
  delta?: string
  good?: boolean
  help?: string
  /** 佔滿整列（條碼內容等較長的值） */
  wide?: boolean
}) {
  return (
    <div
      className={cn(
        'border-card-border bg-card min-w-0 border-r border-b px-3 py-2',
        wide && 'col-span-full',
      )}
      title={help}
    >
      <div className="text-muted flex items-center gap-1.5 truncate text-[11px]">
        {good !== undefined && (
          <span
            className={cn('size-1.5 shrink-0 rounded-full', good ? 'bg-ok-mark' : 'bg-danger-mark')}
            aria-hidden
          />
        )}
        {label}
      </div>
      <div className="readout mt-0.5 truncate text-[19px] leading-snug font-medium">{value}</div>
      {delta && (
        <div
          className={cn(
            'tabular mt-0.5 truncate text-[11px]',
            good === undefined ? 'text-muted' : good ? 'text-ok' : 'text-danger',
          )}
          title={delta}
        >
          {delta}
        </div>
      )}
    </div>
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
        'border-danger/40 bg-danger-soft border-l-danger-mark rounded-[3px] border border-l-[3px] px-3 py-2 text-[13px]',
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
          <span className="inline-block size-2.5 rounded-[2px]" style={{ background: i.color }} />
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
    <table className="mt-3 w-full text-[13px]" aria-label={label}>
      <thead>
        <tr className="text-muted border-line-strong border-b text-left text-[11px]">
          {columns.map((c) => (
            <th key={c} className="py-1.5 pr-3 font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-card-border hover:bg-hover/60 border-b last:border-0">
            {r.map((cell, j) => (
              <td key={j} className="tabular py-1 pr-3 align-top">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
