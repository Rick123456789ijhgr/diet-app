// 模組一：多張測試。參數掃描（一種退化由弱到強）與資料夾批次（整個資料夾跑品質檢查）合為一頁。
import { Images, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'

import type { ConfigOverride } from '@/api/client'
import { KeepAlive } from '@/components/layout/PanelSections'
import { Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'

import { FolderMode } from './FolderMode'
import { SweepMode } from './SweepMode'

/** 多張測試的模式；也是網址最後一段（/m1/multi/:mode）。順序即切換按鈕的順序。 */
const MODES = [
  { id: 'sweep', name: '參數掃描', icon: TrendingUp },
  { id: 'folder', name: '資料夾批次', icon: Images },
] as const
type ModeId = (typeof MODES)[number]['id']

const isMode = (v: string | undefined): v is ModeId => MODES.some((m) => m.id === v)

/** 路由入口：網址的模式不合法時導回參數掃描。 */
export function MultiPage() {
  const { mode } = useParams()
  if (!isMode(mode)) return <Navigate to="/m1/multi/sweep" replace />
  return <Multi mode={mode} />
}

/**
 * 多張測試（`/m1/multi/:mode`）。
 * - 品質門檻（QualityConfig 覆寫）兩種模式共用：在掃描中調好的門檻，切到資料夾批次直接沿用。
 * - 去過的模式保持掛載（KeepAlive），切換時保留各自的設定與結果；執行中的批次不會因切走而中斷。
 */
function Multi({ mode }: { mode: ModeId }) {
  const navigate = useNavigate()
  const [config, setConfig] = useState<ConfigOverride>({})
  const [visited, setVisited] = useState<ReadonlySet<ModeId>>(new Set([mode]))
  // 網址換到沒去過的模式時，在渲染期間記下（React 允許在渲染中更新自身的 state）
  if (!visited.has(mode)) setVisited(new Set(visited).add(mode))

  const switcher = (
    <Segmented
      label="模式"
      value={mode}
      onChange={(m) => navigate(`/m1/multi/${m}`)}
      options={MODES.map((m) => ({ value: m.id, label: withIcon(m.icon, m.name) }))}
    />
  )

  return (
    <>
      {visited.has('sweep') && (
        <KeepAlive active={mode === 'sweep'}>
          <SweepMode
            active={mode === 'sweep'}
            switcher={switcher}
            config={config}
            setConfig={setConfig}
          />
        </KeepAlive>
      )}
      {visited.has('folder') && (
        <KeepAlive active={mode === 'folder'}>
          <FolderMode switcher={switcher} config={config} setConfig={setConfig} />
        </KeepAlive>
      )}
    </>
  )
}
