import type { LucideIcon } from 'lucide-react'

/**
 * 分段按鈕的標籤：圖示＋文字。圖示設 aria-hidden，按鈕的可讀名稱只來自文字。
 * 回傳 Fragment，可直接放進 Segmented 的 options[].label。
 */
export function withIcon(Icon: LucideIcon, text: string) {
  return (
    <>
      <Icon className="size-4" aria-hidden />
      {text}
    </>
  )
}
