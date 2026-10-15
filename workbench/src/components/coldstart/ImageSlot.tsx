// 冷啟動上傳的照片槽：選檔上傳／重傳、縮圖、尺寸、品質與警告、條碼解碼結果、前處理錯誤。
// 營養標示照片以 ImageViewer 顯示並疊上表格四角，方便人工對照輸入。
import { CircleAlert, ImageUp } from 'lucide-react'
import { useRef } from 'react'

import { submissionImageUrl, type ImageKind, type SubmissionImage } from '@/api/client'
import { ImageViewer } from '@/components/ImageViewer'
import { FOUND, Quad } from '@/components/overlays'
import { WarningBadges } from '@/components/results'
import { Badge, Button, Card } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { imageKindText } from '@/lib/text'

import { ColdstartError, formatTime } from './common'

export function ImageSlot({
  submissionId,
  kind,
  image,
  editable,
  uploading,
  error,
  missing,
  onFile,
}: {
  submissionId: string
  kind: ImageKind
  image?: SubmissionImage
  editable: boolean
  uploading: boolean
  error?: unknown
  /** 確認時後端回報缺少這張照片 */
  missing: boolean
  onFile: (file: File) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const name = imageKindText(kind)
  const pre = image?.preprocess
  const quad = pre?.label_quad ?? []
  const src = image ? submissionImageUrl(submissionId, kind, image.uploaded_at) : ''
  return (
    <Card
      role="region"
      aria-label={`${name}照片`}
      className={cn('p-3', missing && 'bg-danger-soft')}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('text-sm font-semibold', missing && 'text-danger')}>{name}</span>
        {missing && <Badge tone="danger">缺少照片</Badge>}
        {pre?.quality_passed === true && <Badge tone="primary">品質通過</Badge>}
        {pre?.quality_passed === false && <Badge tone="danger">品質未通過</Badge>}
        <span className="flex-1" />
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png"
          aria-label={`上傳${name}照片`}
          className="sr-only"
          disabled={!editable || uploading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = '' // 同一個檔案可以再選一次
          }}
        />
        {editable && (
          <Button size="sm" onClick={() => input.current?.click()} disabled={uploading}>
            <ImageUp className="size-3.5" aria-hidden />
            {uploading ? '上傳中…' : image ? '重新上傳' : '選擇照片'}
          </Button>
        )}
      </div>

      {image ? (
        <>
          {kind === 'label' ? (
            <ImageViewer
              src={src}
              width={image.width}
              height={image.height}
              alt={`${name}照片`}
              overlay={
                quad.length > 0
                  ? (px) => <Quad points={quad} color={FOUND} label="表格框" px={px} />
                  : undefined
              }
            />
          ) : (
            <div className="bg-sunken flex justify-center rounded-2xl">
              <img
                src={src}
                alt={`${name}照片`}
                className="max-h-48 object-contain"
                width={image.width}
                height={image.height}
                style={{ width: 'auto', height: 'auto' }}
              />
            </div>
          )}
          <div className="text-muted tabular mt-2 text-xs">
            {image.width}×{image.height} px・上傳於 {formatTime(image.uploaded_at)}
          </div>
          {pre && pre.warnings.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <WarningBadges codes={pre.warnings} />
            </div>
          )}
          {kind === 'barcode' && pre && !pre.error && (
            <div className="mt-2 text-sm">
              <span className="text-muted text-xs">解碼結果：</span>
              {pre.barcodes?.length ? (
                pre.barcodes.map((b) => (
                  <span key={`${b.format}-${b.text}`} className="tabular mr-2">
                    {b.text}
                    <span className="text-muted ml-1 text-xs">（{b.format}）</span>
                  </span>
                ))
              ) : (
                <span className="text-muted text-xs">沒有解出條碼，請人工輸入。</span>
              )}
            </div>
          )}
          {kind === 'label' && pre && !pre.error && quad.length === 0 && (
            <p className="text-muted mt-1 text-xs">沒有找到表格框，請直接對照原圖輸入。</p>
          )}
          {pre?.error && (
            <p className="text-danger mt-2 flex items-start gap-1 text-xs" role="alert">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              前處理失敗（照片已保存）：{pre.error}
            </p>
          )}
        </>
      ) : (
        <p className="text-muted py-6 text-center text-sm">尚未上傳。</p>
      )}
      {error !== undefined && <ColdstartError error={error} className="mt-2" />}
    </Card>
  )
}
