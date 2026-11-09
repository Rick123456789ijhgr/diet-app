// 彈窗：次要的設定與資訊（準則、匯出、過去的執行）放這裡，不佔用主畫面。
// 以 Radix Dialog 為底：焦點鎖在彈窗內、Esc 與點背景關閉、關閉後焦點回到開啟它的按鈕。
import { X } from 'lucide-react'
import { Dialog as RDialog } from 'radix-ui'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * 置中的彈窗。trigger 為開啟它的按鈕（自動接上 aria 屬性）；open／onOpenChange 可選，給需要從程式開關的地方用。
 * - title 必填（螢幕閱讀器朗讀）；description 為標題下的一行說明。
 * - footer 固定在底部（例如「套用」）；內容過長時只有內容區捲動。
 */
export function Dialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        {/* 背景同時是置中容器：彈窗比視窗高時整個背景捲動（Radix 的 scrollable overlay 寫法） */}
        <RDialog.Overlay className="wb-overlay fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/35 p-4">
          <RDialog.Content
            className={cn(
              'wb-dialog bg-card text-ink flex max-h-[min(720px,calc(100vh-2rem))] w-full max-w-md flex-col rounded-[20px] shadow-xl focus:outline-none',
              className,
            )}
            // 沒有說明時不要讓 Radix 警告找不到 aria-describedby
            {...(description ? {} : { 'aria-describedby': undefined })}
          >
            <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-3">
              <div className="min-w-0 flex-1">
                <RDialog.Title className="text-[16px] font-semibold">{title}</RDialog.Title>
                {description && (
                  <RDialog.Description className="text-muted mt-0.5 text-xs">
                    {description}
                  </RDialog.Description>
                )}
              </div>
              <RDialog.Close
                aria-label="關閉"
                className="text-muted hover:bg-hover hover:text-ink focus-visible:ring-primary/40 -mt-1 -mr-1 grid size-8 place-items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-4" aria-hidden />
              </RDialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            {footer && (
              <div className="border-card-border flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
                {footer}
              </div>
            )}
          </RDialog.Content>
        </RDialog.Overlay>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/** 彈窗內關閉彈窗的按鈕（包住任何按鈕，例如「完成」）。 */
export const DialogClose = RDialog.Close
