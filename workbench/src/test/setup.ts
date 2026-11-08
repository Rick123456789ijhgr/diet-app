import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'

// jsdom 沒有這些 API；元件只用來量尺寸與量測，測試中給最小實作即可
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

// jsdom 沒有 PointerEvent：fireEvent.pointerDown(el, { clientX }) 會退回一般 Event 而丟掉座標。
// 以 MouseEvent 為底補上（保留 clientX／clientY／button），架構圖的拖曳測試需要座標。
class PointerEventStub extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'mouse'
  }
}
globalThis.PointerEvent ??= PointerEventStub as unknown as typeof PointerEvent

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())
