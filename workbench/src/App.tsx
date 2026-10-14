import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { HomePage } from '@/pages/HomePage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

// 已完成的頁面在這裡註冊，各頁延遲載入；其餘頁面與模組顯示「尚未完成」（見 nav.ts 的 ready、stage）
export const routes = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
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
      { path: ':module/:tool?', element: <PlaceholderPage /> },
    ],
  },
]

const router = createBrowserRouter(routes)

export function App() {
  return <RouterProvider router={router} />
}
