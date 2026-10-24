// 輕量 SVG 圖表：折線、長條（含信賴區間）、堆疊長條、熱度圖、分箱直方圖。
// 顏色只用主題變數與 PALETTE，支援深色模式。
// 數值由後端計算；這裡只負責畫圖（直方圖的分箱屬於畫圖）。
import { useState, type ReactNode } from 'react'

import { foldSeries, OTHER_KEY } from '@/lib/series'

/**
 * 系列色：經色盲模擬驗證的固定順序（橘、藍、青綠、黃、洋紅、綠、紫、紅），深淺色各有一組，
 * 定義在 index.css。依序取用、不循環；超過 8 個系列應合併為「其他」或分圖。
 */
export const PALETTE = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)

// 所有圖表共用的 SVG 座標系：寬固定 640 個使用者單位，以 viewBox＋w-full 依容器寬度等比縮放，
// 因此下方的像素數字都是「viewBox 單位」而非螢幕像素。PAD 為繪圖區四周留給刻度文字與軸標籤的邊距。
const W = 640
const PAD = { left: 52, right: 16, top: 16, bottom: 36 }

/**
 * 在 [lo, hi] 之間等距取 n 個刻度（含兩端點），不做「漂亮數字」取整；顯示時再由 fmt 格式化。
 * lo === hi（例如只有一個點）時只回傳一個刻度，避免 n 個重複值造成重複的 React key。
 */
function ticks(lo: number, hi: number, n = 5): number[] {
  if (hi === lo) return [lo]
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
}

/** 預設刻度格式：絕對值 ≥ 100 取整數，其餘保留 3 位有效數字（再轉回 Number 去掉多餘的尾零）。 */
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toPrecision(3)).toString())

/**
 * 共用座標軸：y 刻度畫成橫向格線＋左側數字，x 刻度只畫下方數字（不畫直格線），可選 x 軸標籤。
 * x、y 為呼叫端算好的比例尺（資料值 → viewBox 座標），xs、ys 為要標示的刻度值，h 為圖高。
 */
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
          {/* 文字基線在 y 座標上，+3 讓 10px 字的視覺中心對齊格線 */}
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

/** LineChart 的一條折線。name 同時作為 React key 與圖例文字，同一張圖內不可重複。 */
export interface Series {
  name: string
  color: string
  points: { x: number; y: number }[]
  dashed?: boolean
}

