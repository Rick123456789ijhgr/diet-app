// 工具頁左側控制面板：影像／參數／匯出入三個分頁。
import { ArrowLeftRight, ImageIcon, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives'

export function ToolPanel({
  image,
  params,
  io,
  changed,
  paramsLabel = '參數',
}: {
  image: ReactNode
  params: ReactNode
  io: ReactNode
  /** 參數修改的項目數，顯示在分頁上 */
  changed: number
  paramsLabel?: string
}) {
  return (
    <Tabs defaultValue="image">
      <TabsList className="mb-4">
        <TabsTrigger value="image">
          <ImageIcon className="size-4" aria-hidden />
          影像
        </TabsTrigger>
        <TabsTrigger value="params">
          <SlidersHorizontal className="size-4" aria-hidden />
          {paramsLabel}
          {changed > 0 && <Badge tone="accent">{changed}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="io">
          <ArrowLeftRight className="size-4" aria-hidden />
          匯出入
        </TabsTrigger>
      </TabsList>
      <TabsContent value="image">{image}</TabsContent>
      <TabsContent value="params">{params}</TabsContent>
      <TabsContent value="io">{io}</TabsContent>
    </Tabs>
  )
}
