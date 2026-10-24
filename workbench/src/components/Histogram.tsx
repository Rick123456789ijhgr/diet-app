// 灰階直方圖（0–255），以虛線標出過暗、過亮門檻。數值來自後端，這裡只負責畫圖。
const W = 640
const H = 220
const PAD = { left: 44, right: 12, top: 12, bottom: 28 }

/** 直方圖上的一條門檻線：灰階值（0–255）、標籤文字、顏色（主題變數）。label 作為 key，須唯一。 */
export interface Threshold {
  value: number
  label: string
  color: string
}

/**
 * 灰階直方圖。counts 預期為 256 格（索引＝灰階值，值＝像素數），由後端計算；
 * 與 charts.tsx 的 ValueHistogram 不同，這裡不做分箱，只照原樣畫出。
 */
export function Histogram({ counts, thresholds }: { counts: number[]; thresholds: Threshold[] }) {
  // y 軸上限＝最多像素的那一格；至少 1，避免全空時除以 0
  const max = Math.max(1, ...counts)
  // 繪圖區的內寬、內高（扣掉邊距）
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  // x：灰階值 → 該格左緣（把 0–256 平均分給內寬，每格寬 bar）；y：像素數 → 長條頂端（SVG 的 y 向下，所以由底部往上減）
  const x = (v: number) => PAD.left + (v / 256) * iw
  const y = (c: number) => PAD.top + ih - (c / max) * ih
  const bar = iw / 256
  // 總像素數，只用在 aria-label，讓螢幕閱讀器有可讀的摘要
  const total = counts.reduce((a, b) => a + b, 0)

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`灰階直方圖，共 ${total.toLocaleString()} 個像素`}
      >
        {/* 三條水平格線：0、一半、最大值 */}
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(max * t)}
              y2={y(max * t)}
              className="stroke-card-border"
            />
            <text
              x={PAD.left - 6}
              y={y(max * t) + 4}
              textAnchor="end"
              className="fill-muted text-[10px]"
            >
              {Math.round(max * t).toLocaleString()}
            </text>
          </g>
        ))}
        {/* 每個灰階值一條長條，略過 0；bar 約 2.3 單位，Math.max(…, 1) 只是保險 */}
        {counts.map((c, i) =>
          c > 0 ? (
            <rect
              key={i}
              x={x(i)}
              y={y(c)}
              width={Math.max(bar, 1)}
              height={PAD.top + ih - y(c)}
              className="fill-primary"
            />
          ) : null,
        )}
        {/* x 刻度與門檻線都加 bar / 2，對齊該灰階值長條的中央而非左緣 */}
        {[0, 64, 128, 192, 255].map((v) => (
          <text
            key={v}
            x={x(v) + bar / 2}
            y={H - 10}
            textAnchor="middle"
            className="fill-muted text-[10px]"
          >
            {v}
          </text>
        ))}
        {thresholds.map((t) => (
          <g key={t.label}>
            <line
              x1={x(t.value) + bar / 2}
              x2={x(t.value) + bar / 2}
              y1={PAD.top}
              y2={PAD.top + ih}
              stroke={t.color}
              strokeWidth={2}
              strokeDasharray="4 4"
            />
            <text
              x={x(t.value) + bar / 2 + 4}
              y={PAD.top + 10}
              fill={t.color}
              className="text-[11px] font-medium"
            >
              {t.label} {t.value}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  )
}