/**
 * 多條折線；thresholds 以紅色虛線標出門檻。
 * - yDomain：固定 y 範圍（例如比例固定 0–1）；未給時由資料與門檻自動決定，且下限至少包含 0。
 * - label：SVG 的 aria-label，讓螢幕閱讀器把整張圖當成一張有名稱的圖片。
 * - 沒有任何點時不渲染（回傳 null）。
 */
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
  // 門檻也納入 y 範圍，確保門檻線一定落在圖內
  const ys = [...all.map((p) => p.y), ...thresholds.map((t) => t.y)]
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  // 自動範圍：下限取 min(0, 最小值) 讓長度可比較；最大值為 0（全為 0）時改用 1，避免範圍為零
  const [y0, y1] = yDomain ?? [Math.min(0, ...ys), Math.max(...ys) || 1]
  // 線性比例尺：資料值 → viewBox 座標。`|| 1` 防止只有單一 x（或 y 範圍為零）時除以 0。
  // y 軸要翻轉（SVG 的 y 向下增加），所以用 1 - 比例。
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
            {/* 每個資料點畫小圓點，<title> 提供滑鼠懸停的原生提示（不需額外的 tooltip 元件） */}
            {s.points.map((p, i) => (
              <circle key={i} cx={x(p.x)} cy={y(p.y)} r={3} fill={s.color}>
                <title>{`${s.name}：${fmt(p.x)} → ${yFormat ? yFormat(p.y) : fmt(p.y)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      {/* 只有一條線時圖例是多餘的（圖名已說明），兩條以上才顯示 */}
      {series.length > 1 && (
        <ChartLegend items={series.map((s) => ({ color: s.color, label: s.name }))} />
      )}
    </figure>
  )
}

/**
 * 水平長條（0–1 的比例），可加信賴區間。
 * - rows[].value 為 null 時只顯示列名（例如樣本數為 0、比例無定義）。
 * - low／high 皆有值時畫成「工」字形誤差線；note 附在百分比後（例如 n=…）。
 * - 比例尺固定 0–1，不依資料縮放，讓不同圖之間可以直接比較長度。
 */
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
  // 版面：左側 150 留給列名，右側 60 留給百分比文字；下方 24 留給 0–100% 刻度。圖高隨列數增加。
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
                {/* 數值文字固定放在 100% 位置右側對齊成一欄，而不是跟著長條末端移動 */}
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

/**
 * 堆疊長條：每列依 keys 順序堆疊（例如各實驗組成功於各階的影像數）。
 * - values 為絕對數量（非比例）；所有列共用同一個最大總和作比例尺，列與列之間長度可比較。
 * - keys 的順序同時決定堆疊順序與 PALETTE 取色順序；keyLabel 把 key 轉成顯示文字。
 * - 超過 PALETTE 數量（8）時，第 8 個以後的鍵合併為「其他」（色盤不循環）。
 */
export function StackedBars({
  rows: allRows,
  keys: allKeys,
  label,
  keyLabel: rawKeyLabel = (k) => k,
}: {
  rows: { label: string; values: Record<string, number> }[]
  keys: string[]
  label: string
  keyLabel?: (k: string) => string
}) {
  const { keys, rows } = foldSeries(allKeys, allRows, PALETTE.length)
  const keyLabel = (k: string) => (k === OTHER_KEY ? '其他' : rawKeyLabel(k))
  const rowH = 28
  const left = 150
  const width = W - left - 40
  // 最大列總和；至少為 1，避免全部為 0 時除以 0
  const max = Math.max(1, ...rows.map((r) => keys.reduce((a, k) => a + (r.values[k] ?? 0), 0)))
  const h = rows.length * rowH + 8
  // keys 已經 foldSeries 限制在 PALETTE 數量內，索引不會超出色盤
  const color = (k: string) => PALETTE[keys.indexOf(k)]!
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${h}`} className="w-full" role="img" aria-label={label}>
        {rows.map((r, i) => {
          // acc：本列已堆疊的累計量，決定下一段的起點
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
                // 數量為 0 的段不畫（寬度為 0 的 rect 仍會攔截滑鼠、產生空白提示）
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
              {/* 總數緊接在長條末端右側 */}
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

/**
 * 熱度圖：列×欄的 0–1 比例，格內顯示百分比。
 * - value(row, col) 回傳該格的比例與懸停提示；回傳 undefined 或 rate 為 null 時畫成灰底空格（無資料）。
 * - 顏色深淺以主色的不透明度表示（0.12–1.0），格內同時寫出百分比，不單靠顏色。
 */
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
  // 格寬：把可用寬度平均分給各欄，但最寬 64，欄少時不會被拉得很寬；Math.max(1, …) 防止沒有欄時除以 0。
  // 上方 24 留給欄標題，每列高 26（格高 24＋上下各 1 的間隙）。
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
                  // 不透明度下限 0.12：比例為 0 的格子仍看得出是「有資料、為 0」，與無資料的灰格區分
                  fillOpacity={rate == null ? 1 : 0.12 + rate * 0.88}
                >
                  {v && <title>{v.title}</title>}
                </rect>
                {rate != null && (
                  <text
                    x={left + j * cell + cell / 2}
                    y={top + i * 26 + 17}
                    textAnchor="middle"
                    // 底色夠深（>60%）時改用主色上的文字色維持對比
                    fill={rate > 0.6 ? 'var(--on-primary)' : 'var(--ink)'}
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

/**
 * 數值分布的直方圖（前端分箱，只供畫圖）；threshold 以紅色虛線標出。
 * - values 為每張影像的一個數值（例如清晰度分數），提示文字的單位為「張」。
 * - bins 為等寬分箱數；範圍由資料與門檻共同決定，門檻線一定在圖內。
 * - 空陣列時不渲染。
 */
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
  // 目前滑鼠所在的分箱索引，用來加深該長條（hook 須在提早 return 之前呼叫）
  const [hover, setHover] = useState<number | null>(null)
  if (values.length === 0) return null
  // 沒有門檻時以 ±Infinity 代入，不影響 min／max
  const lo = Math.min(...values, threshold ?? Infinity)
  const hi = Math.max(...values, threshold ?? -Infinity)
  // 所有值相同（hi === lo）時以寬度 1 分箱，避免 step 為 0
  const step = (hi - lo || 1) / bins
  const counts = Array.from({ length: bins }, () => 0)
  // 最大值 v === hi 會算出索引 bins（超出範圍），以 Math.min 併入最後一箱（最後一箱為閉區間）
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / step))]! += 1
  const height = 220
  // 至少有一個值，所以 max ≥ 1，下方 y 比例尺不會除以 0
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
      {/* 只畫非空分箱；長條左右各內縮 1 單位留出間隙，寬度至少 1 以免分箱很多時消失 */}
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

/**
 * 圖表下方的圖例：圓點色塊＋文字。label 可為 ReactNode（例如帶單位或徽章）；
 * 以索引為 key，因為 label 不一定是字串、也不保證唯一。與 results.tsx 的 Legend 外觀相近但用途分開。
 */
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
