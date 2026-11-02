// 單張檢視的共用部分：任務清單、左側控制面板（影像 → 模擬退化 → 處理參數）與頁面外框。
// 各任務（品質、條碼、發票 QR、營養標示、食物）共用同一張影像與同一組退化，只換分析與結果區。
import {
  ArrowLeftRight,
  Barcode,
  QrCode,
  ReceiptText,
  ScanSearch,
  SlidersHorizontal,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { ApiError, type ConfigClass } from '@/api/client'
import { DegradationPicker } from '@/components/DegradationPicker'
import { ImageSourcePanel } from '@/components/ImageSourcePanel'
import { Disclosure, PanelSection, PanelStack } from '@/components/layout/PanelSections'
import { Workspace } from '@/components/layout/Workspace'
import { Badge, Segmented } from '@/components/ui/primitives'
import { withIcon } from '@/components/ui/withIcon'
import type { ImagePipeline } from '@/hooks/useImagePipeline'
import type { SceneId } from '@/lib/scenes'
import { errorText } from '@/lib/text'

/** 單張檢視的任務；也是網址最後一段（/m1/inspect/:task）。 */
export type TaskId = 'quality' | 'barcode' | 'invoice' | 'label' | 'food'

/** 任務：名稱、圖示、合成來源用的場景、標題列下方的一句說明。 */
export interface Task {
  id: TaskId
  name: string
  icon: LucideIcon
  scene: SceneId
  description: string
}

/** 任務清單，順序即切換按鈕的順序。 */
export const TASKS: Task[] = [
  {
    id: 'quality',
    name: '品質檢查',
    icon: ScanSearch,
    scene: 'label',
    description: '這張照片夠不夠清楚、曝光是否正常、解析度夠不夠。',
  },
  {
    id: 'barcode',
    name: '商品條碼',
    icon: Barcode,
    scene: 'ean13',
    description: '依序嘗試原圖與各種處理後的影像，直到讀出條碼。',
  },
  {
    id: 'invoice',
    name: '發票 QR',
    icon: QrCode,
    scene: 'invoice',
    description: '找出電子發票左右兩個 QR 並讀出原始內容。',
  },
  {
    id: 'label',
    name: '營養標示',
    icon: ReceiptText,
    scene: 'nutrition',
    description: '找出表格四角並拉正，再處理反光與對比。',
  },
  {
    id: 'food',
    name: '食物照片',
    icon: UtensilsCrossed,
    scene: 'food',
    description: '切出各道菜、找出盤緣，並縮成送給 VLM 的大小。',
  },
]

export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t])) as Record<TaskId, Task>

export function isTaskId(v: string | undefined): v is TaskId {
  return !!v && v in TASK_BY_ID
}

/** 頁面傳給各任務的共用狀態：目前任務、影像管線、退化結構、切換任務、參數區是否展開。 */
export interface InspectShared {
  task: TaskId
  pipeline: ImagePipeline
  degradationSchema?: ConfigClass
  onTaskChange: (t: TaskId) => void
  /** 處理參數區是否展開；放在頁面層，切換任務時維持 */
  paramsOpen: boolean
  setParamsOpen: (open: boolean) => void
}

/**
 * 單張檢視的頁面外框，由各任務元件呼叫：
 * - 左側控制面板：影像來源 → 模擬退化（各任務共用）→ 此任務的處理參數（預設收合）。
 * - 標題列：任務說明＋計算中標示＋任務切換。
 * - children：任務的主檢視與讀數（通常是 AnalysisFrame＋Split）。
 */
export function InspectWorkspace({
  shared,
  params,
  io,
  changed,
  busy,
  children,
}: {
  shared: InspectShared
  /** 此任務的處理參數表單 */
  params: ReactNode
  /** 此任務的設定匯入／匯出 */
  io: ReactNode
  /** 處理參數修改的項目數 */
  changed: number
  /** 影像或分析還在計算 */
  busy: boolean
  children: ReactNode
}) {
  const { task, pipeline, degradationSchema } = shared
  // 退化參數不合法時，後端回 INVALID_CONFIG 並指出欄位，交給退化面板標紅
  const err = pipeline.degraded.error
  const invalid = err instanceof ApiError && err.code === 'INVALID_CONFIG' ? err : undefined
  const [ioOpen, setIoOpen] = useState(false)

  const panel = (
    <PanelStack>
      <PanelSection title="影像">
        <ImageSourcePanel pipeline={pipeline} scene={TASK_BY_ID[task].scene} />
      </PanelSection>
      {degradationSchema && (
        <PanelSection>
          <DegradationPicker
            schema={degradationSchema}
            overrides={pipeline.degradation}
            onChange={pipeline.setDegradation}
            invalidField={invalid?.field}
            invalidMessage={invalid && errorText(invalid.code) + '：' + invalid.message}
          />
        </PanelSection>
      )}
      <Disclosure
        open={shared.paramsOpen}
        onOpenChange={shared.setParamsOpen}
        icon={SlidersHorizontal}
        title={`${TASK_BY_ID[task].name}參數`}
        badge={changed > 0 && <Badge tone="primary">已改 {changed} 項</Badge>}
      >
        {params}
      </Disclosure>
      <Disclosure
        open={ioOpen}
        onOpenChange={setIoOpen}
        icon={ArrowLeftRight}
        title="匯入／匯出設定"
      >
        {io}
      </Disclosure>
    </PanelStack>
  )

  return (
    <Workspace
      panel={panel}
      title="單張檢視"
      description={TASK_BY_ID[task].description}
      aside={
        <div className="flex items-center gap-2">
          {busy && (
            <Badge tone="primary" aria-live="polite">
              計算中…
            </Badge>
          )}
          <Segmented
            label="任務"
            value={task}
            onChange={shared.onTaskChange}
            options={TASKS.map((t) => ({ value: t.id, label: withIcon(t.icon, t.name) }))}
          />
        </div>
      }
    >
      {children}
    </Workspace>
  )
}
