// 輕量 SVG 圖表：折線、長條（含信賴區間）、堆疊長條、熱度圖、分箱直方圖。
// 顏色只用主題變數與 PALETTE，支援深色模式。
// 數值由後端計算；這裡只負責畫圖（直方圖的分箱屬於畫圖）。
import { useState, type ReactNode } from 'react'

/**
 * 系列色：經色盲模擬驗證的固定順序（橘、藍、青綠、黃、洋紅、綠、紫、紅），深淺色各有一組，
 * 定義在 index.css。依序取用、不循環；超過 8 個系列應合併為「其他」或分圖。
 */
export const PALETTE = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)

const W = 640
const PAD = { left: 52, right: 16, top: 16, bottom: 36 }

function ticks(lo: number, hi: number, n = 5): number[] {
  if (hi === lo) return [lo]
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toPrecision(3)).toString())

function Axes({
  x,
  y,
  xs,
  ys,
  h,
  xLabel,
  xFormat = fmt,
  yFormat = fmt,
}: {
  x: (v: number) => number
  y: (v: number) => number
  xs: number[]
  ys: number[]
  h: number
  xLabel?: string
  xFormat?: (v: number) => string
  yFormat?: (v: number) => string
}) {
  return (
    <g className="text-[10px]">
      {ys.map((v) => (
        <g key={`y${v}`}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            className="stroke-card-border"
          />
          <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="fill-muted">
            {yFormat(v)}
          </text>
        </g>
      ))}
      {xs.map((v) => (
        <text
          key={`x${v}`}
          x={x(v)}
          y={h - PAD.bottom + 14}
          textAnchor="middle"
          className="fill-muted"
        >
          {xFormat(v)}
        </text>
      ))}
      {xLabel && (
        <text
          x={(PAD.left + W - PAD.right) / 2}
          y={h - 6}
          textAnchor="middle"
          className="fill-muted"
        >
          {xLabel}
        </text>
      )}
    </g>
  )
}

export interface Series {
  name: string
  color: string
  points: { x: number; y: number }[]
  dashed?: boolean
}

