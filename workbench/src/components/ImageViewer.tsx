// 可縮放、拖曳、查座標的影像檢視器；幾何結果以 SVG 疊在影像座標上（overlay）。
// 換圖但尺寸相同時保留目前的縮放與位置，方便調參數時對照同一區域。
import { Maximize, Scan } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { fitView, toImage, zoomAt, type View } from '@/lib/viewport'

export function ImageViewer({
  src,
  width,
  height,
  alt,
  overlay,
  className,
  onError,
}: {
  src: string
  width: number
  height: number
  alt: string
  /**
   * 以影像像素為座標的 SVG 內容（viewBox 為 0 0 width height）。
   * 傳函式時會收到 px（一個螢幕像素等於幾個影像像素），用來讓標記維持固定的螢幕大小。
   */
  overlay?: ReactNode | ((px: number) => ReactNode)
  className?: string
  /** 影像載入失敗（例如暫存影像已被淘汰），通常用來重新取得影像 */
  onError?: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [touched, setTouched] = useState(false) // 使用者縮放或拖曳過就不再自動置中
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ px: number; py: number; view: View } | null>(null)

  const fit = useCallback(() => {
    const box = boxRef.current
    if (!box) return
    setView(fitView(box.clientWidth, box.clientHeight, width, height))
    setTouched(false)
  }, [width, height])

  // 影像尺寸改變時重新置中
  useLayoutEffect(fit, [fit])

  // 容器大小改變時，若使用者沒動過就重新置中
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!touched) setView(fitView(box.clientWidth, box.clientHeight, width, height))
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [touched, width, height])

  // wheel 需要 passive: false 才能阻止頁面捲動
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = box.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * 0.0015)
      setView((v) => zoomAt(v, e.clientX - rect.left, e.clientY - rect.top, factor))
      setTouched(true)
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [])

  const local = (e: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  const actual = () => {
    const box = boxRef.current
    if (!box) return
    setView(zoomAt(view, box.clientWidth / 2, box.clientHeight / 2, 1 / view.scale))
    setTouched(true)
  }

  const inside =
    cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x < width && cursor.y < height
      ? cursor
      : null

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        ref={boxRef}
        className="bg-hover relative h-[min(62vh,640px)] cursor-grab touch-none overflow-hidden rounded-lg select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { ...local(e), view }
        }}
        onPointerMove={(e) => {
          const p = local(e)
          setCursor(toImage(view, p.px, p.py))
          const d = drag.current
          if (d) {
            setView({ ...d.view, x: d.view.x + p.px - d.px, y: d.view.y + p.py - d.py })
            setTouched(true)
          }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={fit}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width,
            height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <img
            src={src}
            alt={alt}
            width={width}
            height={height}
            draggable={false}
            onError={onError}
            className="block size-full max-w-none"
            style={{ imageRendering: view.scale >= 2 ? 'pixelated' : 'auto' }}
          />
          {overlay && (
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="pointer-events-none absolute inset-0 size-full"
              aria-hidden
            >
              {typeof overlay === 'function' ? overlay(1 / view.scale) : overlay}
            </svg>
          )}
        </div>
      </div>
      <div className="text-muted tabular flex items-center gap-3 text-xs">
        <span>
          {width}×{height} px
        </span>
        <span>縮放 {Math.round(view.scale * 100)}%</span>
        <span>{inside ? `座標 (${inside.x}, ${inside.y})` : '滾輪縮放、拖曳移動、雙擊置中'}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={fit}>
          <Maximize className="size-3.5" aria-hidden />
          符合畫面
        </Button>
        <Button size="sm" variant="ghost" onClick={actual}>
          <Scan className="size-3.5" aria-hidden />
          原始大小
        </Button>
      </div>
    </div>
  )
}
