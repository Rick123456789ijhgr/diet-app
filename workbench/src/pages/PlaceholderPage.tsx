// 尚未完成的頁面與模組。
import { Construction } from 'lucide-react'
import { Link, useLocation } from 'react-router'

import { EmptyState } from '@/components/layout/Workspace'
import { locate, toolPath } from '@/nav'

/**
 * 尚未實作的路由共用的佔位頁。
 *
 * 依目前網址（`locate` 解析 `/:moduleId/:slug`）決定顯示內容，三種情況：
 * - 網址指到某個工具：顯示工具名稱與預計完成的任務書階段（`tool.stage`）。
 * - 只指到模組、且模組已有工具：連到第一個工具。
 * - 模組還沒有任何工具：只顯示「尚無工具」。
 *
 * `locate` 找不到模組時會退回 `HOME`，所以 `module` 一定有值。
 */
export function PlaceholderPage() {
  const { module, tool } = locate(useLocation().pathname)
  const first = module.tools[0]
  return (
    <EmptyState icon={<Construction className="size-8" aria-hidden />}>
      {tool ? (
        <>
          <span className="text-ink font-medium">{tool.name}</span>
          <span>預計在任務書階段 {tool.stage} 完成。</span>
        </>
      ) : first ? (
        <Link to={toolPath(module, first)} className="text-primary-ink underline">
          前往 {first.name}
        </Link>
      ) : (
        <span>{module.name}尚無工具。</span>
      )}
    </EmptyState>
  )
}
