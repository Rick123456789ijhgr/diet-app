// 模組一：單張檢視。一張影像（合成或上傳）＋一組模擬退化，切換任務看各前處理的結果。
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'

import type { ConfigOverride } from '@/api/client'
import { useConfigClass } from '@/hooks/useConfigSchemas'
import { syntheticSource, useImagePipeline } from '@/hooks/useImagePipeline'
import type { SceneId, SceneParams } from '@/lib/scenes'

import { BarcodeTask, type LadderBody } from './BarcodeTask'
import { FoodTask } from './FoodTask'
import { LabelTask } from './LabelTask'
import { QualityTask } from './QualityTask'
import { isTaskId, TASK_BY_ID, type InspectShared, type TaskId } from './shared'

/** 各任務的處理參數覆寫；條碼與發票 QR 共用同一組階梯與解碼器參數。 */
interface Configs {
  quality: ConfigOverride
  ladder: LadderBody
  label: ConfigOverride
  food: ConfigOverride
}

const EMPTY_CONFIGS: Configs = {
  quality: {},
  ladder: { ladder: {}, zxing: {} },
  label: {},
  food: {},
}

/** 路由入口：網址的任務不合法時導回品質檢查。 */
export function InspectPage() {
  const { task } = useParams()
  if (!isTaskId(task)) return <Navigate to="/m1/inspect/quality" replace />
  return <Inspect task={task} />
}

/**
 * 單張檢視（`/m1/inspect/:task`）。
 *
 * 狀態都放在這一層，切換任務時保留：
 * - 影像管線（來源與模擬退化）：上傳的照片與退化設定在各任務間共用。
 *   合成來源則換成該任務的場景，各場景改過的參數會記住，切回來時還原。
 * - 各任務的處理參數覆寫（`Configs`）。
 *
 * 任務在網址中，切換任務只改網址；同一個路由元素不會重新掛載，狀態因此保留。
 */
function Inspect({ task }: { task: TaskId }) {
  const navigate = useNavigate()
  const degradationSchema = useConfigClass('Degradation').schema
  const scene = TASK_BY_ID[task].scene
  const pipeline = useImagePipeline(scene)
  const [configs, setConfigs] = useState<Configs>(EMPTY_CONFIGS)
  // 各合成場景改過的參數；切換任務時保存目前場景、還原目標場景
  const [sceneParams, setSceneParams] = useState<Partial<Record<SceneId, SceneParams>>>({})
  const [shownScene, setShownScene] = useState(scene)
  // 換場景後、新影像回來前為 true：這段期間不把舊場景的影像交給新任務分析
  const [switching, setSwitching] = useState(false)
  const [paramsOpen, setParamsOpen] = useState(false)

  // 任務（網址）改變時，在渲染期間就把合成來源換成新場景（React 允許在渲染中更新自身的 state）
  if (shownScene !== scene) {
    setShownScene(scene)
    const { source } = pipeline
    if (source.kind === 'synthetic' && source.scene !== scene) {
      setSceneParams({ ...sceneParams, [source.scene]: source.params })
      const saved = sceneParams[scene]
      pipeline.setSource(
        saved ? { kind: 'synthetic', scene, params: saved } : syntheticSource(scene),
      )
      setSwitching(true)
    }
  }
  // setSource 之後 pending 立即為 true（來源防抖中），直到新的原圖與退化圖都回來
  if (switching && !pipeline.pending) setSwitching(false)

  const shared: InspectShared = {
    task,
    pipeline: switching ? { ...pipeline, image: undefined } : pipeline,
    degradationSchema,
    onTaskChange: (t) => navigate(`/m1/inspect/${t}`),
    paramsOpen,
    setParamsOpen,
  }
  const update =
    <K extends keyof Configs>(key: K) =>
    (value: Configs[K]) =>
      setConfigs((c) => ({ ...c, [key]: value }))

  switch (task) {
    case 'quality':
      return <QualityTask shared={shared} config={configs.quality} setConfig={update('quality')} />
    case 'barcode':
    case 'invoice':
      // key：兩種模式的檢視分頁不同，切換時重設任務內的檢視狀態
      return (
        <BarcodeTask
          key={task}
          shared={shared}
          mode={task}
          body={configs.ladder}
          setBody={update('ladder')}
        />
      )
    case 'label':
      return <LabelTask shared={shared} config={configs.label} setConfig={update('label')} />
    case 'food':
      return <FoodTask shared={shared} config={configs.food} setConfig={update('food')} />
  }
}
