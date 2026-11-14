// 「瀏覽…」按鈕＋資料夾瀏覽彈窗：所有輸入本機資料夾路徑的地方共用。
// 瀏覽器的系統「選擇資料夾」視窗拿不到完整路徑，而批次、找最佳流程、圖片批次命名都由本機的
// Python 讀寫檔案，所以改由後端列出資料夾（GET /dev/folders），在彈窗中瀏覽。
// 操作仿照 Windows 的「選擇資料夾」視窗：上一頁／下一頁／上一層、可點選或直接輸入的網址列、
// 左側的本機與最近使用、詳細資料清單（按一下選取、按兩下或 Enter 開啟）、底部的「資料夾」欄位。
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  HardDrive,
  Lock,
  Monitor,
  RotateCw,
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { api, unwrap } from '@/api/client'
import { ErrorBox } from '@/components/results'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { folderName, loadRecent, pathSegments, rememberRecent } from '@/lib/folderPath'

/** 後端 devtools.folders.list_folders_json 的回應（FreeJson，結構由 Python 定義）。 */
export interface FolderListing {
  /** 解析後的絕對路徑；起點（磁碟機清單）為空字串 */
  path: string
  /** 上一層；空字串＝回到起點、null＝已在起點 */
  parent: string | null
  folders: FolderEntry[]
  /** 這個資料夾本身（不含子資料夾）的影像張數 */
  images: number
  truncated: boolean
}
type FolderEntry = { name: string; path: string; images: number | null; locked: boolean }

function useFolders(path: string, enabled = true) {
  return useQuery({
    queryKey: ['folders', path],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/dev/folders', {
          params: { query: path ? { path } : {} },
          signal,
        }),
      ) as Promise<unknown> as Promise<FolderListing>,
    enabled,
    retry: false,
  })
}

/**
 * 「瀏覽…」按鈕：開啟資料夾瀏覽彈窗，選好後以 onPick 回傳完整路徑。
 * 從 value（目前輸入框的路徑）開始瀏覽；空白或找不到時從起點（本機）開始。
 */
export function FolderPicker({
  value,
  onPick,
  label = '瀏覽…',
  size = 'sm',
  className,
}: {
  value: string
  onPick: (path: string) => void
  label?: string
  /** 與旁邊的輸入框同高：sm＝h-7、md＝h-9 */
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // 每次打開都從輸入框的路徑重新開始（瀏覽紀錄、選取都重置）
  const [session, setSession] = useState({ start: '', n: 0 })
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setSession((s) => ({ start: value.trim(), n: s.n + 1 }))
        setOpen(o)
      }}
      title="選擇資料夾"
      description="執行工作台的這台電腦上的資料夾。按一下選取、按兩下開啟。"
      className="h-[min(640px,calc(100vh-2rem))] max-w-4xl"
      // 正在網址列輸入時，Esc 只結束輸入（由輸入框處理），不關彈窗
      onEscapeKeyDown={(e) => {
        if (e.target instanceof HTMLElement && e.target.dataset.addressInput) e.preventDefault()
      }}
      trigger={
        <Button type="button" variant="outline" size={size} className={cn('shrink-0', className)}>
          <FolderOpen className="size-4" aria-hidden />
          {label}
        </Button>
      }
    >
      {open && (
        <Browser
          key={session.n}
          start={session.start}
          onCancel={() => setOpen(false)}
          onPick={(p) => {
            rememberRecent(p)
            onPick(p)
            setOpen(false)
          }}
        />
      )}
    </Dialog>
  )
}

