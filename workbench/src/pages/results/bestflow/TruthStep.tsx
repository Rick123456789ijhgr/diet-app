// 找最佳流程・步驟 2「確認真值」：一次一張，看著大圖輸入或確認條碼號碼，Enter 確認並換下一張。
// 預先帶入的號碼依序取自：已確認的答案 → 檔名，一律要人按下確認才算數；沒確認的圖片送出時交給程式推定。
// 程式從原圖讀到的號碼（單張檢視同一套條碼解碼）只列為可點選的候選，不預先帶入：
// 被評測的解碼器不能同時提供答案，否則檢查碼剛好正確的誤讀按一下 Enter 就成了真值。
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  CornerDownLeft,
  Sparkles,
  Tag,
  TriangleAlert,
  Wand2,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { api, artifactUrl, unwrap, type ImageRef } from '@/api/client'
import { ImageViewer } from '@/components/ImageViewer'
import { EmptyState } from '@/components/layout/Workspace'
import { Button } from '@/components/ui/primitives'
import { checkCode, type Answer } from '@/lib/barcodeTruth'
import { cn } from '@/lib/cn'

import type { Item } from './items'

/** 讀條碼建議：先上傳（快取），再以單張檢視的預設條碼設定解碼。 */
function suggestion(item: Item, upload: (item: Item) => Promise<ImageRef>) {
  return queryOptions({
    queryKey: ['best-flow-suggest', item.key],
    queryFn: async ({ signal }) => {
      const ref = await upload(item)
      const r = await unwrap(
        api.POST('/workbench/v1/dev/barcode', { body: { image_id: ref.image_id }, signal }),
      )
      return { ref, codes: [...new Set(r.hits.map((h) => h.text))] }
    },
    staleTime: Infinity,
    retry: false,
  })
}

/** 答案的文字（膠捲與目前狀態共用）。 */
export function answerText(a: Answer | null): string {
  if (!a) return '還沒確認'
  if (a.kind === 'code') return a.code
  if (a.kind === 'none') return '沒有條碼'
  return '交給程式推定'
}

