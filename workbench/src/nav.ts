// 模組與頁面註冊表：左側圖示欄＝模組，頂部膠囊＝模組內頁面。新增頁面時加在這裡並在 App.tsx 註冊路由。
import {
  Activity,
  BrainCircuit,
  Database,
  Focus,
  Images,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  PackagePlus,
  ScanSearch,
  ScanText,
  Trophy,
} from 'lucide-react'

/** 模組內的一個工具頁；slug 為網址的第二段（/模組 id/slug）。 */
export interface Tool {
  slug: string
  name: string
  icon: LucideIcon
  description: string
  /** 預計在任務書的哪個階段完成；ready 為 false 時顯示「尚未完成」 */
  stage: number
  ready: boolean
}

/** 左側圖示欄的一個模組；id 為網址的第一段。tools 為空時佔位頁顯示「尚無工具」。 */
export interface Module {
  id: string
  short: string // 直欄上的短名稱
  name: string
  icon: LucideIcon
  description: string
  tools: Tool[]
}

/** 總覽（首頁）；id 為空字串，對應網址「/」。網址對不到任何模組時也歸到這裡。 */
export const HOME: Module = {
  id: '',
  short: '總覽',
  name: '總覽',
  icon: LayoutDashboard,
  description: '各模組的工具與完成進度。',
  tools: [],
}

/** 所有模組，順序即左側圖示欄的順序。 */
export const MODULES: Module[] = [
  {
    id: 'm1',
    short: '模組一',
    name: '影像前處理',
    icon: Focus,
    description: '單張影像的前處理檢視、多張影像的參數掃描與批次，以及放入圖片找出最佳前處理流程。',
    tools: [
      {
        slug: 'inspect',
        name: '單張檢視',
        icon: ScanSearch,
        description:
          '一張影像加上模擬退化，切換品質、條碼、發票 QR、營養標示、食物照片看處理結果。',
        stage: 2,
        ready: true,
      },
      {
        slug: 'multi',
        name: '多張測試',
        icon: Images,
        description:
          '參數掃描（退化由弱到強，找出越過門檻的位置）與資料夾批次（整個資料夾的通過率與分數分布）。',
        stage: 3,
        ready: true,
      },
      {
        slug: 'results',
        name: '找最佳流程',
        icon: Trophy,
        description:
          '放入圖片，比較各種前處理方法與流程並選出最佳的順序；進階為 E1 條碼消融與自適應策略的結果。',
        stage: 3,
        ready: true,
      },
    ],
  },
  {
    id: 'm2',
    short: '模組二',
    name: '條碼、發票、營養標示',
    icon: ScanText,
    description: '條碼查詢、電子發票解析、營養標示欄位解析。',
    tools: [],
  },
  {
    id: 'm3',
    short: '模組三',
    name: '產品資料庫',
    icon: Database,
    description: '有真值的產品資料庫，作為評測與校正的依據。',
    tools: [],
  },
  {
    id: 'm4',
    short: '模組四',
    name: 'LLM 辨識與校正',
    icon: BrainCircuit,
    description: '外部 LLM／VLM 辨識結果的約束與校正。',
    tools: [],
  },
  {
    id: 'm5',
    short: '模組五',
    name: '營養分析與建議',
    icon: Activity,
    description: '營養計算、分析與建議。',
    tools: [],
  },
  {
    id: 'coldstart',
    short: '冷啟動',
    name: '冷啟動上傳',
    icon: PackagePlus,
    description: '上傳包裝照片、人工確認條碼與營養數值，寫入產品資料庫（需登入）。',
    tools: [
      {
        slug: 'submissions',
        name: '上傳清單',
        icon: ListChecks,
        description: '新增上傳、上傳三種照片、人工確認並寫入產品資料庫；以條碼查產品。',
        stage: 5,
        ready: true,
      },
    ],
  },
]

/** 工具頁的網址，例如 /m1/quality；須與 App.tsx 註冊的路由一致。 */
export function toolPath(module: Module, tool: Tool): string {
  return `/${module.id}/${tool.slug}`
}

/** 模組的網址；總覽（id 為空）為「/」。 */
export function modulePath(module: Module): string {
  return module.id ? `/${module.id}` : '/'
}

/** 依網址找出目前的模組與頁面；只看前兩段，詳情頁（例如 /coldstart/submissions/:id）歸在所屬頁面。 */
export function locate(pathname: string): { module: Module; tool?: Tool } {
  const [moduleId, slug] = pathname.split('/').filter(Boolean)
  const module = MODULES.find((m) => m.id === moduleId) ?? HOME
  return { module, tool: module.tools.find((t) => t.slug === slug) }
}
