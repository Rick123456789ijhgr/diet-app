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

describe('序列欄位與位元組、幾何', () => {
  it('序列欄位與預設值相同時移除覆寫，Python 建構式輸出 tuple', async () => {
    const { ladderSchema } = await import('@/test/server')
    const { setSequence } = await import('./config')
    const o = setSequence(ladderSchema, {}, 'rungs', ['gray'])
    expect(pythonCtor(ladderSchema, o)).toBe("LadderConfig(rungs=('gray',))")
    expect(setSequence(ladderSchema, o, 'rungs', ['raw', 'gray', 'binarize'])).toEqual({})
    expect(pythonCtor(ladderSchema, setSequence(ladderSchema, {}, 'scales', [2]))).toBe(
      'LadderConfig(scales=(2.0,))',
    )
    expect(importJson(ladderSchema, '{"rungs": ["raw"]}')).toEqual({ rungs: ['raw'] })
    expect(() => importJson(ladderSchema, '{"rungs": "raw"}')).toThrow('rungs 必須是陣列')
  })

  it('位元組顯示', async () => {
    const { asciiPreview, fromBase64, hexPreview } = await import('./bytes')
    const big5 = fromBase64('r/m4pg==')
    expect(hexPreview(big5)).toBe('AF F9 B8 A6')
    expect(asciiPreview(Uint8Array.from([0x41, 0xaf, 0x20, 0x7e, 0x0a]))).toBe('A. ~.')
    expect(hexPreview(new Uint8Array(50), 2)).toBe('00 00 …（共 50 bytes）')
  })

  it('四角誤差需要兩邊都是四個點', async () => {
    const { quadErrors } = await import('./geometry')
    const q = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(
      quadErrors(
        q,
        q.map((p) => ({ x: p.x + 3, y: p.y + 4 })),
      ),
    ).toEqual([5, 5, 5, 5])
    expect(quadErrors(q, undefined)).toBeNull()
    expect(quadErrors([], q)).toBeNull()
  })
})

describe('SSE 解析', () => {
  it('切出完整事件，保留未完成的部分', async () => {
    const { parseSse } = await import('./sse')
    const [events, rest] = parseSse(
      'data: {"a":1}\n\nevent: error\ndata: {"code":"X"}\n\ndata: {"b"',
    )
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'error', data: '{"code":"X"}' },
    ])
    expect(rest).toBe('data: {"b"')
    const [more] = parseSse(rest + ':2}\r\n\r\n')
    expect(more).toEqual([{ event: 'message', data: '{"b":2}' }])
  })
})

describe('useStream', () => {
  it('新的執行取代舊的時，舊執行結束不會覆蓋新狀態', async () => {
    const { renderHook, act, waitFor } = await import('@testing-library/react')
    const { http, HttpResponse, delay } = await import('msw')
    const { server } = await import('@/test/server')
    const { useStream } = await import('@/hooks/useStream')
    let call = 0
    server.use(
      http.post('*/test-stream', async () => {
        call += 1
        const n = call
        if (n === 1) await delay(50)
        return new HttpResponse(`data: {"n":${n}}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }),
    )
    const { result } = renderHook(() => useStream<{ n: number }>('/test-stream'))
    await act(async () => {
      void result.current.run({})
      void result.current.run({}) // 立刻再按一次：第一次被取消
    })
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.events).toEqual([{ n: 2 }])
    await new Promise((r) => setTimeout(r, 80)) // 等第一次的請求結束
    expect(result.current.status).toBe('done')
  })
})