/** 彈窗內容。footer 自己畫（要放「資料夾」欄位），所以不用 Dialog 的 footer。 */
function Browser({
  start,
  onCancel,
  onPick,
}: {
  start: string
  onCancel: () => void
  onPick: (path: string) => void
}) {
  // 瀏覽紀錄：上一頁／下一頁在 stack 中移動，前往新位置時捨棄 index 之後的紀錄
  const [nav, setNav] = useState({ stack: [start], index: 0 })
  const path = nav.stack[nav.index]!
  const [selected, setSelected] = useState<string | null>(null)
  const query = useFolders(path)
  const data = query.data
  const recent = useState(loadRecent)[0]

  const go = (to: string) => {
    setNav((n) => ({ stack: [...n.stack.slice(0, n.index + 1), to], index: n.index + 1 }))
    setSelected(null)
  }
  const step = (d: -1 | 1) => {
    setNav((n) => ({ ...n, index: n.index + d }))
    setSelected(null)
  }
  // 讀取失敗（例如輸入框的路徑不存在）時「上一層」回到起點
  const up = query.isError ? (path ? '' : null) : (data?.parent ?? null)

  const folders = data?.folders ?? []
  const chosen = folders.find((f) => f.path === selected) ?? null
  // 「選擇資料夾」選的是：清單中選取的資料夾，沒選取時是目前所在的資料夾（起點不能選）
  const target = chosen ? chosen.path : (data?.path ?? '')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-1">
        <ToolButton label="上一頁" disabled={nav.index === 0} onClick={() => step(-1)}>
          <ArrowLeft className="size-4" />
        </ToolButton>
        <ToolButton
          label="下一頁"
          disabled={nav.index >= nav.stack.length - 1}
          onClick={() => step(1)}
        >
          <ArrowRight className="size-4" />
        </ToolButton>
        <ToolButton label="上一層" disabled={up === null} onClick={() => up !== null && go(up)}>
          <ArrowUp className="size-4" />
        </ToolButton>
        <AddressBar path={data?.path ?? path} onGo={go} />
        <ToolButton label="重新整理" onClick={() => void query.refetch()}>
          <RotateCw className={cn('size-4', query.isFetching && 'animate-spin')} />
        </ToolButton>
      </div>

      <div className="border-card-border flex min-h-0 flex-1 overflow-hidden rounded-xl border">
        <Sidebar current={data?.path ?? path} recent={recent} onGo={go} />
        <div className="flex min-w-0 flex-1 flex-col">
          {query.isError ? (
            <div className="p-4">
              <ErrorBox error={query.error} />
            </div>
          ) : (
            <FolderList
              data={data}
              fetching={query.isFetching}
              selected={selected}
              onSelect={setSelected}
              onOpen={go}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="folder-picker-target" className="text-ink-2 shrink-0 text-[13px]">
          資料夾：
        </label>
        <input
          id="folder-picker-target"
          readOnly
          value={target}
          placeholder="請選一個資料夾"
          title={target}
          className="readout border-card-border bg-sunken min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-[13px]"
        />
        <Button
          variant="primary"
          disabled={!target || query.isFetching}
          onClick={() => onPick(target)}
        >
          選擇資料夾
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
      <p className="text-muted -mt-1 text-xs" aria-live="polite">
        {chosen
          ? chosen.locked
            ? ''
            : `已選取「${chosen.name}」${chosen.images != null ? `，有 ${chosen.images} 張影像` : ''}`
          : data?.path
            ? `${folders.length} 個資料夾；這個資料夾有 ${data.images} 張影像`
            : data
              ? '請選一個磁碟機'
              : ''}
      </p>
    </div>
  )
}

/** 網址列：平常是可點的麵包屑；點空白處、按鉛筆或按 F4 改成輸入框，Enter 前往、Esc 取消。 */
function AddressBar({ path, onGo }: { path: string; onGo: (p: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(path)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])
  const segs = pathSegments(path)

  if (editing) {
    return (
      <input
        ref={input}
        aria-label="路徑"
        data-address-input="true"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            setEditing(false)
            const to = draft.trim()
            if (to !== path) onGo(to)
          } else if (e.key === 'Escape') {
            // 只關掉輸入框；彈窗不關由 Dialog 的 onEscapeKeyDown 負責
            e.preventDefault()
            setEditing(false)
          }
        }}
        className="readout border-primary bg-card focus-visible:ring-primary/40 h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-[13px] focus-visible:ring-2 focus-visible:outline-none"
      />
    )
  }
  return (
    <nav
      aria-label="目前位置"
      onClick={(e) => {
        // 點到麵包屑以外的空白處才進入輸入
        if (e.target === e.currentTarget) {
          setDraft(path)
          setEditing(true)
        }
      }}
      className="border-card-border bg-sunken flex h-8 min-w-0 flex-1 cursor-text items-center overflow-hidden rounded-lg border px-1"
    >
      <ol className="flex min-w-0 items-center">
        {segs.map((s, i) => {
          const last = i === segs.length - 1
          return (
            // 空間不夠時前面幾層先縮，最後一層保留
            <li
              key={s.path}
              className={cn('flex min-w-0 items-center', last ? 'shrink-0' : 'shrink')}
            >
              {i > 0 && <ChevronRight className="text-muted size-3.5 shrink-0" aria-hidden />}
              <button
                type="button"
                aria-current={last ? 'location' : undefined}
                onClick={() => !last && onGo(s.path)}
                className={cn(
                  'hover:bg-hover min-w-0 truncate rounded px-1.5 py-0.5 text-[13px]',
                  last ? 'text-ink font-semibold' : 'text-ink-2',
                )}
              >
                {i === 0 ? (
                  <span className="flex items-center gap-1">
                    <Monitor className="size-3.5" aria-hidden />
                    {s.name}
                  </span>
                ) : (
                  s.name
                )}
              </button>
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        aria-label="輸入路徑"
        title="輸入路徑"
        onClick={() => {
          setDraft(path)
          setEditing(true)
        }}
        className="ml-auto h-full flex-1 cursor-text"
      />
    </nav>
  )
}

/** 左側：本機（磁碟機）與最近使用的資料夾。 */
function Sidebar({
  current,
  recent,
  onGo,
}: {
  current: string
  recent: string[]
  onGo: (p: string) => void
}) {
  const roots = useFolders('')
  return (
    <aside
      aria-label="快速存取"
      className="border-card-border bg-sunken w-48 shrink-0 overflow-y-auto border-r p-2"
    >
      <SideItem icon={Monitor} label="本機" active={current === ''} onClick={() => onGo('')} />
      <ul className="mb-3 pl-3">
        {(roots.data?.folders ?? []).map((d) => (
          <li key={d.path}>
            <SideItem
              icon={HardDrive}
              label={d.name}
              title={d.path}
              active={current === d.path}
              onClick={() => onGo(d.path)}
            />
          </li>
        ))}
      </ul>
      {recent.length > 0 && (
        <>
          <p className="text-muted mb-1 flex items-center gap-1 px-2 text-xs font-semibold">
            <Clock className="size-3.5" aria-hidden />
            最近使用
          </p>
          <ul aria-label="最近使用">
            {recent.map((p) => (
              <li key={p}>
                <SideItem
                  icon={Folder}
                  label={folderName(p) || p}
                  title={p}
                  active={current === p}
                  onClick={() => onGo(p)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}

function SideItem({
  icon: Icon,
  label,
  title,
  active,
  onClick,
}: {
  icon: typeof Folder
  label: string
  title?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-current={active ? 'location' : undefined}
      onClick={onClick}
      className={cn(
        'focus-visible:ring-primary/40 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] focus-visible:ring-2 focus-visible:outline-none',
        active ? 'bg-card text-ink font-semibold' : 'text-ink-2 hover:bg-hover',
      )}
    >
      <Icon className="text-muted size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/**
 * 詳細資料清單：名稱、影像張數。按一下選取、按兩下或 Enter 開啟；↑↓ 移動選取、
 * Home／End 到頭尾、Backspace 回上一層由外層的按鈕負責（這裡不攔截）。
 */
function FolderList({
  data,
  fetching,
  selected,
  onSelect,
  onOpen,
}: {
  data: FolderListing | undefined
  fetching: boolean
  selected: string | null
  onSelect: (p: string | null) => void
  onOpen: (p: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  if (!data) return <Empty>讀取中…</Empty>
  const folders = data.folders
  const idx = folders.findIndex((f) => f.path === selected)

  const onKey = (e: KeyboardEvent) => {
    if (folders.length === 0) return
    const move = (i: number) => {
      const f = folders[Math.max(0, Math.min(folders.length - 1, i))]!
      onSelect(f.path)
      listRef.current
        ?.querySelector(`[data-path="${CSS.escape(f.path)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
    if (e.key === 'ArrowDown') move(idx + 1)
    else if (e.key === 'ArrowUp') move(idx < 0 ? 0 : idx - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(folders.length - 1)
    else if (e.key === 'Enter' && idx >= 0 && !folders[idx]!.locked) onOpen(folders[idx]!.path)
    else return
    e.preventDefault()
  }

  return (
    <>
      <div
        aria-hidden
        className="border-card-border text-muted grid shrink-0 grid-cols-[1fr_6rem] border-b px-3 py-1.5 text-xs"
      >
        <span>名稱</span>
        <span className="text-right">影像</span>
      </div>
      {folders.length === 0 ? (
        <Empty>這個資料夾沒有子資料夾，可以直接選擇它。</Empty>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label="子資料夾"
          tabIndex={0}
          aria-activedescendant={idx >= 0 ? `fp-${idx}` : undefined}
          onKeyDown={onKey}
          // 點清單的空白處取消選取（回到「選目前這個資料夾」）
          onClick={(e) => e.target === e.currentTarget && onSelect(null)}
          className={cn(
            'focus-visible:ring-primary/40 min-h-0 flex-1 overflow-y-auto p-1 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
            fetching && 'opacity-60',
          )}
        >
          {folders.map((f, i) => {
            const on = f.path === selected
            const Icon = f.locked ? Lock : data.path ? Folder : HardDrive
            return (
              <div
                key={f.path}
                id={`fp-${i}`}
                role="option"
                aria-selected={on}
                aria-disabled={f.locked || undefined}
                data-path={f.path}
                title={f.locked ? '測試集已鎖定，工作台不得讀取' : f.path}
                onClick={() => !f.locked && onSelect(f.path)}
                onDoubleClick={() => !f.locked && onOpen(f.path)}
                className={cn(
                  'grid cursor-default grid-cols-[1fr_6rem] items-center rounded-md px-2 py-1.5 text-[13px] select-none',
                  f.locked
                    ? 'text-muted opacity-60'
                    : on
                      ? 'bg-primary-soft text-primary-ink'
                      : 'hover:bg-hover',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className={cn('size-4 shrink-0', on ? '' : 'text-muted')} aria-hidden />
                  <span className="truncate">{f.name}</span>
                  {f.locked && <span className="text-xs">（已鎖定）</span>}
                </span>
                <span className="readout text-right text-xs">
                  {f.locked ? '—' : f.images ? `${f.images} 張` : ''}
                </span>
              </div>
            )
          })}
          {data.truncated && (
            <p className="text-muted px-2 py-2 text-xs">
              子資料夾太多，只列出前 {folders.length} 個；可以在網址列直接輸入路徑。
            </p>
          )}
        </div>
      )}
    </>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted flex-1 px-4 py-8 text-center text-xs">{children}</p>
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-ink-2 hover:bg-hover hover:text-ink focus-visible:ring-primary/40 grid size-8 shrink-0 place-items-center rounded-lg focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
