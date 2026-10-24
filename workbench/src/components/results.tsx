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
  // 「致命」錯誤：原圖或劣化圖本身取得失敗。INVALID_CONFIG（參數不合法）不算，
  // 那類錯誤只需提示使用者修正欄位，結果區仍保留上一次的結果。
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
  // 還沒有任何一組可顯示的結果：有錯誤就顯示錯誤（此時沒有舊結果可淡化），否則顯示載入中
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
  // 已有結果時，錯誤顯示在上方：參數錯誤（configError）另附修正提示，其餘錯誤歸為 other，兩者不重複顯示
  const other = fatal ?? (query.error && !configError ? query.error : undefined)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {(other || configError) && (
        <div className="shrink-0 space-y-2 pb-3">
          {other && <ErrorBox error={other} />}
          {configError && <ErrorBox error={configError} hint="請在左側參數修正標紅的欄位。" />}
        </div>
      )}
      <div
        className={cn(
          'min-h-0 flex-1 transition-opacity',
          // 淡化條件：查詢進行中或出錯（stale），或目前顯示的這組不是最新影像／最新結果（仍在沿用舊配對）
          (stale || pair.image !== image || pair.result !== shown) && 'opacity-60',
        )}
      >
        {children(pair.result, pair.image)}
      </div>
    </div>
  )
}

/** 結果狀態的語氣：通過／警告／失敗，對應綠、琥珀、紅與不同圖示。 */
export type Tone = 'ok' | 'warn' | 'bad'

/**
 * 結果狀態（讀數欄最上方的一張卡）：圖示＋標題，下方為徽章與逐行說明。
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
    <div className="bg-card shadow-card shrink-0 rounded-[20px] p-4">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full',
            tone === 'ok'
              ? 'bg-ok-soft text-ok'
              : tone === 'warn'
                ? 'bg-warn-soft text-warn'
                : 'bg-danger-soft text-danger',
          )}
        >
          <Icon className="size-[18px]" aria-hidden />
        </span>
        {/* role="status"（隱含 aria-live=polite）：結果標題改變時螢幕閱讀器會朗讀，不打斷使用者 */}
        <span className="text-[16px] font-semibold" role="status">
          {title}
        </span>
      </div>
      {badges && <div className="mt-3 flex flex-wrap gap-1">{badges}</div>}
      <ul className="text-muted mt-3 space-y-0.5 text-xs">
        {/* 以文字內容當 key：同一張卡內的說明行預期不重複 */}
        {detail.map((d) => (
          <li key={d} className="tabular break-all">
            {d}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 警告代碼的徽章（中文）。codes 為後端回傳的英文警告代碼（如 `TOO_BLURRY`），
 * 經 warningText 轉成中文顯示；tone 預設紅色，accent 用於較輕微的提示。
 */
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

/** 讀數小卡的排列：讀數欄裡兩欄、主檢視裡依寬度增加欄數。 */
export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    // auto-fill＋minmax(120px,1fr)：每張卡至少 120px，欄數依容器寬度自動決定，不必寫斷點
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">{children}</div>
  )
}

/**
 * 一張讀數小卡：標籤、大數字，下方為與門檻的差距（綠 ✓／紅 ✕ 小膠囊）；
 * good 為 undefined 時差距不上色。
 * value、delta 皆為呼叫端格式化好的字串（數字由後端決定，這裡只負責顯示）；
 * help 以原生 title 顯示說明，長文字被截斷時 delta 也以 title 顯示全文。
 */
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
      className={cn('bg-sunken min-w-0 rounded-2xl px-3 py-2.5', wide && 'col-span-full')}
      title={help}
    >
      <div className="text-muted truncate text-xs">{label}</div>
      <div className="tabular mt-1 truncate text-[20px] leading-snug font-semibold tracking-tight">
        {value}
      </div>
      {delta && (
        <div className="mt-1 flex min-w-0 items-start gap-1.5 text-[11px]" title={delta}>
          {good !== undefined && (
            <span
              className={cn(
                'inline-flex h-4.5 shrink-0 items-center rounded-full px-1.5 font-medium',
                good ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger',
              )}
              // ✓／✕ 只是視覺輔助，對螢幕閱讀器隱藏；判讀依據是旁邊的 delta 文字
              aria-hidden
            >
              {good ? '✓' : '✕'}
            </span>
          )}
          <span className="text-muted tabular leading-[18px]">{delta}</span>
        </div>
      )}
    </div>
  )
}

/**
 * 錯誤框（role="alert"，出現時螢幕閱讀器立即朗讀）。
 * error 為後端的 ApiError 時，標題顯示錯誤代碼的中文與出錯欄位，內文為後端訊息；
 * 其他例外（例如網路錯誤）標題為「發生錯誤」，內文為 String(error)。hint 附在內文後方。
 */
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
    <div role="alert" className={cn('bg-danger-soft rounded-2xl px-4 py-3 text-[13px]', className)}>
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

/** 圖例：色塊＋文字（疊圖用，例如「找到」／「真值」）。label 同時作為 key，須唯一。 */
export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <p className="text-muted mt-2 flex flex-wrap gap-4 text-xs">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </p>
  )
}

/**
 * 簡單表格（中文表頭）。rows 為二維陣列，每格可放任意 ReactNode；
 * 列與格以索引為 key（表格內容為靜態顯示、不重新排序）。label 作為表格的 aria-label。
 */
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
        <tr className="text-muted bg-sunken text-left text-xs">
          {columns.map((c) => (
            <th key={c} className="px-2 py-2 font-medium first:rounded-l-xl last:rounded-r-xl">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-card-border border-b last:border-0">
            {r.map((cell, j) => (
              <td key={j} className="tabular px-2 py-2 align-top">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