/** 多條折線；thresholds 以紅色虛線標出門檻。 */
export function LineChart({
  series,
  xLabel,
  yDomain,
  yFormat,
  thresholds = [],
  height = 240,
  label,
}: {
  series: Series[]
  xLabel: string
  yDomain?: [number, number]
  yFormat?: (v: number) => string
  thresholds?: { y: number; label: string }[]
  height?: number
  label: string
}) {
  const all = series.flatMap((s) => s.points)
  if (all.length === 0) return null
  const xs = all.map((p) => p.x)
  const ys = [...all.map((p) => p.y), ...thresholds.map((t) => t.y)]
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = yDomain ?? [Math.min(0, ...ys), Math.max(...ys) || 1]
  const x = (v: number) => PAD.left + ((v - x0) / (x1 - x0 || 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) =>
    PAD.top + (1 - (v - y0) / (y1 - y0 || 1)) * (height - PAD.top - PAD.bottom)
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={label}>
        <Axes
          x={x}
          y={y}
          xs={ticks(x0, x1)}
          ys={ticks(y0, y1)}
          h={height}
          xLabel={xLabel}
          yFormat={yFormat}
        />
        {thresholds.map((t) => (
          <g key={t.label}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t.y)}
              y2={y(t.y)}
              stroke="var(--danger)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={W - PAD.right}
              y={y(t.y) - 4}
              textAnchor="end"
              fill="var(--danger)"
              className="text-[10px]"
            >
              {t.label}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.points.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '6 4' : undefined}
            />
            {s.points.map((p, i) => (
              <circle key={i} cx={x(p.x)} cy={y(p.y)} r={3} fill={s.color}>
                <title>{`${s.name}：${fmt(p.x)} → ${yFormat ? yFormat(p.y) : fmt(p.y)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <ChartLegend items={series.map((s) => ({ color: s.color, label: s.name }))} />
      )}
    </figure>
  )
}

/** 水平長條（0–1 的比例），可加信賴區間。 */
export function BarList({
  rows,
  label,
}: {
  rows: {
    label: string
    value: number | null
    low?: number | null
    high?: number | null
    note?: string
  }[]
  label: string
}) {
  const rowH = 28
  const left = 150
  const width = W - left - 60
  const h = rows.length * rowH + 24
  const x = (v: number) => left + v * width
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full" role="img" aria-label={label}>
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v} className="text-[10px]">
          <line x1={x(v)} x2={x(v)} y1={0} y2={h - 18} className="stroke-card-border" />
          <text x={x(v)} y={h - 4} textAnchor="middle" className="fill-muted">
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = i * rowH + rowH / 2
        return (
          <g key={r.label}>
            <text x={left - 8} y={cy + 4} textAnchor="end" className="fill-ink text-[11px]">
              {r.label}
            </text>
            {r.value !== null && (
              <>
                <rect
                  x={left}
                  y={cy - 8}
                  width={r.value * width}
                  height={16}
                  rx={8}
                  className="fill-primary"
                />
                {r.low != null && r.high != null && (
                  <g stroke="var(--ink)" strokeWidth={1.5}>
                    <line x1={x(r.low)} x2={x(r.high)} y1={cy} y2={cy} />
                    <line x1={x(r.low)} x2={x(r.low)} y1={cy - 5} y2={cy + 5} />
                    <line x1={x(r.high)} x2={x(r.high)} y1={cy - 5} y2={cy + 5} />
                  </g>
                )}
                <text x={x(1) + 6} y={cy + 4} className="fill-muted tabular text-[11px]">
                  {(r.value * 100).toFixed(1)}%{r.note ? ` ${r.note}` : ''}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** 堆疊長條：每列依 keys 順序堆疊（例如各實驗組成功於各階的影像數）。 */
export function StackedBars({
  rows,
  keys,
  label,
  keyLabel = (k) => k,
}: {
  rows: { label: string; values: Record<string, number> }[]
  keys: string[]
  label: string
  keyLabel?: (k: string) => string
}) {
  const rowH = 28
  const left = 150
  const width = W - left - 40
  const max = Math.max(1, ...rows.map((r) => keys.reduce((a, k) => a + (r.values[k] ?? 0), 0)))
  const h = rows.length * rowH + 8
  const color = (k: string) => PALETTE[keys.indexOf(k) % PALETTE.length]!
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${h}`} className="w-full" role="img" aria-label={label}>
        {rows.map((r, i) => {
          let acc = 0
          const cy = i * rowH + rowH / 2
          const total = keys.reduce((a, k) => a + (r.values[k] ?? 0), 0)
          return (
            <g key={r.label}>
              <text x={left - 8} y={cy + 4} textAnchor="end" className="fill-ink text-[11px]">
                {r.label}
              </text>
              {keys.map((k) => {
                const v = r.values[k] ?? 0
                if (!v) return null
                const x0 = left + (acc / max) * width
                acc += v
                return (
                  <rect
                    key={k}
                    x={x0}
                    y={cy - 8}
                    width={(v / max) * width}
                    height={16}
                    fill={color(k)}
                  >
                    <title>{`${r.label}・${keyLabel(k)}：${v}`}</title>
                  </rect>
                )
              })}
              <text
                x={left + (total / max) * width + 6}
                y={cy + 4}
                className="fill-muted tabular text-[11px]"
              >
                {total}
              </text>
            </g>
          )
        })}
      </svg>
      <ChartLegend items={keys.map((k) => ({ color: color(k), label: keyLabel(k) }))} />
    </figure>
  )
}

/** 熱度圖：列×欄的 0–1 比例，格內顯示百分比。 */
export function Heatmap({
  rows,
  cols,
  value,
  label,
}: {
  rows: string[]
  cols: string[]
  value: (row: string, col: string) => { rate: number | null; title: string } | undefined
  label: string
}) {
  const left = 150
  const cell = Math.min(64, (W - left - 8) / Math.max(1, cols.length))
  const top = 24
  const h = top + rows.length * 26 + 4
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full" role="img" aria-label={label}>
      {cols.map((c, j) => (
        <text
          key={c}
          x={left + j * cell + cell / 2}
          y={14}
          textAnchor="middle"
          className="fill-muted text-[10px]"
        >
          {c}
        </text>
      ))}
      {rows.map((r, i) => (
        <g key={r}>
          <text
            x={left - 8}
            y={top + i * 26 + 17}
            textAnchor="end"
            className="fill-ink text-[11px]"
          >
            {r}
          </text>
          {cols.map((c, j) => {
            const v = value(r, c)
            const rate = v?.rate
            return (
              <g key={c}>
                <rect
                  x={left + j * cell + 1}
                  y={top + i * 26 + 1}
                  width={cell - 2}
                  height={24}
                  rx={6}
                  fill={rate == null ? 'var(--hover)' : 'var(--primary)'}
                  fillOpacity={rate == null ? 1 : 0.12 + rate * 0.88}
                >
                  {v && <title>{v.title}</title>}
                </rect>
                {rate != null && (
                  <text
                    x={left + j * cell + cell / 2}
                    y={top + i * 26 + 17}
                    textAnchor="middle"
                    fill={rate > 0.6 ? 'white' : 'var(--ink)'}
                    className="tabular text-[10px]"
                  >
                    {Math.round(rate * 100)}%
                  </text>
                )}
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}

/** 數值分布的直方圖（前端分箱，只供畫圖）；threshold 以紅色虛線標出。 */
export function ValueHistogram({
  values,
  threshold,
  xLabel,
  bins = 30,
  label,
}: {
  values: number[]
  threshold?: number
  xLabel: string
  bins?: number
  label: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (values.length === 0) return null
  const lo = Math.min(...values, threshold ?? Infinity)
  const hi = Math.max(...values, threshold ?? -Infinity)
  const step = (hi - lo || 1) / bins
  const counts = Array.from({ length: bins }, () => 0)
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / step))]! += 1
  const height = 220
  const max = Math.max(...counts)
  const x = (v: number) => PAD.left + ((v - lo) / (hi - lo || 1)) * (W - PAD.left - PAD.right)
  const y = (c: number) => PAD.top + (1 - c / max) * (height - PAD.top - PAD.bottom)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={label}>
      <Axes
        x={x}
        y={y}
        xs={ticks(lo, hi)}
        ys={ticks(0, max, 3)}
        h={height}
        xLabel={xLabel}
        yFormat={(v) => String(Math.round(v))}
      />
      {counts.map((c, i) =>
        c ? (
          <rect
            key={i}
            x={x(lo + i * step) + 1}
            y={y(c)}
            width={Math.max(1, x(lo + step) - x(lo) - 2)}
            height={height - PAD.bottom - y(c)}
            className={hover === i ? 'fill-primary-ink' : 'fill-primary'}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${fmt(lo + i * step)}–${fmt(lo + (i + 1) * step)}：${c} 張`}</title>
          </rect>
        ) : null,
      )}
      {threshold !== undefined && (
        <line
          x1={x(threshold)}
          x2={x(threshold)}
          y1={PAD.top}
          y2={height - PAD.bottom}
          stroke="var(--danger)"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
      )}
    </svg>
  )
}

export function ChartLegend({ items }: { items: { color: string; label: ReactNode }[] }) {
  return (
    <p className="text-muted mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((i, k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </p>
  )
}
