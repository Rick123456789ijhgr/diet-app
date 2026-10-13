// 灰階直方圖（0–255），以虛線標出過暗、過亮門檻。數值來自後端，這裡只負責畫圖。
const W = 640
const H = 220
const PAD = { left: 44, right: 12, top: 12, bottom: 28 }

export interface Threshold {
  value: number
  label: string
  color: string
}

export function Histogram({ counts, thresholds }: { counts: number[]; thresholds: Threshold[] }) {
  const max = Math.max(1, ...counts)
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const x = (v: number) => PAD.left + (v / 256) * iw
  const y = (c: number) => PAD.top + ih - (c / max) * ih
  const bar = iw / 256
  const total = counts.reduce((a, b) => a + b, 0)

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`灰階直方圖，共 ${total.toLocaleString()} 個像素`}
      >
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
