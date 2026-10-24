// 總覽：問候語、重點數字卡（第一張為橘色）、各模組的工具，以及使用規則。
import { ArrowUpRight, FlaskConical, Hash, Lock, ScrollText } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/primitives'
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

  return (
    <div className="h-full overflow-y-auto pr-3 pb-3">
      {/* 問候與說明 */}
      <div className="px-1 pt-1 pb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
          {greeting(new Date().getHours())}，歡迎回到開發工作台
        </h1>
        <p className="text-muted mt-1 text-[14px]">
          以合成影像或開發照片測試各模組、調整參數。數字一律由 dietai 的確定性程式計算。
        </p>
      </div>

      {/* 重點數字卡：第一張 hero（橘色） */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard hero label="可用工具" value={`${ready} / ${tools.length}`} note="模組一" />
        <StatCard label="研究模組" value={`${started} / ${MODULES.length}`} note="已有工作台頁面" />
        <StatCard
          label="待校準門檻"
          value={calibrate ? String(calibrate.length) : '…'}
          note="只用 train／dev 校準"
        />
        <StatCard label="測試集" value="鎖定" note="splits/test" />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_380px]">
        {/* 左欄：各研究模組與其工具連結 */}
        <section className="bg-card shadow-card rounded-[20px] p-5">
          <h2 className="mb-3 text-[16px] font-semibold">研究模組</h2>
          <ul className="space-y-1">
            {MODULES.map((m) => (
              // group：滑過整列時一起改變圖示底色與工具膠囊底色
              <li key={m.id} className="hover:bg-sunken group rounded-2xl px-3 py-2.5">
                <Link to={modulePath(m)} className="flex items-start gap-3">
                  <span className="bg-sunken group-hover:bg-card flex size-9 shrink-0 items-center justify-center rounded-full">
                    <m.icon className="size-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{m.name}</span>
                      <span className="text-muted text-xs">{m.short}</span>
                      {m.tools.length === 0 && <Badge>規劃中</Badge>}
                    </div>
                    <p className="text-muted mt-0.5 text-xs">{m.description}</p>
                  </div>
                  <ArrowUpRight
                    className="text-muted size-4 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </Link>
                {/* 工具膠囊放在模組連結外面，避免 <a> 巢狀；pl-12 對齊上方的模組名稱 */}
                {m.tools.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                    {m.tools.map((t) => (
                      <Link
                        key={t.slug}
                        to={toolPath(m, t)}
                        className="bg-sunken group-hover:bg-card hover:!bg-ink hover:text-on-ink inline-flex items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5 text-xs transition-colors"
                      >
                        <t.icon className="size-3.5" aria-hidden />
                        {t.name}
                        {/* 已可用顯示「可用」，否則顯示預計完成的任務書階段 */}
                        {t.ready ? <Badge tone="ok">可用</Badge> : <Badge>階段 {t.stage}</Badge>}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* 右欄：使用規則（對應根目錄 CLAUDE.md 的不可違反規則） */}
        <section className="bg-card shadow-card rounded-[20px] p-5">
          <h2 className="mb-3 text-[16px] font-semibold">使用規則</h2>
          <div className="space-y-2">
            <Rule icon={<Lock className="size-4" />} title="測試集鎖定">
              拒絕讀取 <code className="font-mono text-xs">splits/test</code>；調門檻只用
              train／dev。
            </Rule>
            <Rule icon={<FlaskConical className="size-4" />} title="門檻待校準">
              這裡調出的數值僅供觀察；改預設值請匯出 JSON，附校準依據後在 PR 修改{' '}
              <code className="font-mono text-xs">config.py</code>。
            </Rule>
            <Rule icon={<Hash className="size-4" />} title="數字由程式決定">
              分數全部來自 <code className="font-mono text-xs">dietai</code> 的確定性程式，不採用
              LLM 輸出的數字。
            </Rule>
            <Rule icon={<ScrollText className="size-4" />} title="任務書">
              <code className="font-mono text-xs">docs/tasks/m1-preprocess.md</code>
            </Rule>
          </div>
        </section>
      </div>
    </div>
  )
}

/**
 * 首頁的重點數字卡。
 * @param hero 為 true 時套用橘色 `.hero-card`（文字改白色系）；每頁只給第一張用。
 * @param note 卡片底部的膠囊說明文字。
 */
function StatCard({
  label,
  value,
  note,
  hero,
}: {
  label: string
  value: string
  note: string
  hero?: boolean
}) {
  return (
    <div className={cn('shadow-card rounded-[20px] p-5', hero ? 'hero-card' : 'bg-card')}>
      <div className={cn('text-[13px]', hero ? 'text-white/85' : 'text-muted')}>{label}</div>
      <div className="tabular mt-3 text-[30px] leading-none font-semibold tracking-tight">
        {value}
      </div>
      <div className="mt-3">
        <span
          className={cn(
            'inline-flex h-6 items-center rounded-full px-2.5 text-xs',
            hero ? 'bg-white/20 text-white' : 'bg-sunken text-ink-2',
          )}
        >
          {note}
        </span>
      </div>
    </div>
  )
}

/** 「使用規則」卡中的一條規則：圖示＋標題，下方為說明（children）。 */
function Rule({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="bg-sunken rounded-2xl px-4 py-3">
      <div className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </div>
      <p className="text-ink-2 mt-1 text-xs leading-relaxed">{children}</p>
    </div>
  )
}
