import { describe, expect, it } from 'vitest'

import {
  answerFromName,
  checkCode,
  normalizeCode,
  splitName,
  truthsOf,
  uploadIds,
  validCode,
} from './barcodeTruth'

describe('條碼號碼檢查', () => {
  it('去除空白，12 位補成 13 位', () => {
    expect(normalizeCode(' 4710 0884 10108 ')).toBe('4710088410108')
    expect(normalizeCode('036000291452')).toBe('0036000291452')
  })

  it('EAN-13、UPC-A（補成 13 位）與 EAN-8 的檢查碼', () => {
    expect(validCode('4710088410108')).toBe(true)
    expect(validCode('4710088410109')).toBe(false)
    expect(validCode(normalizeCode('036000291452'))).toBe(true)
    expect(validCode('96385074')).toBe(true)
    expect(validCode('96385075')).toBe(false)
    expect(validCode('123')).toBe(false)
  })

  it('顯示給使用者的狀態', () => {
    expect(checkCode('')).toMatchObject({ ok: false, message: '輸入條碼號碼' })
    expect(checkCode('47a')).toMatchObject({ ok: false, message: '只能輸入數字' })
    expect(checkCode('4710088')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^7 位/),
    })
    expect(checkCode('4710088410109')).toMatchObject({ ok: false })
    expect(checkCode('4710088410108')).toEqual({
      code: '4710088410108',
      ok: true,
      message: 'EAN-13 檢查碼正確',
    })
  })
})

describe('檔名與答案', () => {
  it('拆副檔名', () => {
    expect(splitName('a.b.JPG')).toEqual({ stem: 'a.b', ext: '.JPG' })
    expect(splitName('noext')).toEqual({ stem: 'noext', ext: '' })
    expect(splitName('.hidden')).toEqual({ stem: '.hidden', ext: '' })
  })

  it('由檔名推回答案：號碼（可帶序號）、沒有條碼、其他', () => {
    expect(answerFromName('4710088410108.jpg')).toEqual({ kind: 'code', code: '4710088410108' })
    expect(answerFromName('4710088410108_2.png')).toEqual({ kind: 'code', code: '4710088410108' })
    expect(answerFromName('036000291452 (1).jpg')).toEqual({
      kind: 'code',
      code: '0036000291452',
    })
    expect(answerFromName('沒有條碼_IMG_1.jpg')).toEqual({ kind: 'none' })
    // 檢查碼錯誤、或號碼後面直接接其他數字，都不當成條碼
    expect(answerFromName('4710088410109.jpg')).toBeNull()
    expect(answerFromName('47100884101081.jpg')).toBeNull()
    expect(answerFromName('IMG_2041.jpg')).toBeNull()
  })

  it('上傳後的圖片 ID：同名的加 #2、#3（與後端相同）', () => {
    expect(uploadIds(['a.jpg', 'b.jpg', 'a.jpg', 'a.jpg'])).toEqual([
      'a.jpg',
      'b.jpg',
      'a.jpg#2',
      'a.jpg#3',
    ])
  })

  it('人工真值只送條碼與沒有條碼', () => {
    expect(
      truthsOf(
        ['x.jpg', 'y.jpg', 'z.jpg', 'w.jpg'],
        [{ kind: 'code', code: '4710088410108' }, { kind: 'none' }, { kind: 'skip' }, null],
      ),
    ).toEqual({ 'x.jpg': '4710088410108', 'y.jpg': '' })
  })
})
