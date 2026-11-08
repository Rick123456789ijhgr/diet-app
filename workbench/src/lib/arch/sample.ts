// 預設範例：本專案自己的架構，分三層（服務 → Python 外掛的元件 → 模組一的流程）。
// 模組一那張的排法與簡報「05 — 各模組功能實作」第 20 頁相同。座標都在 20 px 格點上。
import type { ArchDoc, ArchEdge, ArchNode, NodeEnd, NodeStyle, Route } from './model'
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

/** 服務層的元件較矮較寬、字小一點。 */
const svc = { w: 260, h: 140, accentW: 140, style: { titleSize: 26, kickerSize: 18 } }

export function sampleDoc(): ArchDoc {
  return {
    version: 1,
    root: 'system',
    diagrams: {
      system: {
        id: 'system',
        level: 'L2 容器',
        title: '飲食紀錄 APP',
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