export function TruthStep({
  items,
  cursor,
  setCursor,
  onAnswer,
  upload,
}: {
  items: Item[]
  cursor: number
  setCursor: (i: number) => void
  onAnswer: (answers: Record<string, Answer | null>) => void
  upload: (item: Item) => Promise<ImageRef>
}) {
  const qc = useQueryClient()
  const item = items[cursor]
  const next = items[cursor + 1]
  // 先替下一張讀條碼，按下確認後建議已經在畫面上
  useEffect(() => {
    if (next) void qc.prefetchQuery(suggestion(next, upload))
  }, [next, qc, upload])

  if (!item) return <EmptyState>沒有圖片：回上一步選擇圖片。</EmptyState>

  const pendingFromName = items.filter((i) => !i.answer && i.nameAnswer)
  const go = (i: number) => setCursor(Math.max(0, Math.min(items.length - 1, i)))
  const answerAndNext = (a: Answer) => {
    onAnswer({ [item.key]: a })
    // 下一張還沒確認的；全部都確認過就停在原地
    const after = items.findIndex((it, i) => i > cursor && !it.answer)
    if (after >= 0) go(after)
    else if (cursor < items.length - 1) go(cursor + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 gap-4 px-4 pt-4">
        <Viewer item={item} upload={upload} />
        <Desk
          key={item.key}
          item={item}
          index={cursor}
          total={items.length}
          upload={upload}
          onAnswer={answerAndNext}
          onUndo={() => onAnswer({ [item.key]: null })}
          onPrev={cursor > 0 ? () => go(cursor - 1) : undefined}
          onNext={cursor < items.length - 1 ? () => go(cursor + 1) : undefined}
        />
      </div>
      <div className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-3">
        <Filmstrip items={items} cursor={cursor} onSelect={go} />
        {pendingFromName.length > 0 && (
          <Button
            size="sm"
            className="shrink-0"
            onClick={() =>
              onAnswer(Object.fromEntries(pendingFromName.map((i) => [i.key, i.nameAnswer])))
            }
          >
            <Tag className="size-3.5" aria-hidden />
            採用檔名中的號碼（{pendingFromName.length} 張）
          </Button>
        )}
      </div>
    </div>
  )
}

/** 讀出影像原始尺寸（ImageViewer 需要）；換網址時重新讀。 */
function useNaturalSize(url: string) {
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null)
  useEffect(() => {
    if (!url) return
    const img = new Image()
    img.onload = () => setSize({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.src = url
    return () => {
      img.onload = null
    }
  }, [url])
  return size?.url === url ? size : null
}

/** 大圖：優先用本機預覽（立即顯示）；不支援時用上傳後的暫存影像。可縮放查看條碼下的數字。 */
function Viewer({ item, upload }: { item: Item; upload: (item: Item) => Promise<ImageRef> }) {
  const local = useNaturalSize(item.url)
  const s = useQuery(suggestion(item, upload))
  const ref = s.data?.ref
  const view = local
    ? { src: item.url, width: local.width, height: local.height }
    : ref
      ? { src: artifactUrl(ref.image_id), width: ref.width, height: ref.height }
      : null
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {view ? (
        <ImageViewer
          fill
          src={view.src}
          width={view.width}
          height={view.height}
          alt={item.file.name}
        />
      ) : (
        <div className="viewport-grid flex flex-1 items-center justify-center rounded-2xl">
          <span className="text-muted text-xs">載入影像…</span>
        </div>
      )}
    </div>
  )
}

/** 右側的確認區：號碼輸入（Enter 確認並換下一張）、沒有條碼、交給程式推定。 */
function Desk({
  item,
  index,
  total,
  upload,
  onAnswer,
  onUndo,
  onPrev,
  onNext,
}: {
  item: Item
  index: number
  total: number
  upload: (item: Item) => Promise<ImageRef>
  onAnswer: (a: Answer) => void
  onUndo: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const s = useQuery(suggestion(item, upload))
  const read = s.data?.codes ?? []
  const a = item.answer
  // 預先帶入的號碼與來源；使用者動過輸入框（draft 不為 null）後就以輸入為準。
  // 程式讀到的號碼不在這裡：只能由人點選候選填入（見檔頭說明）
  const prefill: { code: string; from: string } | null =
    a?.kind === 'code'
      ? { code: a.code, from: '已確認' }
      : item.nameAnswer?.kind === 'code'
        ? { code: item.nameAnswer.code, from: '來自檔名' }
        : null
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? prefill?.code ?? ''
  const check = checkCode(value)
  const touched = draft !== null && draft !== ''
  // 輸入框裡是點選候選填入的號碼（還沒改過）：提醒對照圖片
  const fromRead = draft !== null && read.includes(draft)

  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])

  return (
    <aside
      aria-label="確認這張圖"
      className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto pb-1"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="readout text-[13px] font-semibold">
            第 {index + 1} 張<span className="text-muted font-normal">，共 {total} 張</span>
          </p>
          <p className="readout text-muted truncate text-xs leading-5" title={item.file.name}>
            {item.file.name}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconButton label="上一張" onClick={onPrev}>
            <ChevronLeft className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="下一張" onClick={onNext}>
            <ChevronRight className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (check.ok) onAnswer({ kind: 'code', code: check.code })
        }}
      >
        <label htmlFor={`code-${item.key}`} className="block text-[13px] font-semibold">
          條碼號碼
        </label>
        <input
          ref={input}
          id={`code-${item.key}`}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder="看圖輸入條碼下方的數字"
          aria-describedby={`code-${item.key}-msg`}
          aria-invalid={value !== '' && !check.ok}
          className={cn(
            'readout bg-sunken focus-visible:bg-card h-12 w-full rounded-2xl border-2 px-4 text-[20px] tracking-[0.06em] focus-visible:outline-none',
            value !== '' && !check.ok
              ? 'border-danger/60'
              : 'border-card-border focus-visible:border-primary',
          )}
        />
        <p
          id={`code-${item.key}-msg`}
          className={cn(
            'flex items-center gap-1.5 text-xs',
            value === '' ? 'text-muted' : check.ok ? 'text-ok' : 'text-danger',
          )}
        >
          {value === '' ? null : check.ok ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <TriangleAlert className="size-3.5" aria-hidden />
          )}
          {check.message}
          {!touched && prefill && value === prefill.code && (
            <span className="text-muted">（{prefill.from}）</span>
          )}
          {fromRead && <span className="text-muted">（程式讀到的，請對照圖片）</span>}
        </p>
        <Button type="submit" variant="primary" className="h-11 w-full" disabled={!check.ok}>
          確認，下一張
          <CornerDownLeft className="size-3.5 opacity-70" aria-label="Enter" />
        </Button>
      </form>

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => onAnswer({ kind: 'none' })}>
          <CircleSlash className="size-4" aria-hidden />
          沒有條碼
        </Button>
        <Button
          onClick={() => onAnswer({ kind: 'skip' })}
          title="看不清楚時，交給多數方法的共識決定"
        >
          <Wand2 className="size-4" aria-hidden />
          看不清楚
        </Button>
      </div>

      <dl className="border-card-border space-y-2 border-t pt-3 text-xs">
        <div className="flex items-start gap-2">
          <dt className="text-muted flex w-20 shrink-0 items-center gap-1">
            <Sparkles className="size-3.5" aria-hidden />
            程式讀到
          </dt>
          <dd className="readout min-w-0 flex-1">
            {s.isPending ? (
              <span className="text-muted">讀取中…</span>
            ) : s.error ? (
              <span className="text-danger">讀取失敗</span>
            ) : read.length === 0 ? (
              <span className="text-muted">原圖讀不到條碼</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {read.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setDraft(c)
                      // 焦點回到輸入框：對照圖片後按 Enter 確認
                      input.current?.focus()
                    }}
                    title="填入這個號碼（請對照圖片再確認）"
                    className="bg-sunken hover:bg-hover focus-visible:ring-primary/40 rounded-md px-1.5 py-0.5 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {c}
                  </button>
                ))}
              </span>
            )}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="text-muted flex w-20 shrink-0 items-center gap-1">
            {a ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <CircleDashed className="size-3.5" aria-hidden />
            )}
            目前答案
          </dt>
          <dd className="min-w-0 flex-1">
            <span className={cn(a ? 'font-medium' : 'text-muted', a?.kind === 'code' && 'readout')}>
              {answerText(a)}
            </span>
            {a && (
              <button
                type="button"
                onClick={onUndo}
                className="text-muted hover:text-ink ml-2 underline underline-offset-2"
              >
                清除
              </button>
            )}
          </dd>
        </div>
      </dl>

      <p className="text-muted mt-auto text-xs leading-relaxed">
        要把原始照片改名成條碼號碼，比較完後在結論按「把原始照片改名」，用 Python
        工具改。檔名就是號碼的照片，下次放進來會自動帶入。
      </p>
    </aside>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={!onClick}
      onClick={onClick}
      className="bg-sunken hover:bg-hover focus-visible:ring-primary/40 grid size-8 place-items-center rounded-full focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** 底部膠捲：每張圖的縮圖與狀態，點一下跳過去。 */
