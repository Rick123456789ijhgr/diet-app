// 控制面板的「影像」分頁：選擇來源（合成／上傳），並疊加模擬退化。
import { ImagePlus, RotateCcw, Sparkles, Upload } from 'lucide-react'
import { useId } from 'react'

import { ApiError, type ConfigClass } from '@/api/client'
import { ParamForm } from '@/components/ParamForm'
import { Badge, Button, DraftNumberInput, Hint, Segmented } from '@/components/ui/primitives'
import { syntheticSource, type ImagePipeline } from '@/hooks/useImagePipeline'
import { degradationCount } from '@/lib/config'
import { SCENES, type SceneField, type SceneId, type SceneParams } from '@/lib/scenes'
import { errorText } from '@/lib/text'

/**
 * 控制面板的「影像」分頁。
 * - pipeline：useImagePipeline 的狀態（目前來源、退化覆寫、原圖／退化圖的查詢）。
 * - scene：切換到「合成」時要產生的場景（由所在頁面決定，例如條碼或發票）。
 * - degradationSchema：退化參數的結構；尚未載入時不顯示「模擬退化」區塊。
 */
export function ImageSourcePanel({
  pipeline,
  scene,
  degradationSchema,
}: {
  pipeline: ImagePipeline
  /** 「合成」來源的場景 */
  scene: SceneId
  degradationSchema?: ConfigClass
}) {
  // useId 產生穩定且唯一的 id，讓 <label htmlFor> 對應隱藏的 file input（同頁多個面板也不衝突）
  const fileId = useId()
  const { source, setSource, degradation, setDegradation } = pipeline
  // 已覆寫的退化項目數（不含 seed）；徽章的數字與顏色共用
  const changedDegradations = degradationCount(degradation)
  // 退化參數不合法時，後端回 INVALID_CONFIG 並指出欄位；交給 ParamForm 把該欄標紅
  const err = pipeline.degraded.error
  const invalid = err instanceof ApiError && err.code === 'INVALID_CONFIG' ? err : undefined

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Segmented
          label="影像來源"
          value={source.kind}
          // 切到「上傳」時先放一個空檔案（EMPTY），pipeline 以 size === 0 判斷為「尚未選檔」
          onChange={(kind) =>
            setSource(
              kind === 'synthetic' ? syntheticSource(scene) : { kind: 'upload', file: EMPTY },
            )
          }
          options={[
            {
              value: 'synthetic',
              label: (
                <>
                  <Sparkles className="size-4" aria-hidden />
                  合成
                </>
              ),
            },
            {
              value: 'upload',
              label: (
                <>
                  <Upload className="size-4" aria-hidden />
                  上傳
                </>
              ),
            },
          ]}
          className="w-full"
        />
        {source.kind === 'synthetic' ? (
          <SceneControls
            scene={source.scene}
            params={source.params}
            onChange={(params) => setSource({ ...source, params })}
          />
        ) : (
          // 整個虛線框是 <label>，點擊任何位置都會開啟檔案選擇；input 以 sr-only 視覺隱藏但仍可用鍵盤聚焦
          <label
            htmlFor={fileId}
            className="border-card-border hover:bg-hover flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-5 text-center text-sm"
          >
            <ImagePlus className="text-muted size-6" aria-hidden />
            {source.file.size > 0 ? (
              <span className="font-medium break-all">{source.file.name}</span>
            ) : (
              <span>選擇或拖曳 JPG／PNG</span>
            )}
            <span className="text-muted text-xs">真實照片請勿使用 test split</span>
            <input
              id={fileId}
              type="file"
              accept="image/jpeg,image/png,image/bmp,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                // 使用者取消選檔時 files 為空，保留原本的檔案
                if (file) setSource({ kind: 'upload', file })
              }}
            />
          </label>
        )}
      </div>

      {degradationSchema && (
        <div className="border-card-border border-t pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">模擬退化</h3>
            {/* 已覆寫的退化項目數；seed（亂數種子）本身不是一種退化，不計入數量。
                顏色與數字用同一個計數，只改 seed 時不會呈強調色卻顯示「0 項」 */}
            <Badge tone={changedDegradations ? 'accent' : 'muted'}>{changedDegradations} 項</Badge>
          </div>
          <p className="text-muted mb-3 text-xs">
            依序套用：旋轉 → 縮小 → 模糊 → 亮度 → 梯度 → 光斑 →
            雜訊。旋轉、縮小後合成影像的真值不再適用。
          </p>
          <ParamForm
            schema={degradationSchema}
            overrides={degradation}
            onChange={setDegradation}
            invalidField={invalid?.field}
            invalidMessage={invalid && errorText(invalid.code) + '：' + invalid.message}
          />
        </div>
      )}
    </div>
  )
}

// 「上傳但尚未選檔」的佔位檔案（大小 0）；模組層級常數，避免每次渲染產生新物件
const EMPTY = new File([], '')

/** 合成場景的參數列：依 SCENES[scene].fields 逐欄產生輸入框，右上角可一鍵還原預設。 */
function SceneControls({
  scene,
  params,
  onChange,
}: {
  scene: SceneId
  params: SceneParams
  onChange: (p: SceneParams) => void
}) {
  const def = SCENES[scene]
  const set = (key: string, value: number | string) => onChange({ ...params, [key]: value })
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs">{def.name}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="還原合成參數"
          onClick={() => onChange({ ...def.defaults })}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {def.fields.map((f) => (
          <SceneInput
            key={f.key}
            field={f}
            value={params[f.key]!}
            onChange={(v) => set(f.key, v)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 單一合成參數的輸入框，依 field.kind 選擇文字框、下拉選單或數字框。
 * 可見的標籤設為 aria-hidden，改由輸入框自身的 aria-label 提供名稱，避免螢幕閱讀器念兩次。
 */
function SceneInput({
  field,
  value,
  onChange,
}: {
  field: SceneField
  value: number | string
  onChange: (v: number | string) => void
}) {
  const label = (
    <span className="text-muted" aria-hidden>
      {field.label}
    </span>
  )
  const body =
    field.kind === 'text' ? (
      <input
        aria-label={field.label}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card h-7 rounded-lg border px-2 text-xs focus-visible:outline-none readout w-full"
      />
    ) : field.kind === 'select' ? (
      <select
        aria-label={field.label}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card h-7 rounded-lg border px-2 text-xs focus-visible:outline-none"
      >
        {field.options!.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    ) : (
      <DraftNumberInput
        aria-label={field.label}
        min={field.min}
        max={field.max}
        step={field.step}
        value={Number(value)}
        format={(v) => (field.kind === 'float' ? v.toFixed(2) : String(v))}
        // 把輸入文字轉成數值：int 欄四捨五入；超出 min／max 回傳 undefined，代表輸入不合法、不送出
        parse={(t) => {
          const raw = Number(t)
          const v = field.kind === 'int' ? Math.round(raw) : raw
          return (field.min === undefined || v >= field.min) &&
            (field.max === undefined || v <= field.max)
            ? v
            : undefined
        }}
        onCommit={onChange}
      />
    )
  const box = (
    <div
      className={field.wide ? 'flex w-full flex-col gap-1 text-xs' : 'flex flex-col gap-1 text-xs'}
    >
      {label}
      {body}
    </div>
  )
  // 有說明文字時包一層 Hint（懸停／聚焦顯示提示）
  return field.help ? <Hint text={field.help}>{box}</Hint> : box
}
