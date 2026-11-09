// 步驟列：有先後順序的流程（例如找最佳流程：選圖 → 確認真值 → 比較 → 結論），一次只顯示一個步驟的畫面。
// 編號只用在真正有順序的流程；已完成的步驟顯示勾號，可點回去；還不能去的步驟停用。
import { Check } from 'lucide-react'
import { Fragment } from 'react'

import { cn } from '@/lib/cn'

export interface StepDef<T extends string> {
  id: T
  title: string
}

/**
 * 水平步驟列。
 * - done：已完成的步驟（顯示勾號）；current：目前的步驟（aria-current="step"）。
 * - canGo：可以點過去的步驟（通常是已完成的步驟）；不能去的步驟以停用的按鈕呈現。
 */
export function Stepper<T extends string>({
  steps,
  current,
  done,
  canGo,
  onSelect,
  className,
}: {
  steps: readonly StepDef<T>[]
  current: T
  done: (id: T) => boolean
  canGo: (id: T) => boolean
  onSelect: (id: T) => void
  className?: string
}) {
  return (
    <ol aria-label="步驟" className={cn('flex min-w-0 items-center gap-2', className)}>
      {steps.map((s, i) => {
        const isCurrent = s.id === current
        const isDone = done(s.id) && !isCurrent
        return (
          <Fragment key={s.id}>
            {i > 0 && (
              <li
                aria-hidden
                className={cn(
                  'h-px min-w-3 flex-1 max-w-16',
                  done(steps[i - 1]!.id) ? 'bg-primary/50' : 'bg-card-border',
                )}
              />
            )}
            <li className="shrink-0">
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                disabled={isCurrent || !canGo(s.id)}
                onClick={() => onSelect(s.id)}
                className={cn(
                  'group flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-[13px] transition-colors',
                  'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none',
                  isCurrent ? 'bg-ink text-on-ink font-semibold' : 'text-ink-2',
                  !isCurrent && canGo(s.id) && 'hover:bg-hover hover:text-ink',
                  !isCurrent && !canGo(s.id) && 'text-muted',
                )}
              >
                <span
                  className={cn(
                    'readout grid size-6 place-items-center rounded-full text-xs font-semibold',
                    isCurrent && 'bg-card text-ink',
                    isDone && 'bg-primary-soft text-primary-ink',
                    !isCurrent && !isDone && 'bg-sunken',
                  )}
                >
                  {isDone ? <Check className="size-3.5" aria-label="已完成" /> : i + 1}
                </span>
                {s.title}
              </button>
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
