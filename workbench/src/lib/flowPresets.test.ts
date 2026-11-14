import { beforeEach, describe, expect, it } from 'vitest'

import type { ConfigClass } from '@/api/client'

import {
  addCustom,
  armOf,
  EMPTY,
  loadStored,
  mergePresets,
  methodsOf,
  overridesOf,
  presetProblems,
  removeCustom,
  restorePreset,
  savePreset,
  saveStored,
  STORAGE_KEY,
  valuesOf,
  type Preset,
} from './flowPresets'

const preset = (id: string, rungs: string[], extra: Record<string, unknown> = {}): Preset => ({
  id,
  name: id,
  description: `${id} 的說明`,
  arm: {
    name: id,
    description: '',
    decoder: 'zxing',
    zxing: { try_rotate: false },
    ladder: { rungs, scales: [2, 0.5], pipelines: [['denoise', 'binarize']], ...extra },
  },
})
const ALL = preset('all_methods', ['raw', 'multiscale', 'pipeline'])
const RAW = preset('raw_only', ['raw'])
const BUILTINS = [ALL, RAW]

describe('flowPresets', () => {
  beforeEach(() => localStorage.clear())

  it('methodsOf 展開多尺度倍率與疊加流程', () => {
    expect(methodsOf(ALL.arm.ladder)).toEqual([
      'raw',
      'multiscale@2',
      'multiscale@0.5',
      'pipeline@denoise+binarize',
    ])
  })

  it('methodsOf 展開旋轉角度；沒有角度時不能執行', () => {
    const rot = preset('rot', ['rotate', 'pipeline'], {
      angles: [90, -45],
      pipelines: [['multiscale:0.5', 'rotate:90']],
    })
    expect(methodsOf(rot.arm.ladder)).toEqual([
      'rotate@90',
      'rotate@-45',
      'pipeline@multiscale:0.5+rotate:90',
    ])
    expect(presetProblems(preset('x', ['rotate'], { angles: [] }))).toEqual([
      '旋轉至少要有一個角度',
    ])
  })

  it('修改內建方案：標示已修改；改回原樣或還原時移除修改', () => {
    const edited = { ...RAW, arm: { ...RAW.arm, ladder: { ...RAW.arm.ladder, rungs: ['gray'] } } }
    let stored = savePreset(EMPTY, BUILTINS, edited)
    let entries = mergePresets(BUILTINS, stored)
    expect(entries[1]).toMatchObject({ kind: 'builtin', modified: true, preset: edited })
    expect(entries[0]!.modified).toBe(false)

    expect(savePreset(stored, BUILTINS, RAW).edits).toEqual({})
    stored = restorePreset(stored, 'raw_only')
    entries = mergePresets(BUILTINS, stored)
    expect(entries[1]).toMatchObject({ modified: false, preset: RAW })
  })

  it('鍵順序不同不算修改', () => {
    const reordered: Preset = JSON.parse(
      JSON.stringify({ arm: RAW.arm, description: RAW.description, name: RAW.name, id: RAW.id }),
    ) as Preset
    expect(
      mergePresets(BUILTINS, { edits: { raw_only: reordered }, custom: [] })[1]!.modified,
    ).toBe(false)
  })

  it('新增自訂方案：id 不重複、arm 名稱同 id、改副本不影響原方案；刪除時取消選取', () => {
    const a = addCustom(EMPTY, ALL)
    expect(a.id).toBe('custom_1')
    expect(a.stored.selected).toBe('custom_1')
    const copy = a.stored.custom[0]!
    expect(copy.name).toBe('all_methods（副本）')
    expect(copy.arm.name).toBe('custom_1')
    ;(copy.arm.ladder.rungs as string[]).push('gray')
    expect(ALL.arm.ladder.rungs).toEqual(['raw', 'multiscale', 'pipeline'])

    const b = addCustom(a.stored, RAW, '新方案')
    expect(b.id).toBe('custom_2')
    const removed = removeCustom(b.stored, 'custom_2')
    expect(removed.custom.map((c) => c.id)).toEqual(['custom_1'])
    expect(removed.selected).toBeUndefined()
    // 刪掉中間的再新增，不會與剩下的撞號
    expect(addCustom(removeCustom(b.stored, 'custom_1'), RAW).id).toBe('custom_3')
  })

  it('儲存自訂方案：原地取代', () => {
    const { stored } = addCustom(EMPTY, RAW)
    const renamed = { ...stored.custom[0]!, name: '改名' }
    expect(savePreset(stored, BUILTINS, renamed).custom).toEqual([renamed])
  })

  it('armOf：名稱用方案 id、說明用方案說明', () => {
    expect(armOf({ ...RAW, description: '新說明' })).toMatchObject({
      name: 'raw_only',
      description: '新說明',
    })
  })

  it('presetProblems 擋下明顯不能執行的設定', () => {
    expect(presetProblems(ALL)).toEqual([])
    expect(presetProblems({ ...RAW, name: ' ' })).toEqual(['方案名稱不能空白'])
    expect(presetProblems(preset('x', []))).toEqual(['至少要有一個方法'])
    expect(presetProblems(preset('x', ['multiscale'], { scales: [] }))).toEqual([
      '多尺度至少要有一個倍率',
    ])
    expect(presetProblems(preset('x', ['pipeline'], { pipelines: [] }))).toEqual([
      '疊加流程至少要有一條',
    ])
    expect(
      presetProblems(preset('x', ['pipeline'], { pipelines: [['clahe'], ['clahe']] })),
    ).toEqual(['每條疊加流程至少要有兩個步驟', '疊加流程不能重複'])
  })

  it('overridesOf／valuesOf：與結構預設值互轉', () => {
    const schema = {
      name: 'LadderConfig',
      doc: '',
      defaults: { rungs: ['raw'], verify_ean13: true },
      fields: [],
    } as ConfigClass
    const values = { rungs: ['raw', 'gray'], verify_ean13: true }
    const o = overridesOf(schema, values)
    expect(o).toEqual({ rungs: ['raw', 'gray'] })
    expect(valuesOf(schema, o)).toEqual(values)
  })

  it('存取瀏覽器：讀回相同內容；格式不對時回傳空的', () => {
    const { stored } = addCustom(EMPTY, RAW)
    saveStored(stored)
    expect(loadStored()).toEqual(stored)
    localStorage.setItem(STORAGE_KEY, '{壞掉')
    expect(loadStored()).toEqual(EMPTY)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ edits: [], custom: [{ id: 1 }] }))
    expect(loadStored()).toEqual(EMPTY)
  })
})
