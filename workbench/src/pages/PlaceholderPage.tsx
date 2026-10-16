// 尚未完成的頁面與模組。
import { Construction } from 'lucide-react'
import { Link, useLocation } from 'react-router'

import { EmptyState } from '@/components/layout/Workspace'
import { locate, toolPath } from '@/nav'

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
