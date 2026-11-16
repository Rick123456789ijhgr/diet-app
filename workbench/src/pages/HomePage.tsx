// 總覽（森林綠儀表板）：標題列＋主要操作、四張數字卡（第一張深綠）、可用模組卡、使用規則與規劃中的模組。
import {
  ArrowUpRight,
  FlaskConical,
  Hash,
  Lock,
  ScanSearch,
  ScrollText,
  Trophy,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { Badge, InfoTip } from '@/components/ui/primitives'
import { useConfigSchemas } from '@/hooks/useConfigSchemas'
import { cn } from '@/lib/cn'
import { MODULES, modulePath, toolPath } from '@/nav'

/** 依本機時間（0–23 時）回傳問候語；只在畫面重繪時計算，不會隨時間自動更新。 */
function greeting(hour: number) {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早安'
  if (hour < 14) return '午安'
  if (hour < 18) return '下午好'
  return '晚安'
}

/**
 * 工作台首頁（總覽）。
 *
 * 數字卡的來源：
 * - 可用工具／研究模組：前端靜態的 `MODULES` 導覽表（`nav.ts`），不需要呼叫後端。
 * - 待校準門檻：參數結構（`useConfigSchemas`）中標記 `calibrate` 的欄位數；載入前顯示「…」。
 * - 測試集：固定顯示「鎖定」，對應根目錄規則 7（splits/test 不得用於調參）。
 */
export function HomePage() {
  const tools = MODULES.flatMap((m) => m.tools)
  const ready = tools.filter((t) => t.ready).length
  // 「已開始」＝至少有一個工作台頁面（不論是否已可用）的模組
  const started = MODULES.filter((m) => m.tools.length > 0).length
  const schemas = useConfigSchemas()
  // 所有設定類別中需要校準的欄位；schemas 尚未載入時為 undefined
  const calibrate = schemas.data?.classes.flatMap((c) => c.fields.filter((f) => f.calibrate))
  // 有工作台頁面的模組以卡片呈現；其餘列在「規劃中」
  const active = MODULES.filter((m) => m.tools.length > 0)
  const planned = MODULES.filter((m) => m.tools.length === 0)

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-[1440px] space-y-4">
        {/* 標題列：問候語（說明在 ⓘ）＋最常用的兩個入口 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h1 className="text-[26px] leading-tight font-bold tracking-tight">
              {greeting(new Date().getHours())}，歡迎回到開發工作台
            </h1>
            <InfoTip
              label="工作台說明"
              side="bottom"
              text="以合成影像或開發照片測試各模組、調整參數。數字一律由 dietai 的確定性程式計算。"
            />
          </div>
          <Link
            to="/m1/results"
            className="bg-primary text-on-primary hover:bg-primary-ink inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors"
          >
            <Trophy className="size-4" aria-hidden />
            找最佳流程
          </Link>
          <Link
            to="/m1/inspect"
            className="border-primary/70 text-primary-ink hover:bg-primary-soft bg-card inline-flex h-10 items-center gap-2 rounded-full border px-5 text-sm font-medium transition-colors"
          >
            <ScanSearch className="size-4" aria-hidden />
            單張檢視
          </Link>
        </div>

        {/* 數字卡：第一張深綠 */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            hero
            label="可用工具"
            value={`${ready} / ${tools.length}`}
            note="模組一"
            to="/m1"
          />
          <StatCard
            label="研究模組"
            value={`${started} / ${MODULES.length}`}
            note="已有工作台頁面"
          />
          <StatCard
            label="待校準門檻"
            value={calibrate ? String(calibrate.length) : '…'}
            note="只用 train／dev 校準"
            to="/m1/inspect"
          />
          <StatCard label="測試集" value="鎖定" note="splits/test" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          {/* 可用模組與其工具連結 */}
          <ul
            aria-label="研究模組"
            className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-4"
          >
            {active.map((m) => (
              <li key={m.id} className="bg-card rounded-card p-5">
                <div className="flex items-start gap-3">
                  <span className="bg-primary-soft text-primary grid size-11 shrink-0 place-items-center rounded-full">
                    <m.icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-semibold">{m.name}</div>
                    <div className="text-muted text-xs">{m.short}</div>
                  </div>
                  <ArrowLink to={modulePath(m)} label={`前往${m.name}`} />
                </div>
                <p className="text-muted mt-3 line-clamp-2 text-xs" title={m.description}>
                  {m.description}
                </p>
                {/* 工具連結放在模組連結外面，避免 <a> 巢狀 */}
                <div className="mt-3 space-y-1">
                  {m.tools.map((t) => (
                    <Link
                      key={t.slug}
                      to={toolPath(m, t)}
                      className="bg-sunken hover:bg-hover flex items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-3.5 text-sm transition-colors"
                    >
                      <t.icon className="text-primary size-4" aria-hidden />
                      <span className="flex-1">{t.name}</span>
                      {/* 已可用顯示「可用」，否則顯示預計完成的任務書階段 */}
                      {t.ready ? <Badge tone="ok">可用</Badge> : <Badge>階段 {t.stage}</Badge>}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <div className="space-y-4">
            {/* 使用規則（對應根目錄 CLAUDE.md 的不可違反規則）；細節放在 ⓘ 提示 */}
            <section aria-labelledby="home-rules" className="bg-card rounded-card p-5">
              <h2 id="home-rules" className="mb-2 text-[16px] font-semibold">
                使用規則
              </h2>
              <ul className="space-y-1">
                <Rule
                  icon={<Lock className="size-4" />}
                  title="測試集鎖定"
                  detail="拒絕讀取 splits/test；調門檻只用 train／dev。"
                />
                <Rule
                  icon={<FlaskConical className="size-4" />}
                  title="門檻待校準"
                  detail="這裡調出的數值僅供觀察；改預設值請匯出 JSON，附校準依據後在 PR 修改 config.py。"
                />
                <Rule
                  icon={<Hash className="size-4" />}
                  title="數字由程式決定"
                  detail="分數全部來自 dietai 的確定性程式，不採用 LLM 輸出的數字。"
                />
                <Rule
                  icon={<ScrollText className="size-4" />}
                  title="任務書"
                  detail="docs/tasks/m1-preprocess.md"
                />
              </ul>
            </section>

            {/* 規劃中（尚無工作台頁面）的模組：斜線紋圖示表示尚未開始 */}
            {planned.length > 0 && (
              <section aria-labelledby="home-planned" className="bg-card rounded-card p-5">
                <h2 id="home-planned" className="mb-2 text-[16px] font-semibold">
                  規劃中
                </h2>
                <ul className="space-y-1">
                  {planned.map((m) => (
                    <li key={m.id}>
                      <Link
                        to={modulePath(m)}
                        title={m.description}
                        className="hover:bg-hover -mx-2 flex items-center gap-3 rounded-full px-2 py-1.5"
                      >
                        <span className="hatch text-ink-2 grid size-9 shrink-0 place-items-center rounded-full">
                          <m.icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{m.name}</span>
                          <span className="text-muted block text-xs">{m.short}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 卡片右上角的箭頭圓鈕（連到詳細頁）；inverse 用在深綠卡上。 */
function ArrowLink({ to, label, inverse }: { to: string; label: string; inverse?: boolean }) {
  return (
    <Link
      to={to}
      aria-label={label}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full transition-colors',
        inverse
          ? 'text-primary-ink bg-white hover:bg-white/85'
          : 'border-ink/70 text-ink hover:bg-ink hover:text-card border',
      )}
    >
      <ArrowUpRight className="size-4" aria-hidden />
    </Link>
  )
}

/**
 * 數字卡。
 * @param hero 為 true 時套用深綠 `.hero-card`（文字白色）；每頁只給第一張用。
 * @param note 數字下方的補充說明。
 * @param to 有詳細頁時在右上角放箭頭圓鈕。
 */
function StatCard({
  label,
  value,
  note,
  hero,
  to,
}: {
  label: string
  value: string
  note: string
  hero?: boolean
  to?: string
}) {
  return (
    <div className={cn('rounded-card p-5', hero ? 'hero-card' : 'bg-card')}>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <span className="text-[16px] font-semibold">{label}</span>
        {to && <ArrowLink to={to} label={`查看${label}`} inverse={hero} />}
      </div>
      <div className="tabular mt-2 text-[40px] leading-none font-bold tracking-tight">{value}</div>
      <div className={cn('mt-3 text-xs', hero ? 'text-white/85' : 'text-primary-ink')}>{note}</div>
    </div>
  )
}

/** 「使用規則」的一條：圖示＋標題，說明在 ⓘ 提示裡。 */
function Rule({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="bg-primary-soft text-primary grid size-9 shrink-0 place-items-center rounded-full">
        {icon}
      </span>
      <span className="flex-1 text-sm font-medium">{title}</span>
      <InfoTip text={detail} label={`${title}說明`} side="left" />
    </li>
  )
}
