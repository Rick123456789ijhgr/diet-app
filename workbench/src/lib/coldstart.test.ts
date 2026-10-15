import { describe, expect, it } from 'vitest'

import {
  draftToForm,
  fieldEmpty,
  fieldLabel,
  formToDraft,
  inMissing,
  parseNumber,
  per100Label,
  sameDraft,
} from './coldstart'

describe('表單與草稿的轉換', () => {
  it('空白欄位省略（不送 0），文字去頭尾空白，數字照輸入轉換', () => {
    const form = draftToForm({})
    form.name = '  綠茶 '
    form.content_unit = 'ml'
    form.serving_size = '250'
    form.per_100.sodium_mg = '0'
    form.per_serving.sugar_g = '0.50'
    expect(formToDraft(form)).toEqual({
      draft: {
        name: '綠茶',
        content_unit: 'ml',
        serving_size: 250,
        nutrition: { per_serving: { sugar_g: 0.5 }, per_100: { sodium_mg: 0 } },
      },
      invalid: [],
    })
  })

  it('無法辨識的數字列為 invalid，不放進草稿', () => {
    const form = draftToForm({})
    form.net_content = '1,000'
    form.per_100.fat_g = '1e3'
    const { draft, invalid } = formToDraft(form)
    expect(invalid).toEqual(['net_content', 'nutrition.per_100.fat_g'])
    expect(draft).toEqual({})
  })

  it('草稿 → 表單 → 草稿保持不變', () => {
    const draft = {
      barcode: '4710088410108',
      name: '餅乾',
      net_content: 120,
      content_unit: 'g' as const,
      nutrition: { per_100: { energy_kcal: 512, sodium_mg: 300 } },
    }
    const form = draftToForm(draft)
    expect(form.net_content).toBe('120')
    expect(form.per_serving.energy_kcal).toBe('')
    expect(formToDraft(form).draft).toEqual(draft)
  })

  it('parseNumber：空白為 undefined，其餘格式為 NaN', () => {
    expect(parseNumber('  ')).toBeUndefined()
    expect(parseNumber('.5')).toBe(0.5)
    expect(parseNumber('12.')).toBe(12)
    expect(parseNumber('0x10')).toBeNaN()
    expect(parseNumber('１２')).toBeNaN()
  })

  it('sameDraft 忽略鍵的順序與空物件', () => {
    expect(sameDraft({ name: 'a', nutrition: {} }, { name: 'a' })).toBe(true)
    expect(
      sameDraft(
        { nutrition: { per_100: { fat_g: 1, sugar_g: 2 } }, name: 'a' },
        { name: 'a', nutrition: { per_100: { sugar_g: 2, fat_g: 1 }, per_serving: {} } },
      ),
    ).toBe(true)
    expect(sameDraft({ name: 'a' }, { name: 'b' })).toBe(false)
  })
})

describe('缺少欄位的對應', () => {
  it('missing 的上層路徑涵蓋其下各項', () => {
    expect(inMissing(['nutrition.per_100'], 'nutrition.per_100.sodium_mg')).toBe(true)
    expect(inMissing(['nutrition.per_100'], 'nutrition.per_serving.sodium_mg')).toBe(false)
    expect(inMissing(['name'], 'name')).toBe(true)
    expect(inMissing(['name'], 'name_en')).toBe(false)
  })

  it('fieldEmpty 依路徑檢查表單欄位', () => {
    const form = draftToForm({ name: '餅乾', nutrition: { per_100: { fat_g: 1 } } })
    expect(fieldEmpty(form, 'name')).toBe(false)
    expect(fieldEmpty(form, 'brand')).toBe(true)
    expect(fieldEmpty(form, 'nutrition.per_100.fat_g')).toBe(false)
    expect(fieldEmpty(form, 'nutrition.per_100.sodium_mg')).toBe(true)
    expect(fieldEmpty(form, 'nutrition.per_100')).toBe(true)
  })

  it('中文名稱：每 100 的單位依公克或毫升', () => {
    expect(fieldLabel('nutrition.per_100.sodium_mg', 'ml')).toBe('營養標示（每 100 毫升）：鈉')
    expect(fieldLabel('nutrition.per_serving.sugar_g')).toBe('營養標示（每份）：糖')
    expect(fieldLabel('images.label')).toBe('營養標示照片')
    expect(fieldLabel('net_content')).toBe('淨重或容量')
    expect(fieldLabel('unknown_field')).toBe('unknown_field')
    expect(per100Label('g')).toBe('每 100 公克')
    expect(per100Label('')).toBe('每 100 公克或毫升')
  })
})
