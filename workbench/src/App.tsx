import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { LoginGate } from '@/components/coldstart/LoginGate'
import { AppShell } from '@/components/layout/AppShell'
import { HomePage } from '@/pages/HomePage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

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
      { path: 'm1', element: <Navigate to="/m1/quality" replace /> },
      {
        path: 'm1/quality',
        lazy: async () => ({ Component: (await import('@/pages/QualityPage')).QualityPage }),
      },
      {
        path: 'm1/barcode',
        lazy: async () => ({ Component: (await import('@/pages/BarcodePage')).BarcodePage }),
      },
      {
        path: 'm1/label',
        lazy: async () => ({ Component: (await import('@/pages/LabelPage')).LabelPage }),
      },
      {
        path: 'm1/food',
        lazy: async () => ({ Component: (await import('@/pages/FoodPage')).FoodPage }),
      },
      {
        path: 'm1/sweep',
        lazy: async () => ({ Component: (await import('@/pages/SweepPage')).SweepPage }),
      },
      {
        path: 'm1/batch',
        lazy: async () => ({ Component: (await import('@/pages/BatchPage')).BatchPage }),
      },
      {
        path: 'm1/e1',
        lazy: async () => ({ Component: (await import('@/pages/E1Page')).E1Page }),
      },
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
