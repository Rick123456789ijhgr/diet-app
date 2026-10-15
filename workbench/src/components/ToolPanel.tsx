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
  imageLabel = '影像',
}: {
  image: ReactNode
  params: ReactNode
  io: ReactNode
  /** 參數修改的項目數，顯示在分頁上 */
  changed: number
  paramsLabel?: string
  /** 第一個分頁的名稱（例如參數掃描的條碼模式沒有影像，叫「掃描」） */
  imageLabel?: string
}) {
  return (
    <Tabs defaultValue="image">
      <div className="bg-card sticky top-0 z-10 p-3 pb-2">
        <TabsList>
          <TabsTrigger value="image">
            <ImageIcon className="size-3.5" aria-hidden />
            {imageLabel}
          </TabsTrigger>
          <TabsTrigger value="params">
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {paramsLabel}
            {changed > 0 && <Badge tone="primary">{changed}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="io">
            <ArrowLeftRight className="size-3.5" aria-hidden />
            匯出入
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="image" className="px-4 pt-2 pb-4">
        {image}
      </TabsContent>
      <TabsContent value="params" className="px-4 pt-2 pb-4">
        {params}
      </TabsContent>
      <TabsContent value="io" className="px-4 pt-2 pb-4">
        {io}
      </TabsContent>
    </Tabs>
  )
}
