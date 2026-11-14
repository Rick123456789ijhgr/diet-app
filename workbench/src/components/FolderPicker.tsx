// 「瀏覽…」按鈕＋資料夾瀏覽彈窗：所有輸入本機資料夾路徑的地方共用。
// 瀏覽器的系統「選擇資料夾」視窗拿不到完整路徑，而批次、找最佳流程、圖片批次命名都由本機的
// Python 讀寫檔案，所以改由後端列出資料夾（GET /dev/folders），在彈窗中逐層點選。
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, ChevronRight, Folder, FolderOpen, HardDrive, Lock } from 'lucide-react'
import { useState } from 'react'

import { api, unwrap } from '@/api/client'
import { ErrorBox } from '@/components/results'
import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { Badge, Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'

/** 後端 devtools.folders.list_folders_json 的回應（FreeJson，結構由 Python 定義）。 */
export interface FolderListing {
  /** 解析後的絕對路徑；起點（磁碟機清單）為空字串 */
  path: string
  /** 上一層；空字串＝回到起點、null＝已在起點 */
  parent: string | null
  folders: { name: string; path: string; images: number | null; locked: boolean }[]
  /** 這個資料夾本身（不含子資料夾）的影像張數 */
  images: number
  truncated: boolean
}

/**
 * 「瀏覽…」按鈕：開啟資料夾瀏覽彈窗，選好後以 onPick 回傳完整路徑。
 * 從 value（目前輸入框的路徑）開始瀏覽；空白或找不到時從起點（磁碟機）開始。
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
  const [path, setPath] = useState('')
  const query = useQuery({
    queryKey: ['folders', path],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/dev/folders', {
          params: { query: path ? { path } : {} },
          signal,
        }),
      ) as Promise<unknown> as Promise<FolderListing>,
    enabled: open,
    retry: false,
  })
  const data = query.data
  // 顯示的位置：載入中沿用請求的路徑；起點顯示「本機」
  const here = data?.path ?? path

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setPath(value.trim())
        setOpen(o)
      }}
      title="選擇資料夾"
      description="執行工作台的這台電腦上的資料夾；點資料夾往下，按「選擇這個資料夾」完成。"
      className="max-w-lg"
      trigger={
        <Button type="button" variant="outline" size={size} className={cn('shrink-0', className)}>
          <FolderOpen className="size-4" aria-hidden />
          {label}
        </Button>
      }
      footer={
        <>
          <span className="text-muted mr-auto text-xs" aria-live="polite">
            {data && data.path ? `這個資料夾有 ${data.images} 張影像` : ''}
          </span>
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="primary"
              disabled={!data?.path || query.isFetching}
              onClick={() => data?.path && onPick(data.path)}
            >
              選擇這個資料夾
            </Button>
          </DialogClose>
        </>
      }
    >
      <div className="flex items-center gap-2 pb-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="上一層"
          title="上一層"
          disabled={query.isError ? !path : data?.parent == null}
          // 讀取失敗（例如輸入框的路徑不存在）時回到起點
          onClick={() => setPath(query.isError ? '' : (data?.parent ?? ''))}
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        {/* 長路徑從左邊截斷（dir="rtl"），保留最後幾層；bdi 讓路徑本身仍由左到右排列 */}
        <span
          dir="rtl"
          className="readout bg-sunken min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left text-xs"
          title={here || '本機'}
          aria-label="目前位置"
        >
          <bdi dir="ltr">{here || '本機'}</bdi>
        </span>
      </div>

      {query.isError ? (
        <ErrorBox error={query.error} />
      ) : !data ? (
        <p className="text-muted py-6 text-center text-xs">讀取中…</p>
      ) : data.folders.length === 0 ? (
        <p className="text-muted py-6 text-center text-xs">沒有子資料夾。</p>
      ) : (
        <ul aria-label="子資料夾" className={cn('space-y-0.5', query.isFetching && 'opacity-60')}>
          {data.folders.map((f) => {
            const Icon = f.locked ? Lock : data.path ? Folder : HardDrive
            return (
              <li key={f.path}>
                <button
                  type="button"
                  disabled={f.locked}
                  onClick={() => setPath(f.path)}
                  title={f.locked ? '測試集已鎖定，工作台不得讀取' : f.path}
                  className="hover:bg-hover focus-visible:ring-primary/40 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Icon className="text-muted size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {f.locked ? (
                    <Badge>已鎖定</Badge>
                  ) : f.images ? (
                    <Badge tone="primary">{f.images} 張</Badge>
                  ) : null}
                  {!f.locked && <ChevronRight className="text-muted size-4" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {data?.truncated && (
        <p className="text-muted mt-2 text-xs">子資料夾太多，只列出前 {data.folders.length} 個。</p>
      )}
    </Dialog>
  )
}