function Filmstrip({
  items,
  cursor,
  onSelect,
}: {
  items: Item[]
  cursor: number
  onSelect: (i: number) => void
}) {
  const current = useRef<HTMLButtonElement>(null)
  // 新版瀏覽器的 scrollIntoView 會回傳 Promise，不能直接當成 effect 的回傳值
  useEffect(() => {
    void current.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [cursor])
  return (
    <ol aria-label="所有圖片" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1">
      {items.map((it, i) => {
        const a = it.answer
        return (
          <li key={it.key} className="shrink-0">
            <button
              ref={i === cursor ? current : undefined}
              type="button"
              onClick={() => onSelect(i)}
              aria-current={i === cursor ? 'true' : undefined}
              aria-label={`第 ${i + 1} 張 ${it.file.name}：${answerText(a)}`}
              className={cn(
                'bg-sunken relative block size-12 overflow-hidden rounded-xl outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--primary)]',
                i === cursor && 'ring-ink ring-2',
              )}
            >
              {it.url && <img src={it.url} alt="" className="size-full object-cover" />}
              <span
                aria-hidden
                className={cn(
                  'absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-full text-[10px]',
                  !a && 'bg-card/90 text-muted',
                  a?.kind === 'code' && 'bg-ok-mark text-white',
                  a?.kind === 'none' && 'bg-ink text-on-ink',
                  a?.kind === 'skip' && 'bg-warn-mark text-white',
                )}
              >
                {!a ? (
                  '·'
                ) : a.kind === 'code' ? (
                  <Check className="size-3" />
                ) : a.kind === 'none' ? (
                  '–'
                ) : (
                  '?'
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
