// 可縮放、拖曳、查座標的影像檢視器；幾何結果以 SVG 疊在影像座標上（overlay）。
// 換圖但尺寸相同時保留目前的縮放與位置，方便調參數時對照同一區域。
import { Maximize, Scan } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { fitView, toImage, zoomAt, type View } from '@/lib/viewport'

/**
 * 影像檢視器。座標系有兩層：
 * - 容器座標：相對於檢視框左上角的螢幕像素（滑鼠事件換算而來）。
 * - 影像座標：原圖像素。view = { scale, x, y } 描述兩者關係：容器座標 = 影像座標 × scale + (x, y)。
 * 影像與 overlay 放在同一個以 CSS transform 平移縮放的容器內，所以 overlay 只要用影像座標畫，
 * 就會與影像精準對齊，不需自己換算。
 * - width／height：原圖尺寸（影像像素），同時決定 overlay 的 viewBox。
 * - src／alt：影像網址與替代文字。
 */
export function ImageViewer({
  src,
  width,
  height,
  alt,
  overlay,
  className,
  onError,
  fill,
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
  /** 撐滿父元素的高度（放在 MainView 裡）；否則使用固定高度 */
  fill?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [touched, setTouched] = useState(false) // 使用者縮放或拖曳過就不再自動置中
  // 滑鼠所在的影像像素座標（顯示在下方讀數列）
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  // 拖曳起點：按下時的容器座標與當時的 view；移動時以位移量平移，用 ref 是因為不需觸發重繪
  const drag = useRef<{ px: number; py: number; view: View } | null>(null)

  // 置中並完整放進容器（不放大超過 100%），同時解除「使用者動過」的狀態
  const fit = useCallback(() => {
    const box = boxRef.current
    if (!box) return
    setView(fitView(box.clientWidth, box.clientHeight, width, height))
    setTouched(false)
  }, [width, height])

  // 影像尺寸改變時重新置中
  // （fit 只依賴 width、height，同尺寸換圖時不會觸發，因此保留目前的縮放與位置；
  //   用 useLayoutEffect 在瀏覽器繪製前就算好 view，避免先以 scale=1 閃一下）
  useLayoutEffect(fit, [fit])

  // 容器大小改變時，若使用者沒動過就重新置中
  // touched 列入依賴：回呼內讀的是建立當下的 touched，值改變時要重建 observer 才會讀到新值；
  // 清除函式 disconnect 舊的 observer。jsdom 等沒有 ResizeObserver 的環境直接略過。
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
  // （React 的 onWheel 註冊為 passive，無法 preventDefault，所以改用原生 addEventListener。
  //   依賴為空：只在掛載時註冊一次，setView 用函式形式取得最新 view，不需把 view 列入依賴。）
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = box.getBoundingClientRect()
      // 指數縮放：滾輪向下（deltaY > 0）縮小、向上放大，且同樣捲動量的放大與縮小互為倒數；
      // 以游標位置為中心縮放（zoomAt 保持游標下的影像點不動）
      const factor = Math.exp(-e.deltaY * 0.0015)
      setView((v) => zoomAt(v, e.clientX - rect.left, e.clientY - rect.top, factor))
      setTouched(true)
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [])

  // 視窗座標（clientX/Y）→ 容器座標
  const local = (e: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  // 「原始大小」：以容器中心為基準縮放到 scale = 1（一個影像像素＝一個螢幕像素）
  const actual = () => {
    const box = boxRef.current
    if (!box) return
    setView(zoomAt(view, box.clientWidth / 2, box.clientHeight / 2, 1 / view.scale))
    setTouched(true)
  }

  // 游標在影像範圍內才顯示座標；toImage 取 floor，所以有效範圍是 [0, width) × [0, height)
  const inside =
    cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x < width && cursor.y < height
      ? cursor
      : null

  return (
    <div className={cn('flex flex-col', fill && 'min-h-0 flex-1', className)}>
      <div
        ref={boxRef}
        className={cn(
          'viewport-grid relative cursor-crosshair touch-none overflow-hidden rounded-2xl select-none active:cursor-grabbing',
          fill ? 'min-h-[280px] flex-1' : 'h-[min(62vh,640px)]',
        )}
        // className 的 touch-none：讓觸控拖曳交給這裡處理，而不是被瀏覽器當成頁面捲動／縮放
        onPointerDown={(e) => {
          // 捕捉指標：拖出容器外仍持續收到 move／up，不會中途斷掉
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { ...local(e), view }
        }}
        onPointerMove={(e) => {
          const p = local(e)
          setCursor(toImage(view, p.px, p.py))
          const d = drag.current
          if (d) {
            // 平移＝按下時的 view 加上指標總位移（不是逐次累加，避免誤差累積）
            setView({ ...d.view, x: d.view.x + p.px - d.px, y: d.view.y + p.py - d.py })
            setTouched(true)
          }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={fit}
      >
        {/* 影像＋疊圖的共同容器：原尺寸大小，transform 原點在左上角，先平移再縮放，
            恰好對應 容器座標 = 影像座標 × scale + (x, y) */}
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
            // 關閉瀏覽器原生的圖片拖放，否則會搶走拖曳平移的事件
            draggable={false}
            onError={onError}
            className="block size-full max-w-none"
            // 放大到 200% 以上改為最近鄰取樣，看得到真實像素邊界（檢查模糊、雜訊時需要）
            style={{ imageRendering: view.scale >= 2 ? 'pixelated' : 'auto' }}
          />
          {/* 疊圖：viewBox 用影像尺寸，SVG 座標即影像像素。pointer-events-none 讓拖曳穿透到底下；
              aria-hidden 因為疊圖只是視覺輔助，數值已在讀數欄以文字呈現。
              overlay 為函式時傳入 1/scale（一個螢幕像素等於幾個影像像素），讓線寬、標記大小不隨縮放改變 */}
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
      <div
        className={cn(
          'text-muted flex h-8 shrink-0 items-center gap-4 overflow-hidden text-[11px] whitespace-nowrap',
          'mt-1 px-1',
        )}
      >
        <span className="readout">
          {width}×{height}
        </span>
        <span className="readout w-16">{Math.round(view.scale * 100)}%</span>
        <span className={cn('min-w-0 truncate', inside && 'readout text-ink')}>
          {inside ? `x ${inside.x}  y ${inside.y}` : '滾輪縮放、拖曳移動、雙擊置中'}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="shrink-0" onClick={fit}>
          <Maximize className="size-3.5" aria-hidden />
          符合畫面
        </Button>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={actual}>
          <Scan className="size-3.5" aria-hidden />
          原始大小
        </Button>
      </div>
    </div>
  )
}
