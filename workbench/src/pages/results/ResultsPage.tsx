// 模組一：實驗結果。找最佳流程（預設）與進階的 E1 條碼消融、自適應策略合為一頁，共用同一個結果資料夾。
import { FlaskConical, Gauge, Microscope, Trophy } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'

import { KeepAlive } from '@/components/layout/PanelSections'
import { Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useDebounced } from '@/hooks/useDebounced'

import { AdaptiveResults } from './AdaptiveResults'
import { BestFlow } from './BestFlow'
import { E1Results } from './E1Results'

/** 實驗結果的種類；也是網址最後一段（/m1/results/:kind）。 */
const KINDS = [
  { id: 'best', name: '找最佳流程', icon: Trophy },
  { id: 'e1', name: 'E1 消融', icon: FlaskConical },
  { id: 'adaptive', name: '自適應策略', icon: Gauge },
] as const
type KindId = (typeof KINDS)[number]['id']
/** 收在「進階」之下的種類（研究用，需要手寫 manifest 或命令列腳本產生的結果）。順序即切換按鈕的順序。 */
const ADVANCED = KINDS.filter((k) => k.id !== 'best')

const isKind = (v: string | undefined): v is KindId => KINDS.some((k) => k.id === v)

/** 路由入口：網址的種類不合法時導回找最佳流程。 */
export function ResultsPage() {
  const { kind } = useParams()
  if (!isKind(kind)) return <Navigate to="/m1/results/best" replace />
  return <Results kind={kind} />
}

/**
 * 實驗結果（`/m1/results/:kind`）：找最佳流程（best），進階為 E1 消融（e1）與自適應策略（adaptive）。
 * - 結果資料夾兩種共用：換了資料夾，切到另一種也讀同一個資料夾。
 * - 去過的種類保持掛載（KeepAlive），切換時保留選取；快速執行中切走也不會中斷。
 */
function Results({ kind }: { kind: KindId }) {
  const navigate = useNavigate()
  // 空字串代表用後端預設路徑；打字時以 400 ms 防抖，避免每個字元都重新列出資料夾
  const [root, setRoot] = useState('')
  const debouncedRoot = useDebounced(root, 400)
  const [visited, setVisited] = useState<ReadonlySet<KindId>>(new Set([kind]))
  if (!visited.has(kind)) setVisited(new Set(visited).add(kind))

  // 頂層只分「找最佳流程」與「進階」；進階再分 E1 消融與自適應策略
  const [lastAdvanced, setLastAdvanced] = useState<KindId>('e1')
  if (kind !== 'best' && kind !== lastAdvanced) setLastAdvanced(kind)
  const switcher = (
    <div className="flex items-center gap-2">
      <Segmented
        label="結果"
        value={kind === 'best' ? 'best' : 'advanced'}
        onChange={(v) => navigate(`/m1/results/${v === 'best' ? 'best' : lastAdvanced}`)}
        options={[
          { value: 'best', label: withIcon(Trophy, '找最佳流程') },
          { value: 'advanced', label: withIcon(Microscope, '進階') },
        ]}
      />
      {kind !== 'best' && (
        <Segmented
          label="進階結果"
          value={kind}
          onChange={(k) => navigate(`/m1/results/${k}`)}
          options={ADVANCED.map((k) => ({ value: k.id, label: withIcon(k.icon, k.name) }))}
        />
      )}
    </div>
  )
  const rootProps = { root, setRoot, debouncedRoot }

  return (
    <>
      {visited.has('best') && (
        <KeepAlive active={kind === 'best'}>
          <BestFlow switcher={switcher} {...rootProps} />
        </KeepAlive>
      )}
      {visited.has('e1') && (
        <KeepAlive active={kind === 'e1'}>
          <E1Results switcher={switcher} {...rootProps} />
        </KeepAlive>
      )}
      {visited.has('adaptive') && (
        <KeepAlive active={kind === 'adaptive'}>
          <AdaptiveResults switcher={switcher} {...rootProps} />
        </KeepAlive>
      )}
    </>
  )
}
