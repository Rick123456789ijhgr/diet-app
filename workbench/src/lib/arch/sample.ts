// 預設範例：本專案自己的架構，分四層：L1 全貌（使用者輸入 → 模組一至五的資料流，依規劃書的架構圖）
// → L2 三個服務 → L3 Python 外掛的元件 → L4 模組一的流程。
// 模組一那張的排法與簡報「05 — 各模組功能實作」第 20 頁相同。座標都在 20 px 格點上。
import type { ArchDoc, ArchEdge, ArchNode, NodeEnd, NodeStyle, Route, Side } from './model'
import { DEFAULT_EDGE_STYLE, DEFAULT_NODE_STYLE } from './theme'

const node = (
  id: string,
  x: number,
  y: number,
  kicker: string,
  title: string,
  { style, ...extra }: Partial<Omit<ArchNode, 'style'>> & { style?: Partial<NodeStyle> } = {},
): ArchNode => ({
  id,
  x,
  y,
  w: 240,
  h: 160,
  kicker,
  title,
  accent: '',
  accentW: 160,
  note: '',
  ...extra,
  style: { ...DEFAULT_NODE_STYLE, ...style },
})

const end = (ref: string): NodeEnd => {
  const [node = ref, part] = ref.split('.')
  return { node, part: part === 'accent' ? 'accent' : 'main' }
}

const edge = (from: string, to: string, route: Route = 'auto', label = ''): ArchEdge => ({
  id: `${from}>${to}`,
  from: end(from),
  to: end(to),
  route,
  label,
  style: { ...DEFAULT_EDGE_STYLE },
})

/** 指定兩端接在哪一邊（pos 省略為中點），讓多條線不重疊、不穿過元件。 */
const edgeAt = (
  from: string,
  fromSide: Side,
  to: string,
  toSide: Side,
  { label = '', fromPos, toPos }: { label?: string; fromPos?: number; toPos?: number } = {},
): ArchEdge => ({
  ...edge(from, to, 'auto', label),
  from: { ...end(from), side: fromSide, ...(fromPos === undefined ? {} : { pos: fromPos }) },
  to: { ...end(to), side: toSide, ...(toPos === undefined ? {} : { pos: toPos }) },
})

/** 全貌圖的模組配色（小標寫模組名稱）。 */
const MOD = {
  input: '#3a4657',
  m1: '#14243b',
  m2: '#1e3a8a',
  m3: '#0f766e',
  m4: '#5b21b6',
  m5: '#15803d',
} as const

/** 全貌圖的元件較小、依模組上色。 */
const flow = (fill: string, extra: Partial<NodeStyle> = {}) => ({
  w: 260,
  h: 120,
  style: { titleSize: 22, kickerSize: 16, fill, stroke: fill, ...extra },
})

const db = (fill: string) => ({ ...flow(fill, { shape: 'cylinder', align: 'center' }), h: 140 })

/** 服務層的元件較矮較寬、字小一點。 */
const svc = { w: 260, h: 140, accentW: 140, style: { titleSize: 26, kickerSize: 18 } }

