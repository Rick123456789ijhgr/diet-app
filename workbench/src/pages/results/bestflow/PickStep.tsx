// 找最佳流程・步驟 1「選擇圖片」：上傳（拖放或選檔）或填資料夾路徑。
// 上傳的圖片在下一步逐張確認真值；資料夾的圖片在瀏覽器看不到，執行後再確認。
import { FileImage, FolderOpen, ImagePlus, Tag, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { Dialog } from '@/components/ui/Dialog'
import { Button, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { cn } from '@/lib/cn'

import type { Item } from './items'

/** 一次最多上傳幾張（後端上限為 500；暫存區有容量上限，大量圖片請改用資料夾）。 */
export const MAX_UPLOADS = 200

export type Source = 'upload' | 'folder'

export function PickStep({
  source,
  setSource,
  items,
  onAdd,
  onRemove,
  onClear,
  folder,
  setFolder,
  recursive,
  setRecursive,
}: {
  source: Source
  setSource: (s: Source) => void
  items: Item[]
  onAdd: (files: File[]) => void
  onRemove: (key: string) => void
  onClear: () => void
  folder: string
  setFolder: (v: string) => void
  recursive: boolean
  setRecursive: (v: boolean) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
      <Segmented
        label="圖片來源"
        value={source}
        onChange={setSource}
        options={[
          { value: 'upload', label: withIcon(Upload, '從電腦上傳') },
          { value: 'folder', label: withIcon(FolderOpen, '伺服器上的資料夾') },
        ]}
        className="self-start"
      />
      {source === 'upload' ? (
        <UploadArea items={items} onAdd={onAdd} onRemove={onRemove} onClear={onClear} />
      ) : (
        <FolderArea
          folder={folder}
          setFolder={setFolder}
          recursive={recursive}
          setRecursive={setRecursive}
        />
      )}
    </div>
  )
}

function UploadArea({
  items,
  onAdd,
  onRemove,
  onClear,
}: {
  items: Item[]
  onAdd: (files: File[]) => void
  onRemove: (key: string) => void
  onClear: () => void
}) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const room = MAX_UPLOADS - items.length
  const empty = items.length === 0
  const fromName = items.filter((i) => i.nameAnswer).length
  // 已確認的答案掛在圖片上，移除圖片就一起消失：有答案時先問過
  const answered = items.filter((i) => i.answer).length
  const [confirmClear, setConfirmClear] = useState(false)

  const add = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || !f.type)
    if (files.length) onAdd(files.slice(0, Math.max(room, 0)))
  }

  return (
    <>
      {/* 拖放區；沒有圖片時佔滿畫面，有圖片後縮成一列 */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          add(e.dataTransfer.files)
        }}
        className={cn(
          'flex items-center rounded-[20px] border-2 border-dashed transition-colors',
          empty
            ? 'min-h-72 flex-1 flex-col justify-center gap-3 p-8 text-center'
            : 'gap-3 px-4 py-3',
          over ? 'border-primary bg-primary-soft' : 'border-line-strong bg-sunken',
        )}
      >
        <ImagePlus
          className={cn('text-muted shrink-0', empty ? 'size-10' : 'size-5')}
          aria-hidden
        />
        <div className={cn('min-w-0', empty ? '' : 'flex-1')}>
          <p className={cn('font-semibold', empty ? 'text-[16px]' : 'text-[13px]')}>
            {empty ? '把條碼照片拖到這裡' : `還可以再加 ${room} 張`}
          </p>
          <p className="text-muted mt-0.5 text-xs">
            可多選，最多 {MAX_UPLOADS} 張。不要放測試集的圖片（規則 7）。
          </p>
        </div>
        {/* 原生檔案欄位的按鈕文字隨瀏覽器語系（例如 Choose Files），改以中文按鈕觸發 */}
        <input
          ref={input}
          aria-label="選擇圖片"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            add(e.target.files)
            e.target.value = '' // 同一批檔案可再選一次
          }}
          className="sr-only"
        />
        <Button
          variant={empty ? 'primary' : 'outline'}
          disabled={room <= 0}
          onClick={() => input.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          {empty ? '選擇圖片' : '再加圖片'}
        </Button>
      </div>

      {!empty && (
        <section aria-label="已選的圖片" className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-[14px] font-semibold">已選 {items.length} 張</h2>
            {fromName > 0 && (
              <span className="text-muted flex items-center gap-1 text-xs">
                <Tag className="size-3.5" aria-hidden />
                其中 {fromName} 張的檔名就是條碼號碼，下一步會自動帶入
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => (answered > 0 ? setConfirmClear(true) : onClear())}
            >
              全部移除
            </Button>
            <Dialog
              open={confirmClear}
              onOpenChange={setConfirmClear}
              title="全部移除？"
              description={`已確認的 ${answered} 張真值會一起清掉，無法復原。`}
              footer={
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setConfirmClear(false)
                      onClear()
                    }}
                  >
                    確定全部移除
                  </Button>
                </>
              }
            >
              <p className="text-ink-2 text-[13px] leading-relaxed">
                只想換掉其中幾張的話，把游標移到圖片上，按右上角的 ✕ 個別移除。
              </p>
            </Dialog>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
            {items.map((it) => (
              <li key={it.key} className="group relative">
                <div className="bg-sunken flex aspect-square items-center justify-center overflow-hidden rounded-2xl">
                  {it.url ? (
                    <img src={it.url} alt="" className="size-full object-cover" />
                  ) : (
                    <FileImage className="text-muted size-6" aria-hidden />
                  )}
                </div>
                <p className="readout mt-1 truncate text-[11px]" title={it.file.name}>
                  {it.file.name}
                </p>
                <button
                  type="button"
                  aria-label={`移除 ${it.file.name}`}
                  onClick={() => onRemove(it.key)}
                  className="bg-card/90 text-ink-2 hover:text-ink focus-visible:ring-primary/40 absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function FolderArea({
  folder,
  setFolder,
  recursive,
  setRecursive,
}: {
  folder: string
  setFolder: (v: string) => void
  recursive: boolean
  setRecursive: (v: boolean) => void
}) {
  return (
    <div className="bg-sunken max-w-xl space-y-3 rounded-[20px] p-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold">資料夾路徑（執行工作台的這台電腦）</span>
        <input
          aria-label="圖片資料夾"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="D:\photos\barcodes"
          className="border-card-border bg-card focus-visible:border-primary readout h-9 rounded-xl border px-3 text-[13px] focus-visible:outline-none"
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={recursive}
          onChange={(e) => setRecursive(e.target.checked)}
          className="accent-primary"
        />
        包含子資料夾
      </label>
      <p className="text-muted text-xs leading-relaxed">
        資料夾的圖片不經過瀏覽器，所以沒有「逐張確認真值」這一步：直接比較各方法，
        執行完再到結論的「真值」分頁確認程式推定不了的圖片。splits/test 會被拒絕（測試集已鎖定）。
      </p>
    </div>
  )
}
