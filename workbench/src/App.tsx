import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { LoginGate } from '@/components/coldstart/LoginGate'
import { AppShell } from '@/components/layout/AppShell'
import { HomePage } from '@/pages/HomePage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

/** 模組一的舊網址 → 合併後的頁面（2026-11 從 8 頁合為單張檢視、多張測試、實驗結果 3 頁）。 */
const OLD_M1_PATHS: Record<string, string> = {
  quality: '/m1/inspect/quality',
  barcode: '/m1/inspect/barcode',
  label: '/m1/inspect/label',
  food: '/m1/inspect/food',
  sweep: '/m1/multi/sweep',
  batch: '/m1/multi/folder',
  e1: '/m1/results/e1',
  adaptive: '/m1/results/adaptive',
}

// 已完成的頁面在這裡註冊，各頁延遲載入；其餘頁面與模組顯示「尚未完成」（見 nav.ts 的 ready、stage）
/**
 * 路由表；匯出供頁面測試以 createMemoryRouter 重用。
 * 各頁以 lazy 動態 import：建置時每頁獨立成一包，進入該頁才下載。
 */
export const routes = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      // 只點模組時導向第一個工具；replace 讓「上一頁」不會回到 /m1 又被導回來
      { path: 'm1', element: <Navigate to="/m1/inspect/quality" replace /> },
      { path: 'm1/inspect', element: <Navigate to="/m1/inspect/quality" replace /> },
      {
        // 單張檢視：品質、條碼、發票 QR、營養標示、食物照片共用一張影像，任務在網址最後一段
        path: 'm1/inspect/:task',
        lazy: async () => ({
          Component: (await import('@/pages/inspect/InspectPage')).InspectPage,
        }),
      },
      { path: 'm1/multi', element: <Navigate to="/m1/multi/sweep" replace /> },
      {
        // 多張測試：參數掃描與資料夾批次，模式在網址最後一段
        path: 'm1/multi/:mode',
        lazy: async () => ({ Component: (await import('@/pages/multi/MultiPage')).MultiPage }),
      },
      { path: 'm1/results', element: <Navigate to="/m1/results/best" replace /> },
      {
        // 實驗結果：找最佳流程，以及進階的 E1 消融與自適應策略，種類在網址最後一段
        path: 'm1/results/:kind',
        lazy: async () => ({
          Component: (await import('@/pages/results/ResultsPage')).ResultsPage,
        }),
      },
      { path: 'arch', element: <Navigate to="/arch/diagram" replace /> },
      {
        // 專案架構圖：純前端（存在瀏覽器），目前看的圖在 ?d= 參數
        path: 'arch/diagram',
        lazy: async () => ({ Component: (await import('@/pages/arch/ArchPage')).ArchPage }),
      },
      // 舊網址（原本各自是獨立頁面）導向合併後的頁面
      ...Object.entries(OLD_M1_PATHS).map(([old, to]) => ({
        path: `m1/${old}`,
        element: <Navigate to={to} replace />,
      })),
      {
        // 冷啟動上傳：須登入，未登入時顯示登入表單，登入後留在原網址
        path: 'coldstart',
        element: <LoginGate />,
        children: [
          { index: true, element: <Navigate to="/coldstart/submissions" replace /> },
          {
            path: 'submissions',
            lazy: async () => ({
              Component: (await import('@/pages/SubmissionsPage')).SubmissionsPage,
            }),
          },
          {
            path: 'submissions/:id',
            lazy: async () => ({
              Component: (await import('@/pages/SubmissionPage')).SubmissionPage,
            }),
          },
        ],
      },
      // 其餘網址（尚未完成的模組或頁面）一律交給佔位頁；React Router 依路徑明確度排序，靜態路由會優先比對
      { path: ':module/:tool?', element: <PlaceholderPage /> },
    ],
  },
]

// 在模組層級建立一次，重新繪製 App 時不會重建路由器（也不會遺失導覽狀態）
const router = createBrowserRouter(routes)

/** 工作台根元件：AppShell 版面＋各頁路由。 */
export function App() {
  return <RouterProvider router={router} />
}
