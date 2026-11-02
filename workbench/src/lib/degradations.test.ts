import { describe, expect, it } from 'vitest'

import { degradationSchema } from '@/test/server'

import { activeFields, primaryFields, removeDegradation, startValue } from './degradations'

const field = (name: string) => degradationSchema.fields.find((f) => f.name === name)!
const names = (fs: { name: string }[]) => fs.map((f) => f.name)

describe('模擬退化面板', () => {
  it('可加入的退化不含種子與依附欄位', () => {
    expect(names(primaryFields(degradationSchema))).toEqual([
      'blur_sigma',
      'rotate_deg',
      'motion_len',
    ])
  })

  it('起始值：有指定時用指定值，否則取範圍中點', () => {
    expect(startValue(field('blur_sigma'))).toBe(2)
    expect(
      startValue({ ...field('blur_sigma'), name: 'unknown', min: 0, max: 9, type: 'int' }),
    ).toBe(5)
  })

  it('列出已覆寫與釘選的欄位；只覆寫依附欄位時列出主欄位', () => {
    expect(
      names(activeFields(degradationSchema, { blur_sigma: 2 }, new Set(['rotate_deg']))),
    ).toEqual(['blur_sigma', 'rotate_deg'])
    expect(names(activeFields(degradationSchema, { motion_angle: 30 }, new Set()))).toEqual([
      'motion_len',
    ])
    expect(activeFields(degradationSchema, { seed: 3 }, new Set())).toEqual([])
  })

  it('移除主欄位時一併移除依附欄位；只剩種子時清掉種子', () => {
    expect(
      removeDegradation({ motion_len: 15, motion_angle: 30, blur_sigma: 2 }, 'motion_len'),
    ).toEqual({
      blur_sigma: 2,
    })
    expect(removeDegradation({ blur_sigma: 2, seed: 7 }, 'blur_sigma')).toEqual({})
  })
})
