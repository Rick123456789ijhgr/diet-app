// 控制面板的「影像」分頁：選擇來源（合成／上傳），並疊加模擬退化。
import { ImagePlus, RotateCcw, Sparkles, Upload } from 'lucide-react'
import { useId } from 'react'

import { ApiError, type ConfigClass } from '@/api/client'
import { ParamForm } from '@/components/ParamForm'
import { Badge, Button, DraftNumberInput, Hint, Segmented } from '@/components/ui/primitives'
import { syntheticSource, type ImagePipeline } from '@/hooks/useImagePipeline'
import { SCENES, type SceneField, type SceneId, type SceneParams } from '@/lib/scenes'
import { errorText } from '@/lib/text'

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
  const fileId = useId()
  const { source, setSource, degradation, setDegradation } = pipeline
  const err = pipeline.degraded.error
  const invalid = err instanceof ApiError && err.code === 'INVALID_CONFIG' ? err : undefined

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Segmented
          label="影像來源"
          value={source.kind}
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
            <Badge tone={Object.keys(degradation).length ? 'accent' : 'muted'}>
              {Object.keys(degradation).filter((k) => k !== 'seed').length} 項
            </Badge>
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

const EMPTY = new File([], '')

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
  return field.help ? <Hint text={field.help}>{box}</Hint> : box
}