export function sampleDoc(): ArchDoc {
  return {
    version: 1,
    root: 'overview',
    diagrams: {
      overview: {
        id: 'overview',
        level: 'L1 全貌',
        title: '飲食紀錄 APP',
        nodes: [
          // 使用者輸入
          node('in_pack', 340, 0, '輸入', '條碼與營養標示', {
            ...flow(MOD.input),
            note: '拍包裝的條碼與營養標示。即時掃條碼在 APP 以現成套件完成；靜態照片才送伺服器前處理。',
          }),
          node('in_invoice', 680, 0, '輸入', '電子發票 QR code', {
            ...flow(MOD.input),
            note: '電子發票左右兩個 QR code，含品名、數量、金額。',
          }),
          node('in_food', 1020, 0, '輸入', '食物照片', {
            ...flow(MOD.input),
            note: '沒有包裝的餐點照片，交給 VLM 辨識。',
          }),
          node('in_search', 1360, 0, '輸入', '文字搜尋', {
            ...flow(MOD.input),
            note: '使用者直接輸入食物名稱，經 RAG 從資料庫找候選。',
          }),
          // 模組一：影像前處理
          node('quality', 680, 200, '模組一', '品質檢查', {
            ...flow(MOD.m1),
            note: '模糊、曝光、解析度；未通過門檻時回傳警告代碼（例如 TOO_BLURRY）。Python preprocess.quality。',
          }),
          node('pre_code', 160, 400, '模組一', '條碼與 QR 前處理', {
            ...flow(MOD.m1),
            note: '二值化、旋轉、多尺度；條碼逐步升級含 rotate、locate（定位後轉正裁切＋CLAHE）。Python preprocess.barcode、preprocess.invoice_qr。',
          }),
          node('pre_label', 680, 400, '模組一', '營養標示前處理', {
            ...flow(MOD.m1),
            note: '表格定位、透視校正、去反光、CLAHE。Python preprocess.label。',
          }),
          node('pre_food', 1020, 400, '模組一', '食物照片前處理', {
            ...flow(MOD.m1),
            note: '逐菜裁切、盤緣橢圓、縮放壓縮後交給 VLM。Python preprocess.food。',
          }),
          // 模組二：解碼與解析
          node('dec_barcode', 0, 600, '模組二', '條碼解碼', {
            ...flow(MOD.m2),
            note: 'EAN-13 檢查碼驗證，以 GTIN 查產品資料庫。Go barcode。',
          }),
          node('dec_invoice', 340, 600, '模組二', '發票 QR 解碼', {
            ...flow(MOD.m2),
            note: '解出品項明細，對應到產品資料庫的品項與別名。Go invoice。',
          }),
          node('ocr', 680, 600, '模組二', '營養標示 OCR', {
            ...flow(MOD.m2),
            note: 'OCR（預設 PaddleOCR）與 VLM 並行；欄位解析成十進位字串。gRPC LabelService.ParseLabel → Python label_parsing。',
          }),
          node('validate', 680, 800, '模組二', '營養邏輯驗證', {
            ...flow(MOD.m2),
            note: '熱量與三大營養素是否吻合、每份與每 100 g 換算等規則；讀值只預填冷啟動草稿的空欄位（Go coldstart）。',
          }),
          // 模組三：自建產品資料庫
          node('product_db', 1020, 1000, '模組三', '產品資料庫', {
            ...db(MOD.m3),
            note: '產品、營養、影像、價格、別名。Postgres＋MinIO；Go 是唯一寫入者，Python 只讀 view。',
          }),
          node('fda_db', 1700, 600, '模組三', '食藥署食品資料', {
            ...db(MOD.m3),
            note: '食藥署一般食物營養成分資料，作為沒有包裝的食物的候選來源。',
          }),
          // 模組四：LLM 辨識優化與校正
          node('vlm', 1020, 600, '模組四', 'VLM 辨識', {
            ...flow(MOD.m4),
            note: '外部 VLM 結構化輸出（食物名稱、份量描述）；不採用它給的數字。Python recognition、adapters/llm。',
          }),
          node('rag', 1360, 600, '模組四', 'RAG 候選檢索', {
            ...flow(MOD.m4),
            note: '從產品資料庫與食藥署資料找候選品項，約束 LLM 只能從中選。',
          }),
          node('replace', 1360, 800, '模組四', '確定性數值替換', {
            ...flow(MOD.m4),
            note: '營養數字一律換成資料庫的值，由程式計算。',
          }),
          node('calibrate', 1360, 1000, '模組四', '統計校正', {
            ...flow(MOD.m4),
            note: '以有真值的產品評測 LLM 的偏差，用規則與統計方法校正份量等估計。',
          }),
          // 模組五：營養應用層
          node('confirm', 680, 1300, '模組五', '使用者確認與修正', {
            ...flow(MOD.m5),
            note: 'APP 顯示辨識結果讓使用者確認或修正；修正回流到資料庫。Flutter diary、Go diary。',
          }),
          node('calc', 680, 1500, '模組五', '營養計算引擎', {
            ...flow(MOD.m5),
            note: '由資料庫的營養值以確定性程式計算熱量與營養素。Go nutrition。',
          }),
          node('gap', 680, 1700, '模組五', '需求比對與缺口', {
            ...flow(MOD.m5),
            note: '與個人每日需求比對，找出不足或超標的營養素。Go profile、Python analytics。',
          }),
          node('suggest', 680, 1900, '模組五', '下一餐建議', {
            ...flow(MOD.m5),
            note: '依營養缺口建議下一餐。Flutter insights。',
          }),
          // 下一層：程式跑在哪裡
          node('services', 1360, 1600, '部署', '三個服務', {
            ...flow(MOD.input, { shape: 'hexagon', align: 'center' }),
            child: 'system',
            note: 'Flutter APP、Go 主伺服器、Python 外掛與開發工作台。點進去看服務之間怎麼連接。',
          }),
        ],
        edges: [
          edge('in_pack', 'quality'),
          edge('in_invoice', 'quality'),
          edge('in_food', 'quality'),
          edge('quality', 'pre_code'),
          edge('quality', 'pre_label'),
          edge('quality', 'pre_food'),
          edge('pre_code', 'dec_barcode'),
          edge('pre_code', 'dec_invoice'),
          edge('pre_label', 'ocr'),
          edge('ocr', 'validate'),
          edge('pre_food', 'vlm'),
          edge('vlm', 'rag'),
          edge('in_search', 'rag'),
          edge('fda_db', 'rag'),
          edgeAt('product_db', 'right', 'rag', 'left', { fromPos: 0.25, toPos: 0.75 }),
          edge('rag', 'replace'),
          edge('replace', 'calibrate'),
          edgeAt('dec_barcode', 'bottom', 'product_db', 'left', { label: '查詢', toPos: 0.75 }),
          edgeAt('dec_invoice', 'bottom', 'product_db', 'left', { label: '品項對應', toPos: 0.25 }),
          edgeAt('validate', 'bottom', 'product_db', 'left', { fromPos: 0.75 }),
          edgeAt('dec_barcode', 'bottom', 'confirm', 'left', { toPos: 0.75 }),
          edgeAt('dec_invoice', 'bottom', 'confirm', 'left', { toPos: 0.25 }),
          edgeAt('validate', 'bottom', 'confirm', 'top', { fromPos: 0.25, toPos: 0.25 }),
          edgeAt('calibrate', 'bottom', 'confirm', 'right', { toPos: 0.75 }),
          edgeAt('confirm', 'right', 'product_db', 'bottom', { label: '修正回流', fromPos: 0.25 }),
          edge('confirm', 'calc'),
          edge('calc', 'gap'),
          edge('gap', 'suggest'),
        ],
      },
      system: {
        id: 'system',
        level: 'L2 容器',
        title: '三個服務',
        nodes: [
          node('user', 0, 0, 'PERSON', '使用者', {
            ...svc,
            note: '以 APP 拍照、掃條碼或匯入電子發票來記錄飲食。',
          }),
          node('app', 360, 0, 'APP', 'Flutter APP', {
            ...svc,
            note: '使用者介面。即時掃條碼用現成套件；不放任何 LLM 金鑰。',
          }),
          node('api', 720, 0, 'API', 'Go 主伺服器', {
            ...svc,
            accent: '唯一寫入',
            note: '對外 REST API；資料庫唯一的寫入者。需要影像處理或 LLM 時以 gRPC 呼叫 Python 外掛。',
          }),
          node('db', 1300, 0, 'DATA', '資料庫', {
            ...svc,
            w: 220,
            style: { ...svc.style, shape: 'cylinder', align: 'center' },
            note: 'Postgres（產品、營養、紀錄）與 MinIO（照片）。Python 只能用唯讀帳號讀 view。',
          }),
          node('workbench', 360, 260, 'DEV', '開發工作台', {
            ...svc,
            note: 'React 前端，經 Go 的 /workbench/v1 測試各模組、調整參數（ADR 0003）。',
          }),
          node('ai', 940, 260, 'AI', 'Python 外掛', {
            ...svc,
            accent: '唯讀',
            child: 'ai',
            note: '影像前處理、欄位解析、LLM 辨識與校正。點進去看內部元件。',
          }),
          node('llm', 1300, 520, 'EXTERNAL', 'LLM／VLM', {
            ...svc,
            style: { ...svc.style, fill: '#3a4657', stroke: '#3a4657', radius: 20 },
            note: '外部模型。只在 Python 服務持有金鑰；輸出的數字不直接採用。',
          }),
        ],
        edges: [
          edge('user', 'app'),
          edge('app', 'api', 'auto', 'REST'),
          edge('api.accent', 'db'),
          edge('workbench', 'api', 'hv'),
          edge('api', 'ai', 'auto', 'gRPC'),
          edge('ai.accent', 'db', 'hv'),
          edge('ai', 'llm', 'vh'),
        ],
      },
      ai: {
        id: 'ai',
        level: 'L3 元件',
        title: 'Python 外掛',
        nodes: [
          node('grpc', 0, 0, 'ENTRY', 'gRPC 服務', {
            note: '接收 Go 的請求，分派給各模組；不直接對外。',
          }),
          node('m1', 340, 0, '01', '影像前處理', {
            child: 'm1',
            note: '品質測量、門檻判斷與前處理流程。點進去看流程。',
          }),
          node('m2', 680, 0, '02', '欄位解析', {
            note: '條碼、電子發票、營養標示的欄位解析。',
          }),
          node('m5', 1360, 0, '05', '營養計算', {
            note: '由資料庫的營養值以確定性程式計算熱量與營養素。',
          }),
          node('m4', 680, 300, '04', 'LLM 校正', {
            accent: '約束',
            note: '外部 LLM／VLM 的辨識結果，以產品資料庫的真值約束與校正。',
          }),
          node('view', 1360, 300, 'DATA', '唯讀 view', {
            note: 'db/ 定義的 view，以唯讀帳號存取。',
          }),
        ],
        edges: [
          edge('grpc', 'm1'),
          edge('m1', 'm2'),
          edge('m2', 'm5'),
          edge('m1', 'm4', 'vh'),
          edge('view', 'm4.accent'),
        ],
      },
      m1: {
        id: 'm1',
        level: 'L4 流程',
        title: '影像前處理',
        nodes: [
          node('in', 0, 300, 'INPUT', '影像輸入', { note: '使用者上傳的包裝、標示或食物照片。' }),
          node('quality', 340, 300, '01', '品質測量', {
            accent: '品質門檻',
            note: '量測模糊、曝光、解析度等分數；未通過門檻時回傳警告代碼（例如 TOO_BLURRY）。',
          }),
          node('strategy', 840, 0, '02', '優化策略', {
            note: '依未通過的原因選擇前處理方法（例如 CLAHE、去歪斜）。',
          }),
          node('parse', 840, 300, '03', '解析流程', {
            accent: '處理流程',
            note: '依影像種類套用前處理流程，交給模組二解析。',
          }),
          node('out', 1340, 300, 'OUTPUT', '模組二', { note: '條碼、發票、營養標示解析。' }),
          node('test', 0, 580, 'INPUT', '測試輸入', {
            note: '合成影像與開發照片（不含 test split）。',
          }),
          node('exp', 340, 580, '04', '實驗設計', {
            accent: '檢驗結果',
            note: 'E1 條碼消融、自適應策略與找最佳流程；結果回饋到門檻與處理流程。',
          }),
        ],
        edges: [
          edge('in', 'quality'),
          edge('quality.accent', 'strategy', 'vh'),
          edge('quality.accent', 'parse'),
          edge('strategy', 'parse'),
          edge('parse.accent', 'out'),
          edge('test', 'exp'),
          edge('exp.accent', 'quality.accent'),
          edge('exp.accent', 'parse.accent', 'hv'),
        ],
      },
    },
  }
}
