// 預設範例：本專案自己的架構，分三層（服務 → Python 外掛的元件 → 模組一的流程）。
// 模組一那張與簡報「05 — 各模組功能實作」第 20 頁相同。
import type { ArchDoc, ArchEdge, ArchNode, EdgeEnd, Route } from './model'

const node = (
  id: string,
  x: number,
  y: number,
  kicker: string,
  title: string,
  extra: Partial<ArchNode> = {},
): ArchNode => ({
  id,
  x,
  y,
  w: 250,
  h: 180,
  kicker,
  title,
  accent: '',
  accentW: 170,
  note: '',
  ...extra,
})

const end = (ref: string): EdgeEnd => {
  const [node = ref, part] = ref.split('.')
  return { node, part: part === 'accent' ? 'accent' : 'main' }
}

const edge = (from: string, to: string, route: Route = 'auto', label = ''): ArchEdge => ({
  id: `${from}>${to}`,
  from: end(from),
  to: end(to),
  route,
  label,
})

/** 服務層的元件較矮較寬（一張圖要放三列）。 */
const svc = { w: 280, h: 150, accentW: 160 }

export function sampleDoc(): ArchDoc {
  return {
    version: 1,
    root: 'system',
    diagrams: {
      system: {
        id: 'system',
        level: 'L2 容器',
        section: '01 — 系統架構',
        page: '01',
        badge: '系統',
        title: '飲食紀錄 APP',
        nodes: [
          node('user', 120, 340, 'PERSON', '使用者', {
            ...svc,
            note: '以 APP 拍照、掃條碼或匯入電子發票來記錄飲食。',
          }),
          node('app', 500, 340, 'APP', 'Flutter APP', {
            ...svc,
            note: '使用者介面。即時掃條碼用現成套件；不放任何 LLM 金鑰。',
          }),
          node('api', 880, 340, 'API', 'Go 主伺服器', {
            ...svc,
            accent: '唯一寫入',
            note: '對外 REST API；資料庫唯一的寫入者。需要影像處理或 LLM 時以 gRPC 呼叫 Python 外掛。',
          }),
          node('db', 1520, 340, 'DATA', '資料庫', {
            ...svc,
            note: 'Postgres（產品、營養、紀錄）與 MinIO（照片）。Python 只能用唯讀帳號讀 view。',
          }),
          node('workbench', 500, 620, 'DEV', '開發工作台', {
            ...svc,
            note: 'React 前端，經 Go 的 /workbench/v1 測試各模組、調整參數（ADR 0003）。',
          }),
          node('ai', 1100, 620, 'AI', 'Python 外掛', {
            ...svc,
            accent: '唯讀',
            child: 'ai',
            note: '影像前處理、欄位解析、LLM 辨識與校正。點兩下看內部元件。',
          }),
          node('llm', 1520, 860, 'EXTERNAL', 'LLM／VLM', {
            ...svc,
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
        section: '02 — Python 外掛服務',
        page: '02',
        badge: 'Python 外掛',
        title: '服務內部元件',
        nodes: [
          node('grpc', 120, 420, 'ENTRY', 'gRPC 服務', {
            note: '接收 Go 的請求，分派給各模組；不直接對外。',
          }),
          node('m1', 500, 420, '01', '影像前處理', {
            child: 'm1',
            note: '品質測量、門檻判斷與前處理流程。點兩下看流程。',
          }),
          node('m2', 880, 420, '02', '欄位解析', {
            note: '條碼、電子發票、營養標示的欄位解析。',
          }),
          node('m5', 1550, 420, '05', '營養計算', {
            note: '由資料庫的營養值以確定性程式計算熱量與營養素。',
          }),
          node('m4', 880, 740, '04', 'LLM 校正', {
            accent: '約束',
            note: '外部 LLM／VLM 的辨識結果，以產品資料庫的真值約束與校正。',
          }),
          node('view', 1550, 740, 'DATA', '唯讀 view', {
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
        section: '05 — 各模組功能實作',
        page: '20',
        badge: '模組一',
        title: '影像前處理',
        nodes: [
          node('in', 120, 480, 'INPUT', '影像輸入', { note: '使用者上傳的包裝、標示或食物照片。' }),
          node('quality', 480, 480, '01', '品質測量', {
            accent: '品質門檻',
            note: '量測模糊、曝光、解析度等分數；未通過門檻時回傳警告代碼（例如 TOO_BLURRY）。',
          }),
          node('strategy', 1020, 190, '02', '優化策略', {
            note: '依未通過的原因選擇前處理方法（例如 CLAHE、去歪斜）。',
          }),
          node('parse', 1020, 480, '03', '解析流程', {
            accent: '處理流程',
            note: '依影像種類套用前處理流程，交給模組二解析。',
          }),
          node('out', 1550, 480, 'OUTPUT', '模組二', { note: '條碼、發票、營養標示解析。' }),
          node('test', 120, 780, 'INPUT', '測試輸入', {
            note: '合成影像與開發照片（不含 test split）。',
          }),
          node('exp', 480, 780, '04', '實驗設計', {
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
