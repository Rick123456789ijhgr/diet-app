// 前端進入點：掛載 React，提供 React Query 快取與 Tooltip 的共用 context。
import './index.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/App'
import { TooltipProvider } from '@/components/ui/primitives'
import { createQueryClient } from '@/queryClient'

// createQueryClient() 在模組載入時只執行一次（render 只呼叫一次），整個工作階段共用同一份快取。
// StrictMode 在開發模式會故意重複執行 effect，用來提早發現沒有正確清理（取消請求、清計時器）的程式。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
