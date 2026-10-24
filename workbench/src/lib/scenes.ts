// 合成影像的場景與參數（對應 Python 的 dietai.devtools.scenes.synthesize）。
// 預設值與範圍沿用 Streamlit 版。

/** 合成場景的代碼，與 Python 端 synthesize 的 scene 參數相同。 */
export type SceneId = 'label' | 'ean13' | 'invoice' | 'nutrition' | 'food'
/** 場景參數，原樣送給後端（/dev/images/synthesize 的 params）。 */
export type SceneParams = Record<string, number | string>

/** 場景參數表單的一個欄位（前端手寫；不像設定類別那樣由後端提供結構）。 */
export interface SceneField {
  key: string
  label: string
  kind: 'int' | 'float' | 'text' | 'select'
  min?: number
  max?: number
  step?: number
  options?: string[]
  help?: string
  /** 佔滿一列（文字欄位） */
  wide?: boolean
}

/** 一種合成場景：名稱、參數欄位與預設值。 */
export interface Scene {
  id: SceneId
  name: string
  fields: SceneField[]
  defaults: SceneParams
}

/** 所有合成場景，依 SceneId 查表；min、max、step 為表單輸入的限制。 */
export const SCENES: Record<SceneId, Scene> = {
  label: {
    id: 'label',
    name: '合成標示',
    fields: [
      { key: 'height', label: '高', kind: 'int', min: 16, max: 4320 },
      { key: 'width', label: '寬', kind: 'int', min: 16, max: 7680 },
      { key: 'seed', label: '種子', kind: 'int', min: 0, max: 10000 },
    ],
    defaults: { height: 1080, width: 1920, seed: 0 },
  },
  ean13: {
    id: 'ean13',
    name: '合成 EAN-13',
    fields: [
      { key: 'code', label: '條碼', kind: 'text', help: '13 位數字，檢查碼須正確', wide: true },
      { key: 'module_px', label: '模組寬', kind: 'int', min: 1, max: 12 },
    ],
    defaults: { code: '4710088410108', module_px: 4 },
  },
  invoice: {
    id: 'invoice',
    name: '合成電子發票',
    fields: [
      { key: 'left', label: '左碼內容', kind: 'text', wide: true },
      { key: 'right', label: '右碼內容', kind: 'text', wide: true },
      { key: 'encoding', label: '編碼', kind: 'select', options: ['big5', 'utf-8'] },
      { key: 'module_px', label: '模組寬', kind: 'int', min: 1, max: 12 },
    ],
    // 預設內容含中文品名，切換 encoding 可比較 Big5 與 UTF-8 兩種編碼
    defaults: {
      left: 'AB12345678 茶葉蛋:1:25',
      right: '**鮮奶:1:35',
      encoding: 'big5',
      module_px: 4,
    },
  },
  nutrition: {
    id: 'nutrition',
    name: '合成營養標示',
    fields: [
      {
        key: 'strength',
        label: '透視強度',
        kind: 'float',
        min: 0,
        max: 0.3,
        step: 0.01,
        help: '四角隨機位移的最大比例（相對於標示邊長）；0 為正視。超過 0.25 時可能找不到。',
      },
      { key: 'seed', label: '種子', kind: 'int', min: 0, max: 10000 },
    ],
    defaults: { strength: 0.15, seed: 0 },
  },
  food: {
    id: 'food',
    name: '合成餐桌',
    fields: [
      { key: 'n_dishes', label: '盤數', kind: 'int', min: 0, max: 6 },
      { key: 'seed', label: '種子', kind: 'int', min: 0, max: 10000 },
      {
        key: 'tilt',
        label: '俯拍傾斜',
        kind: 'float',
        min: 0,
        max: 0.6,
        step: 0.05,
        help: '盤子短長軸比隨機介於 1 − 傾斜 與 1；0 為正上方俯拍（正圓）。',
      },
    ],
    defaults: { n_dishes: 3, seed: 0, tilt: 0.3 },
  },
}
