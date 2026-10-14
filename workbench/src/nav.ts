// 模組與頁面註冊表：左側直欄＝模組，頂部膠囊＝模組內頁面。新增頁面時加在這裡並在 App.tsx 註冊路由。
import {
  Activity,
  Barcode,
  BrainCircuit,
  Database,
  Focus,
  FlaskConical,
  Images,
  LayoutDashboard,
  type LucideIcon,
  PackagePlus,
  ReceiptText,
  ScanSearch,
  ScanText,
  TrendingUp,
  UtensilsCrossed,
} from 'lucide-react'

export interface Tool {
  slug: string
  name: string
  icon: LucideIcon
  description: string
  /** 預計在任務書的哪個階段完成；ready 為 false 時顯示「尚未完成」 */
  stage: number
  ready: boolean
}

export interface Module {
  id: string
  short: string // 直欄上的短名稱
  name: string
  icon: LucideIcon
  description: string
  tools: Tool[]
}

export const HOME: Module = {
  id: '',
  short: '總覽',
  name: '總覽',
  icon: LayoutDashboard,
  description: '各模組的工具與完成進度。',
  tools: [],
}

export const MODULES: Module[] = [
  {
    id: 'm1',
    short: '模組一',
    name: '影像前處理',
    icon: Focus,
    description: '品質檢查、條碼與發票 QR、營養標示、食物照片的前處理，以及 E1 條碼消融。',
    tools: [
      {
        slug: 'quality',
        name: '品質檢查',
        icon: ScanSearch,
        description: '疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。',
        stage: 1,
        ready: true,
      },
      {
        slug: 'barcode',
        name: '條碼',
        icon: Barcode,
        description: '逐步升級解碼商品條碼與電子發票雙 QR。',
        stage: 2,
        ready: true,
      },
      {
        slug: 'label',
        name: '營養標示',
        icon: ReceiptText,
        description: '表格定位、透視校正、光斑與對比。',
        stage: 2,
        ready: true,
      },
      {
        slug: 'food',
        name: '食物照片',
        icon: UtensilsCrossed,
        description: '切出各道菜、盤緣橢圓、VLM 輸入大小。',
        stage: 2,
        ready: true,
      },
      {
        slug: 'sweep',
        name: '參數掃描',
        icon: TrendingUp,
        description: '退化由弱到強，找出越過門檻的位置。',
        stage: 3,
        ready: false,
      },
      {
        slug: 'batch',
        name: '資料夾批次',
        icon: Images,
        description: '整個資料夾的通過率與分數分布。',
        stage: 3,
        ready: false,
      },
      {
        slug: 'e1',
        name: 'E1 消融',
        icon: FlaskConical,
        description: '比較各實驗組的成功率、誤讀與失敗影像。',
        stage: 3,
        ready: false,
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
    description: '上傳包裝照片、人工確認條碼與營養數值，寫入產品資料庫（階段 5）。',
    tools: [],
  },
]

export function toolPath(module: Module, tool: Tool): string {
  return `/${module.id}/${tool.slug}`
}

export function modulePath(module: Module): string {
  return module.id ? `/${module.id}` : '/'
}

/** 依網址找出目前的模組與頁面。 */
export function locate(pathname: string): { module: Module; tool?: Tool } {
  const [moduleId, slug] = pathname.split('/').filter(Boolean)
  const module = MODULES.find((m) => m.id === moduleId) ?? HOME
  return { module, tool: module.tools.find((t) => t.slug === slug) }
}
