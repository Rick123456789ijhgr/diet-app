// 控制面板的「影像」分頁：選擇來源（合成／上傳），並疊加模擬退化。
import { ImagePlus, RotateCcw, Sparkles, Upload } from 'lucide-react'
import { useId } from 'react'

import { ApiError, type ConfigClass, type ConfigOverride } from '@/api/client'
import { ParamForm } from '@/components/ParamForm'
import { Badge, Button, DraftNumberInput, Segmented } from '@/components/ui/primitives'
import {
  DEFAULT_SOURCE,
  DEFAULT_SYNTHETIC,
  type Source,
  type SyntheticParams,
} from '@/hooks/useImagePipeline'
import { errorText } from '@/lib/text'

export function ImageSourcePanel({
  source,
  onSourceChange,
  degradationSchema,
  degradation,
  onDegradationChange,
  degradationError,
}: {
  source: Source
  onSourceChange: (s: Source) => void
  degradationSchema?: ConfigClass
  degradation: ConfigOverride
  onDegradationChange: (d: ConfigOverride) => void
  degradationError?: unknown
}) {
  const fileId = useId()
  const invalid =
    degradationError instanceof ApiError && degradationError.code === 'INVALID_CONFIG'
      ? degradationError
      : undefined

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Segmented
          label="影像來源"
          value={source.kind}
          onChange={(kind) =>
            onSourceChange(kind === 'synthetic' ? DEFAULT_SOURCE : { kind: 'upload', file: EMPTY })
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
          <SyntheticControls
            params={source.params}
            onChange={(params) => onSourceChange({ ...source, params })}
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
                if (file) onSourceChange({ kind: 'upload', file })
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
              {activeCount(degradation)} 項
            </Badge>
          </div>
          <p className="text-muted mb-3 text-xs">
            依序套用：旋轉 → 縮小 → 模糊 → 亮度 → 梯度 → 光斑 → 雜訊
          </p>
          <ParamForm
            schema={degradationSchema}
            overrides={degradation}
            onChange={onDegradationChange}
            invalidField={invalid?.field}
            invalidMessage={invalid && errorText(invalid.code) + '：' + invalid.message}
          />
        </div>
      )}
    </div>
  )
}

const EMPTY = new File([], '')

/** 啟用的退化項目數（種子不算）。 */
function activeCount(d: ConfigOverride): number {
  return Object.keys(d).filter((k) => k !== 'seed').length
}

function SyntheticControls({
  params,
  onChange,
}: {
  params: SyntheticParams
  onChange: (p: SyntheticParams) => void
}) {
  const fields: { key: keyof SyntheticParams; label: string; min: number; max: number }[] = [
    { key: 'height', label: '高', min: 16, max: 4320 },
    { key: 'width', label: '寬', min: 16, max: 7680 },
    { key: 'seed', label: '種子', min: 0, max: 10000 },
  ]
  return (
    <div className="flex items-end gap-2">
      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1 text-xs">
          <span className="text-muted" aria-hidden>
            {f.label}
          </span>
          <DraftNumberInput
            aria-label={f.label}
            min={f.min}
            max={f.max}
            value={params[f.key]}
            parse={(t) => {
              const v = Math.round(Number(t))
              return v >= f.min && v <= f.max ? v : undefined
            }}
            onCommit={(v) => onChange({ ...params, [f.key]: v })}
          />
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        aria-label="還原合成參數"
        onClick={() => onChange(DEFAULT_SYNTHETIC)}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  )
}
