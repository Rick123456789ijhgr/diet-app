// 模組一：實驗結果。E1 條碼消融與自適應策略合為一頁，共用同一個結果資料夾。
import { FlaskConical, Gauge } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'

import { KeepAlive } from '@/components/layout/PanelSections'
import { Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import { useDebounced } from '@/hooks/useDebounced'

import { AdaptiveResults } from './AdaptiveResults'
import { E1Results } from './E1Results'

/** 實驗結果的種類；也是網址最後一段（/m1/results/:kind）。順序即切換按鈕的順序。 */
const KINDS = [
  { id: 'e1', name: 'E1 消融', icon: FlaskConical },
  { id: 'adaptive', name: '自適應策略', icon: Gauge },
] as const
type KindId = (typeof KINDS)[number]['id']

const isKind = (v: string | undefined): v is KindId => KINDS.some((k) => k.id === v)

/** 路由入口：網址的種類不合法時導回 E1 消融。 */
export function ResultsPage() {
  const { kind } = useParams()
  if (!isKind(kind)) return <Navigate to="/m1/results/e1" replace />
  return <Results kind={kind} />
}

/**
 * 實驗結果（`/m1/results/:kind`）。
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

  const switcher = (
    <Segmented
      label="結果"
      value={kind}
      onChange={(k) => navigate(`/m1/results/${k}`)}
      options={KINDS.map((k) => ({ value: k.id, label: withIcon(k.icon, k.name) }))}
    />
  )
  const rootProps = { root, setRoot, debouncedRoot }

  return (
    <>
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
