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
  AI_UNAVAILABLE: 'Python 服務沒有回應，請確認已用 make workbench 啟動',
  AI_TIMEOUT: 'Python 服務處理逾時',
  API_UNAVAILABLE: 'Go 主伺服器沒有回應，請確認已用 make workbench 啟動',
  NOT_IMPLEMENTED: '此功能尚未實作',
  NOT_FOUND: '找不到資源（開發工具可能未啟用）',
  DEV_TOOLS_DISABLED: '開發工具未啟用',
  NETWORK: '網路連線失敗',
  PATH_NOT_FOUND: '找不到路徑',
  INTERNAL: '伺服器內部錯誤',
  HTTP_ERROR: '請求失敗',
  // 登入與冷啟動上傳
  INVALID_CREDENTIALS: '帳號或密碼錯誤',
  UNAUTHORIZED: '尚未登入或登入已過期，請重新登入',
  DB_UNAVAILABLE: '資料庫或物件儲存未設定或無法連線',
  PRECONDITION_FAILED: '這筆上傳已被其他人修改，請重新載入',
  SUBMISSION_CLOSED: '這筆上傳已確認或已退回，不能再修改',
  SUBMISSION_NOT_FOUND: '找不到這筆上傳',
  PRODUCT_NOT_FOUND: '查無此產品',
  BARCODE_EXISTS: '此條碼的產品已存在',
  DRAFT_INCOMPLETE: '欄位尚未填完',
  NUTRITION_INCONSISTENT: '營養數值不一致',
  INVALID_BARCODE: '條碼格式不正確（須為 8 到 14 位數字）',
  INVALID_DRAFT: '輸入的欄位不合法',
  UNSUPPORTED_IMAGE: '不支援的影像格式（請用 JPEG 或 PNG）',
}

/** 條碼逐步升級的各階（Rung）。 */
export const RUNG_TEXT: Record<string, string> = {
  raw: '原圖',
  gray: '灰階',
  binarize: '自適應二值化',
  sharpen: '銳化',
  denoise: '去雜訊',
  deskew: '旋轉校正',
  multiscale: '多尺度',
}

/** E1 的判定結果（evaluation.Outcome）。 */
export const OUTCOME_TEXT: Record<string, string> = {
  correct: '正確',
  misread: '誤讀',
  missed: '漏讀',
  false_positive: '負樣本誤報',
  true_negative: '正確拒絕',
  error: '讀檔／處理錯誤',
}

/** 營養標示表格框的定位方法。 */
export const QUAD_METHOD_TEXT: Record<string, string> = {
  contour: '輪廓法',
  hough: '直線法',
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

/** 照片種類（ImageKind）。 */
export const IMAGE_KIND_TEXT: Record<string, string> = {
  front: '包裝正面',
  barcode: '條碼',
  label: '營養標示',
}

/** 上傳狀態（SubmissionStatus）。 */
export const STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  confirmed: '已確認',
  rejected: '已退回',
}

/** 營養素（Nutrients 的欄位）與單位。 */
export const NUTRIENT_TEXT: Record<string, string> = {
  energy_kcal: '熱量',
  protein_g: '蛋白質',
  fat_g: '脂肪',
  saturated_fat_g: '飽和脂肪',
  trans_fat_g: '反式脂肪',
  carbohydrate_g: '碳水化合物',
  sugar_g: '糖',
  sodium_mg: '鈉',
}
export const NUTRIENT_UNIT_TEXT: Record<string, string> = {
  energy_kcal: '大卡',
  protein_g: '公克',
  fat_g: '公克',
  saturated_fat_g: '公克',
  trans_fat_g: '公克',
  carbohydrate_g: '公克',
  sugar_g: '公克',
  sodium_mg: '毫克',
}

/** 草稿欄位（Draft 的欄位；確認時 missing 回傳的路徑）。 */
export const DRAFT_FIELD_TEXT: Record<string, string> = {
  barcode: '條碼',
  name: '品名',
  brand: '品牌',
  net_content: '淨重或容量',
  content_unit: '單位',
  serving_size: '每份份量',
  servings_per_package: '每包裝份數',
}

/** 容量單位（ContentUnit）。 */
export const UNIT_TEXT: Record<string, string> = { g: '公克', ml: '毫升' }

/** 營養數值不一致的種類（NutritionIssue.code）。 */
export const ISSUE_TEXT: Record<string, string> = {
  BASIS_MISMATCH: '每份與每 100 的數值換算不符',
  FAT_PARTS_EXCEED_FAT: '飽和脂肪加反式脂肪大於脂肪',
  SUGAR_EXCEEDS_CARBOHYDRATE: '糖大於碳水化合物',
}

/** 營養標示的基準（NutritionIssue.basis）。 */
export const BASIS_TEXT: Record<string, string> = {
  per_serving: '每份',
  per_100: '每 100',
  both: '每份與每 100',
}

export const warningText = (code: string) => WARNING_TEXT[code] ?? code
export const errorText = (code: string) => ERROR_TEXT[code] ?? code
export const groupText = (group: string) => GROUP_TEXT[group] ?? group
export const rungText = (rung: string) => RUNG_TEXT[rung] ?? rung
export const outcomeText = (o: string) => OUTCOME_TEXT[o] ?? o
export const imageKindText = (k: string) => IMAGE_KIND_TEXT[k] ?? k
export const statusText = (s: string) => STATUS_TEXT[s] ?? s
export const nutrientText = (n: string) => NUTRIENT_TEXT[n] ?? n
export const issueText = (c: string) => ISSUE_TEXT[c] ?? c
export const unitText = (u: string) => UNIT_TEXT[u] ?? u
