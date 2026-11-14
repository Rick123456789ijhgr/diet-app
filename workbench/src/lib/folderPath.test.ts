import { beforeEach, describe, expect, it } from 'vitest'

import { folderName, loadRecent, MAX_RECENT, pathSegments, rememberRecent } from './folderPath'

describe('pathSegments', () => {
  it('起點只有本機', () => {
    expect(pathSegments('')).toEqual([{ name: '本機', path: '' }])
  })

  it('Windows 路徑：磁碟機、各層資料夾；結尾的分隔符號略過', () => {
    expect(pathSegments('D:\\photos\\food\\')).toEqual([
      { name: '本機', path: '' },
      { name: 'D:', path: 'D:\\' },
      { name: 'photos', path: 'D:\\photos' },
      { name: 'food', path: 'D:\\photos\\food' },
    ])
    expect(pathSegments('d:\\')).toEqual([
      { name: '本機', path: '' },
      { name: 'D:', path: 'd:\\' },
    ])
  })

  it('Windows 路徑以 / 分隔時沿用 /', () => {
    expect(pathSegments('D:/data/e1').map((s) => s.path)).toEqual([
      '',
      'D:/',
      'D:/data',
      'D:/data/e1',
    ])
  })

  it('POSIX 路徑', () => {
    expect(pathSegments('/home/rick').map((s) => [s.name, s.path])).toEqual([
      ['本機', ''],
      ['/', '/'],
      ['home', '/home'],
      ['rick', '/home/rick'],
    ])
  })

  it('folderName 取最後一段', () => {
    expect(folderName('D:\\photos\\food')).toBe('food')
    expect(folderName('D:\\')).toBe('D:')
    expect(folderName('')).toBe('')
  })
})

describe('最近使用', () => {
  beforeEach(() => localStorage.clear())

  it('新的在前、不重複、有上限；格式不對時當作沒有', () => {
    for (let i = 0; i < MAX_RECENT + 2; i++) rememberRecent(`D:\\${i}`)
    rememberRecent('D:\\3')
    const recent = loadRecent()
    expect(recent).toHaveLength(MAX_RECENT)
    expect(recent[0]).toBe('D:\\3')
    expect(new Set(recent).size).toBe(recent.length)
    localStorage.setItem('wb.folderPicker.recent', '{壞')
    expect(loadRecent()).toEqual([])
  })
})
