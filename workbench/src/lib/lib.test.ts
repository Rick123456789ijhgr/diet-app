import { describe, expect, it } from 'vitest'

import { degradationSchema, qualitySchema } from '@/test/server'

import {
  ConfigImportError,
  exportJson,
  formatValue,
  importJson,
  pythonCtor,
  setOverride,
} from './config'
import { fitView, toImage, zoomAt } from './viewport'

const blurMin = qualitySchema.fields.find((f) => f.name === 'blur_min')!

describe('設定覆寫', () => {
  it('等於預設值時移除覆寫', () => {
    const changed = setOverride({}, blurMin, 150)
    expect(changed).toEqual({ blur_min: 150 })
    expect(setOverride(changed, blurMin, 100)).toEqual({})
  })

  it('Python 建構式只列出修改的欄位，float 補上小數點', () => {
    expect(pythonCtor(qualitySchema, {})).toBe('QualityConfig()')
    expect(pythonCtor(qualitySchema, { blur_min: 150, min_short_side: 720 })).toBe(
      'QualityConfig(blur_min=150.0, min_short_side=720)',
    )
  })

  it('匯出後再匯入得到相同的覆寫', () => {
    const overrides = { blur_min: 150, dark_level: 40 }
    const text = exportJson(qualitySchema, overrides)
    expect(JSON.parse(text).class).toBe('QualityConfig')
    expect(importJson(qualitySchema, text)).toEqual(overrides)
  })

  it('也接受扁平 JSON', () => {
    expect(importJson(qualitySchema, '{"blur_min": 50}')).toEqual({ blur_min: 50 })
  })

  it.each([
    ['{bad', '不是合法的 JSON'],
    ['[1]', '設定 JSON 必須是物件'],
    ['{"class": "LadderConfig", "values": {}}', '設定類別不符'],
    ['{"nope": 1}', '沒有欄位 nope'],
    ['{"min_short_side": 1.5}', 'min_short_side 必須是 int'],
    ['{"blur_min": "x"}', 'blur_min 必須是 float'],
  ])('匯入 %s 時報錯', (text, message) => {
    expect(() => importJson(qualitySchema, text)).toThrow(ConfigImportError)
    expect(() => importJson(qualitySchema, text)).toThrow(message)
  })

  it('依 step 決定小數位數', () => {
    const sigma = degradationSchema.fields[0]!
    expect(formatValue(sigma, 1)).toBe('1.0')
    expect(formatValue(blurMin, 150)).toBe('150')
    expect(
      formatValue(
        qualitySchema.fields.find((f) => f.name === 'dark_ratio_max')!,
        0.5,
      ),
    ).toBe('0.50')
  })
})

describe('影像檢視器的縮放', () => {
  it('置中放進容器，不放大超過原尺寸', () => {
    expect(fitView(1000, 500, 2000, 1000)).toEqual({ scale: 0.5, x: 0, y: 0 })
    expect(fitView(1000, 500, 100, 50)).toEqual({ scale: 1, x: 450, y: 225 })
  })

  it('以游標為中心縮放時，游標下的影像位置不變', () => {
    const view = fitView(1000, 500, 2000, 1000)
    const before = toImage(view, 300, 200)
    const zoomed = zoomAt(view, 300, 200, 4)
    expect(zoomed.scale).toBe(2)
    expect(toImage(zoomed, 300, 200)).toEqual(before)
  })
})
