// 冷啟動上傳共用的小元件：錯誤框（含資料庫未設定的說明）、文字欄位、狀態徽章、時間。
import type { ComponentProps, ReactNode } from 'react'

import { ApiError, type SubmissionStatus } from '@/api/client'
import { ErrorBox } from '@/components/results'
import { Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { statusText } from '@/lib/text'

export const DB_HINT =
  '冷啟動上傳需要 Postgres 與 MinIO：請先安裝並開啟 Docker Desktop、在專案根目錄執行 make up，' +
  '設定 DATABASE_URL 等環境變數後重新啟動 Go；詳見 workbench/README.md 的「冷啟動上傳」。'

/** 錯誤框；DB_UNAVAILABLE 時附上本機啟動資料庫的說明。 */
export function ColdstartError({ error, className }: { error: unknown; className?: string }) {
  const db = error instanceof ApiError && error.code === 'DB_UNAVAILABLE'
  return <ErrorBox error={error} hint={db ? DB_HINT : undefined} className={className} />
}

export const inputClass =
  'border-card-border bg-card focus-visible:border-primary h-8 w-full rounded-md border px-2 text-sm focus-visible:outline-none ' +
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
