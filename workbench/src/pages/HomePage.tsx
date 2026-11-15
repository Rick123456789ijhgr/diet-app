// 總覽：問候語、一條重點數字列、各模組的工具卡，以及使用規則（說明收進 ⓘ 提示）。
import { ChevronRight, FlaskConical, Hash, Lock, ScrollText } from 'lucide-react'
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
 * 數字列的來源：
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
  // 有工作台頁面的模組以卡片呈現；其餘列在「規劃中」一行
  const active = MODULES.filter((m) => m.tools.length > 0)
  const planned = MODULES.filter((m) => m.tools.length === 0)

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mx-auto max-w-[1400px] space-y-3">
        <div className="flex items-center gap-1.5 px-1 pt-1">
          <h1 className="text-[22px] leading-tight font-semibold">
            {greeting(new Date().getHours())}，歡迎回到開發工作台
          </h1>
          <InfoTip
            label="工作台說明"
            side="bottom"
            text="以合成影像或開發照片測試各模組、調整參數。數字一律由 dietai 的確定性程式計算。"
          />
        </div>

        {/* 重點數字：一張卡內四格，第一格以主色強調 */}
        <div className="bg-card shadow-card border-card-border rounded-card divide-card-border grid grid-cols-2 divide-x border xl:grid-cols-4">
          <Stat accent label="可用工具" value={`${ready} / ${tools.length}`} note="模組一" />
          <Stat label="研究模組" value={`${started} / ${MODULES.length}`} note="已有工作台頁面" />
          <Stat
            label="待校準門檻"
            value={calibrate ? String(calibrate.length) : '…'}
            note="只用 train／dev 校準"
          />
          <Stat label="測試集" value="鎖定" note="splits/test" />
        </div>

        <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
          {/* 各研究模組與其工具連結 */}
          <section aria-labelledby="home-modules">
            <h2 id="home-modules" className="mb-2 px-1 text-[15px] font-semibold">
              研究模組
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] items-start gap-3">
              {active.map((m) => (
                <li
                  key={m.id}
                  className="bg-card shadow-card border-card-border rounded-card flex flex-col border p-3.5"
                >
                  <Link to={modulePath(m)} className="group flex items-center gap-2.5">
                    <span
                      className={cn(
                        'grid size-9 shrink-0 place-items-center rounded-lg',
                        'bg-primary-soft text-primary-ink',
                      )}
                    >
                      <m.icon className="size-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold group-hover:underline">{m.name}</div>
                      <div className="text-muted text-xs">{m.short}</div>
                    </div>
                  </Link>
                  <p className="text-muted mt-2 line-clamp-2 text-xs" title={m.description}>
                    {m.description}
                  </p>
                  {/* 工具連結放在模組連結外面，避免 <a> 巢狀 */}
                  {
                    <div className="border-card-border mt-3 space-y-0.5 border-t pt-2">
                      {m.tools.map((t) => (
                        <Link
                          key={t.slug}
                          to={toolPath(m, t)}
                          className="hover:bg-hover group/tool -mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm"
                        >
                          <t.icon className="text-muted size-4" aria-hidden />
                          <span className="flex-1">{t.name}</span>
                          {/* 已可用顯示「可用」，否則顯示預計完成的任務書階段 */}
                          {t.ready ? <Badge tone="ok">可用</Badge> : <Badge>階段 {t.stage}</Badge>}
                          <ChevronRight
                            className="text-muted size-4 opacity-0 transition-opacity group-hover/tool:opacity-100"
                            aria-hidden
                          />
                        </Link>
                      ))}
                    </div>
                  }
                </li>
              ))}
            </ul>
            {/* 規劃中（尚無工作台頁面）的模組只列一行，不佔整張卡 */}
            {planned.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
                <span className="text-muted text-xs">規劃中</span>
                {planned.map((m) => (
                  <Link
                    key={m.id}
                    to={modulePath(m)}
                    title={m.description}
                    className="bg-card border-card-border hover:bg-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm"
                  >
                    <m.icon className="text-muted size-4" aria-hidden />
                    {m.name}
                    <span className="text-muted text-xs">{m.short}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* 使用規則（對應根目錄 CLAUDE.md 的不可違反規則）；細節放在 ⓘ 提示 */}
          <section aria-labelledby="home-rules">
            <h2 id="home-rules" className="mb-2 px-1 text-[15px] font-semibold">
              使用規則
            </h2>
            <ul className="bg-card shadow-card border-card-border rounded-card divide-card-border divide-y border px-3.5 py-1">
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
        </div>
      </div>
    </div>
  )
}

/**
 * 數字列的一格。
 * @param accent 為 true 時數字用主色；每頁只給第一格用。
 * @param note 數字下方的補充說明。
 */
function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string
  value: string
  note: string
  accent?: boolean
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-muted text-xs">{label}</div>
      <div
        className={cn(
          'tabular mt-0.5 text-[26px] leading-tight font-semibold tracking-tight',
          accent && 'text-primary',
        )}
      >
        {value}
      </div>
      <div className="text-ink-2 text-xs">{note}</div>
    </div>
  )
}

/** 「使用規則」的一條：圖示＋標題，說明在 ⓘ 提示裡。 */
function Rule({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <li className="flex items-center gap-2.5 py-2">
      <span className="bg-sunken text-ink-2 grid size-7 shrink-0 place-items-center rounded-lg">
        {icon}
      </span>
      <span className="flex-1 text-sm font-medium">{title}</span>
      <InfoTip text={detail} label={`${title}說明`} side="left" />
    </li>
  )
}
