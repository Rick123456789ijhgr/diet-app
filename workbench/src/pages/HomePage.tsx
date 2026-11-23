// 總覽（光學儀器）：標題列＋兩個常用入口、一條量測讀數列、模組清單（像儀器的通道表）與使用規則。
import { FlaskConical, Hash, Lock, ScanSearch, ScrollText, Trophy } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/layout/Workspace'
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

/** 連結做成按鈕外觀（與 Button 的 primary／outline 一致） */
const LINK_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-4'

/**
 * 工作台首頁（總覽）。
 *
 * 讀數列的來源：
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
  // 有工作台頁面的模組排前面，規劃中的排後面
  const ordered = [
    ...MODULES.filter((m) => m.tools.length > 0),
    ...MODULES.filter((m) => m.tools.length === 0),
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={`${greeting(new Date().getHours())}，歡迎回到開發工作台`}
        description="以合成影像或開發照片測試各模組、調整參數。數字一律由 dietai 的確定性程式計算。"
        aside={
          <div className="flex items-center gap-2">
            <Link
              to="/m1/inspect"
              className={cn(LINK_BUTTON, 'border-line-strong/80 bg-card hover:bg-hover border')}
            >
              <ScanSearch aria-hidden />
              單張檢視
            </Link>
            <Link
              to="/m1/results"
              className={cn(LINK_BUTTON, 'bg-primary text-on-primary hover:bg-primary-ink')}
            >
              <Trophy aria-hidden />
              找最佳流程
            </Link>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1280px] space-y-4">
          {/* 讀數列：一塊面板內四格，以髮絲線分隔；第一格數值用主色 */}
          <div className="bg-card border-card-border rounded-card divide-card-border grid grid-cols-2 divide-x border xl:grid-cols-4">
            <Stat accent label="可用工具" value={`${ready}/${tools.length}`} note="模組一" />
            <Stat label="研究模組" value={`${started}/${MODULES.length}`} note="已有工作台頁面" />
            <Stat
              label="待校準門檻"
              value={calibrate ? String(calibrate.length) : '…'}
              note="只用 train／dev 校準"
            />
            <Stat label="測試集" value="鎖定" note="splits/test" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
            {/* 模組清單：一列一個模組，像儀器的通道表；規劃中的模組淡化並以斜線紋圖示表示 */}
            <section
              aria-labelledby="home-modules"
              className="bg-card border-card-border rounded-card border"
            >
              <h2
                id="home-modules"
                className="border-card-border border-b px-4 py-2.5 text-sm font-semibold"
              >
                研究模組
              </h2>
              <ul className="divide-card-border divide-y">
                {ordered.map((m) => {
                  const planned = m.tools.length === 0
                  return (
                    <li
                      key={m.id}
                      className="grid grid-cols-[minmax(180px,240px)_1fr] items-center gap-4 px-4 py-3"
                    >
                      <Link
                        to={modulePath(m)}
                        title={m.description}
                        className={cn(
                          'group flex min-w-0 items-center gap-3',
                          planned && 'opacity-60',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-8 shrink-0 place-items-center rounded-md',
                            planned ? 'hatch text-ink-2' : 'bg-primary-soft text-primary',
                          )}
                        >
                          <m.icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold group-hover:underline">
                            {m.name}
                          </span>
                          <span className="text-muted block text-xs">{m.short}</span>
                        </span>
                      </Link>
                      {planned ? (
                        <span className="text-muted text-xs">規劃中</span>
                      ) : (
                        // 工具連結放在模組連結外面，避免 <a> 巢狀
                        <div className="flex flex-wrap gap-1.5">
                          {m.tools.map((t) => (
                            <Link
                              key={t.slug}
                              to={toolPath(m, t)}
                              className="border-card-border hover:border-primary/60 hover:bg-primary-soft group/tool inline-flex h-8 items-center gap-2 rounded-md border pr-1.5 pl-2.5 text-sm transition-colors"
                            >
                              <t.icon
                                className="text-muted group-hover/tool:text-primary size-4"
                                aria-hidden
                              />
                              {t.name}
                              {/* 已可用顯示「可用」，否則顯示預計完成的任務書階段 */}
                              {t.ready ? (
                                <Badge tone="ok">可用</Badge>
                              ) : (
                                <Badge>階段 {t.stage}</Badge>
                              )}
                            </Link>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>

            {/* 使用規則（對應根目錄 CLAUDE.md 的不可違反規則）；細節放在 ⓘ 提示 */}
            <section
              aria-labelledby="home-rules"
              className="bg-card border-card-border rounded-card h-fit border"
            >
              <h2
                id="home-rules"
                className="border-card-border border-b px-4 py-2.5 text-sm font-semibold"
              >
                使用規則
              </h2>
              <ul className="divide-card-border divide-y">
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
    </div>
  )
}

/**
 * 讀數列的一格：標籤、等寬大數字、補充說明。
 * @param accent 為 true 時數值用主色；每頁只給第一格用。
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
    <div className="px-4 py-3.5">
      <div className="text-muted text-xs">{label}</div>
      <div
        className={cn(
          'readout mt-1 text-[28px] leading-none font-semibold',
          accent && 'text-primary',
        )}
      >
        {value}
      </div>
      <div className="text-ink-2 mt-1.5 text-xs">{note}</div>
    </div>
  )
}

/** 「使用規則」的一條：圖示＋標題，說明在 ⓘ 提示裡。 */
function Rule({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="text-primary">{icon}</span>
      <span className="flex-1 text-sm">{title}</span>
      <InfoTip text={detail} label={`${title}說明`} side="left" />
    </li>
  )
}
