// 介面文字：工作台標籤只寫中文；代碼維持英文，在這裡對應中文。

/** 前處理警告（PreprocessWarning）。APP 端另有自己的對照，不共用。 */
export const WARNING_TEXT: Record<string, string> = {
  TOO_BLURRY: '過於模糊',
  TOO_DARK: '過暗',
  TOO_BRIGHT: '過亮',
  LOW_RESOLUTION: '解析度不足',
  BARCODE_NOT_FOUND: '找不到條碼',
  BARCODE_UNCONFIRMED: '條碼結果未經確認',
  INVOICE_QR_PARTIAL: '只找到一個發票 QR',
  INVOICE_QR_NOT_FOUND: '找不到發票 QR',
  LABEL_NOT_LOCATED: '找不到標示表格框',
  GLARE_RETAKE: '反光過大，請重拍',
  DISH_NOT_FOUND: '切不出任何一道菜',
}

/** 後端錯誤代碼（Error.code）。 */
export const ERROR_TEXT: Record<string, string> = {
  INVALID_CONFIG: '參數不合法',
  INVALID_PARAMS: '參數不合法',
  INVALID_REQUEST: '請求格式錯誤',
  IMAGE_NOT_FOUND: '找不到暫存影像，正在重新上傳',
  IMAGE_DECODE_FAILED: '無法讀取影像，請確認檔案格式',
  IMAGE_REQUIRED: '請先選擇影像',
  IMAGE_TOO_LARGE: '影像檔太大（上限 31 MB）',
  SPLIT_LOCKED: '測試集已鎖定，不得讀取',
  AI_UNAVAILABLE: 'Python 服務沒有回應，請確認已用 make workbench-react 啟動',
  AI_TIMEOUT: 'Python 服務處理逾時',
  API_UNAVAILABLE: 'Go 主伺服器沒有回應，請確認已用 make workbench-react 啟動',
  NOT_IMPLEMENTED: '此功能尚未實作',
  NOT_FOUND: '找不到資源（開發工具可能未啟用）',
  DEV_TOOLS_DISABLED: '開發工具未啟用',
  NETWORK: '網路連線失敗',
  INTERNAL: '伺服器內部錯誤',
}

/** 設定欄位分組（ParamInfo.group）。 */
export const GROUP_TEXT: Record<string, string> = {
  blur: '模糊',
  exposure: '曝光',
  resolution: '解析度',
  binarize: '二值化',
  sharpen: '銳化',
  denoise: '去雜訊',
  deskew: '旋轉校正',
  verify: '驗證',
  zxing: '解碼器',
  label_steps: '步驟開關',
  locate: '表格定位',
  rectify: '透視校正',
  glare: '光斑',
  contrast: '對比增強',
  food_steps: '步驟開關',
  segment: '前景分割',
  dish_filter: '框過濾',
  plate: '盤緣橢圓',
  vlm: 'VLM 輸入',
  geometry: '幾何',
  optics: '光學',
  lighting: '光線',
  random: '隨機',
  '': '其他',
}

export const warningText = (code: string) => WARNING_TEXT[code] ?? code
export const errorText = (code: string) => ERROR_TEXT[code] ?? code
export const groupText = (group: string) => GROUP_TEXT[group] ?? group
