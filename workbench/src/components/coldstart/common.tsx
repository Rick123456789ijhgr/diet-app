// 冷啟動上傳共用的小元件：錯誤框（含資料庫未設定的說明）、文字欄位、狀態徽章、時間。
import type { ComponentProps, ReactNode } from 'react'

import { ApiError, type SubmissionStatus } from '@/api/client'
import { ErrorBox } from '@/components/results'
import { Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { errorText, statusText } from '@/lib/text'

/** 資料庫未設定時的一行重點；詳細步驟收在可展開的段落（DB_STEPS）。 */
export const DB_HINT = '冷啟動上傳需要 Postgres 與 MinIO，請先啟動資料庫。'

const DB_STEPS = [
  '安裝並開啟 Docker Desktop。',
  '在專案根目錄執行 make up（或只啟動資料庫：make db-up）。',
  '設定 DATABASE_URL 等環境變數後重新啟動 Go。',
]

/** 錯誤框；DB_UNAVAILABLE 時改成「標題＋一行重點」，啟動步驟收進可展開的段落。 */
export function ColdstartError({ error, className }: { error: unknown; className?: string }) {
  const db = error instanceof ApiError && error.code === 'DB_UNAVAILABLE'
  if (!db) return <ErrorBox error={error} className={className} />
  return (
    <div
      role="alert"
      className={cn('bg-danger-soft rounded-lg px-4 py-3 text-sm leading-relaxed', className)}
    >
      <div className="text-danger font-semibold">{errorText(error.code)}</div>
      <p className="mt-0.5">{DB_HINT}</p>
      <details className="mt-1.5">
        <summary className="text-muted hover:text-ink cursor-pointer text-xs select-none">
          啟動步驟
        </summary>
        <ol className="text-muted mt-1.5 list-decimal space-y-0.5 pl-5 text-xs">
          {DB_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
          <li>詳見 workbench/README.md 的「冷啟動上傳」。</li>
        </ol>
        {error.message && (
          <p className="text-muted mt-1.5 text-xs break-all">伺服器訊息：{error.message}</p>
        )}
      </details>
    </div>
  )
}

export const inputClass =
  'border-card-border bg-card focus-visible:border-primary h-8 w-full rounded-full border px-3 text-sm focus-visible:outline-none ' +
  'read-only:bg-hover disabled:bg-hover aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft'

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input type="text" className={cn(inputClass, className)} {...props} />
}

/** 欄位：標籤在上、輸入在下；invalid 時標紅並顯示說明。 */
export function Field({
  label,
  error,
  children,
  className,
}: {
  label: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="flex flex-col gap-1">
        <span className={cn('text-xs', error ? 'text-danger font-medium' : 'text-muted')}>
          {label}
        </span>
        {children}
      </label>
      {error && <span className="text-danger text-xs">{error}</span>}
    </div>
  )
}

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <Badge tone={status === 'rejected' ? 'danger' : status === 'confirmed' ? 'primary' : 'muted'}>
      {statusText(status)}
    </Badge>
  )
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-TW', { hour12: false })
}
