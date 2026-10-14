import type { LucideIcon } from 'lucide-react'

/** 分段按鈕的標籤：圖示＋文字。 */
export function withIcon(Icon: LucideIcon, text: string) {
  return (
    <>
      <Icon className="size-4" aria-hidden />
      {text}
    </>
  )
}
