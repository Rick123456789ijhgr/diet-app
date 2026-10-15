// 草稿表單：基本欄位與營養標示表格（八項 × 每份、每 100）。
// 輸入一律保留原字串，空白代表未填；只標示「不是數字」與後端回報的缺少欄位，不檢查數值一致性。
import type { Dispatch, SetStateAction } from 'react'

import type { ContentUnit } from '@/api/client'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import {
  BASES,
  basisLabel,
  fieldEmpty,
  inMissing,
  NUTRIENT_KEYS,
  nutrientLabel,
  type Basis,
  type FormValues,
  type NutrientKey,
} from '@/lib/coldstart'
import { nutrientText } from '@/lib/text'

import { Field, inputClass, TextInput } from './common'

type SimpleKey = Exclude<keyof FormValues, 'per_serving' | 'per_100' | 'content_unit'>

export function DraftForm({
  form,
  setForm,
  readOnly,
  invalid,
  missing,
  decodedBarcodes,
}: {
  form: FormValues
  setForm: Dispatch<SetStateAction<FormValues>>
  readOnly: boolean
  /** 無法辨識為數字的欄位路徑 */
  invalid: readonly string[]
  /** 確認時後端回報缺少的欄位路徑 */
  missing: readonly string[]
  /** 條碼照片解出的條碼（供人確認後填入） */
  decodedBarcodes: string[]
}) {
  const problem = (path: string): string | undefined => {
    if (invalid.includes(path)) return '不是合法的數字'
    if (inMissing(missing, path) && fieldEmpty(form, path)) return '必填'
    return undefined
  }
  const simple = (key: SimpleKey, label: string, numeric = false, className?: string) => {
    const error = problem(key)
    return (
      <Field label={label} error={error} className={className}>
        <TextInput
          name={key}
          value={form[key]}
          readOnly={readOnly}
          inputMode={numeric ? 'decimal' : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            const v = e.target.value
            setForm((f) => ({ ...f, [key]: v }))
          }}
        />
      </Field>
    )
  }
  const unitError = problem('content_unit')
  const suggestions = decodedBarcodes.filter((b) => b !== form.barcode.trim())

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-col gap-1">
          {simple('barcode', '條碼')}
          {!readOnly && suggestions.length > 0 && (
            <div className="text-muted flex flex-wrap items-center gap-2 text-xs">
              條碼照片解出：
              {suggestions.map((b) => (
                <Button
                  key={b}
                  size="sm"
                  variant="ghost"
                  className="tabular"
                  onClick={() => setForm((f) => ({ ...f, barcode: b }))}
                >
                  填入 {b}
                </Button>
              ))}
            </div>
          )}
        </div>
        {simple('name', '品名', false, 'col-span-2')}
        {simple('brand', '品牌', false, 'col-span-2')}
        {simple('net_content', '淨重或容量', true)}
        <Field label="單位" error={unitError}>
          <select
            name="content_unit"
            value={form.content_unit}
            disabled={readOnly}
            aria-invalid={unitError ? true : undefined}
            className={inputClass}
            onChange={(e) => {
              const v = e.target.value as '' | ContentUnit
              setForm((f) => ({ ...f, content_unit: v }))
            }}
          >
            <option value="">（未選）</option>
            <option value="g">公克（g）</option>
            <option value="ml">毫升（ml）</option>
          </select>
        </Field>
        {simple('serving_size', '每份份量', true)}
        {simple('servings_per_package', '每包裝份數', true)}
      </div>

      <table className="w-full text-sm" aria-label="營養標示">
        <thead>
          <tr className="text-muted border-card-border border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">項目</th>
            {BASES.map((b) => (
              <th
                key={b}
                className={cn(
                  'py-2 pr-3 font-medium',
                  inMissing(missing, `nutrition.${b}`) && 'text-danger',
                )}
              >
                {basisLabel(b, form.content_unit)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NUTRIENT_KEYS.map((k) => (
            <tr key={k} className="border-card-border border-b last:border-0">
              <td className="py-1.5 pr-3">{nutrientLabel(k)}</td>
              {BASES.map((b) => (
                <td key={b} className="py-1.5 pr-3">
                  <NutrientInput
                    basis={b}
                    nutrient={k}
                    label={`${basisLabel(b, form.content_unit)}・${nutrientText(k)}`}
                    value={form[b][k]}
                    readOnly={readOnly}
                    error={problem(`nutrition.${b}.${k}`)}
                    onChange={(v) => setForm((f) => ({ ...f, [b]: { ...f[b], [k]: v } }))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NutrientInput({
  basis,
  nutrient,
  label,
  value,
  readOnly,
  error,
  onChange,
}: {
  basis: Basis
  nutrient: NutrientKey
  label: string
  value: string
  readOnly: boolean
  error?: string
  onChange: (v: string) => void
}) {
  return (
    <TextInput
      name={`nutrition.${basis}.${nutrient}`}
      aria-label={label}
      title={error}
      inputMode="decimal"
      className="tabular text-right"
      value={value}
      readOnly={readOnly}
      aria-invalid={error ? true : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
