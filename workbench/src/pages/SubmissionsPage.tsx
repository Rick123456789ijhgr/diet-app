// 冷啟動上傳清單：依狀態篩選、新增上傳（建立草稿後跳到編輯頁）、以條碼查產品。
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PackagePlus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { api, unwrap, type SubmissionStatus } from '@/api/client'
import { ColdstartError, formatTime, StatusBadge, TextInput } from '@/components/coldstart/common'
import { ProductSummary, useProduct } from '@/components/coldstart/ProductSummary'
import { EmptyState, PageHeader, Section } from '@/components/layout/Workspace'
import { Badge, Button, Card, Segmented } from '@/components/ui/primitives'
import { COLDSTART_KEY } from '@/hooks/useAuth'
import { IMAGE_KINDS } from '@/lib/coldstart'
import { imageKindText } from '@/lib/text'

type Filter = 'all' | SubmissionStatus

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'confirmed', label: '已確認' },
  { value: 'rejected', label: '已退回' },
]

export function SubmissionsPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const navigate = useNavigate()
  const client = useQueryClient()
  const list = useQuery({
    queryKey: [COLDSTART_KEY, 'submissions', filter],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/coldstart/submissions', {
          params: { query: filter === 'all' ? { limit: 200 } : { status: filter, limit: 200 } },
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
  })
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/workbench/v1/coldstart/submissions')),
    onSuccess: (sub) => {
      client.setQueryData([COLDSTART_KEY, 'submission', sub.id], sub)
      void client.invalidateQueries({ queryKey: [COLDSTART_KEY, 'submissions'] })
      void navigate(`/coldstart/submissions/${encodeURIComponent(sub.id)}`)
    },
  })

  return (
    <div className="h-full overflow-y-auto pr-3 pb-3">
      <PageHeader
        title="上傳清單"
        description="上傳包裝正面、條碼、營養標示三張照片，人工確認條碼與營養數值後寫入產品資料庫。"
        aside={
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
            <PackagePlus className="size-4" aria-hidden />
            新增上傳
          </Button>
        }
      />
      {create.error && <ColdstartError error={create.error} className="mb-4" />}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
        <Section
          title="上傳"
          aside={
            <Segmented label="狀態篩選" value={filter} onChange={setFilter} options={FILTERS} />
          }
        >
          <Card className="px-4 py-2">
            {list.isError ? (
              <ColdstartError error={list.error} className="my-2" />
            ) : !list.data ? (
              <EmptyState>載入中…</EmptyState>
            ) : list.data.items.length === 0 ? (
              <EmptyState>沒有符合的上傳。</EmptyState>
            ) : (
              <table className="w-full text-sm" aria-label="冷啟動上傳清單">
                <thead>
                  <tr className="text-muted border-card-border border-b text-left text-xs">
                    {['條碼', '品名', '狀態', '照片', '建立者', '更新時間'].map((c) => (
                      <th key={c} className="py-2 pr-3 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={list.isPlaceholderData ? 'opacity-60' : undefined}>
                  {list.data.items.map((s) => {
                    const href = `/coldstart/submissions/${encodeURIComponent(s.id)}`
                    return (
                      <tr
                        key={s.id}
                        className="border-card-border hover:bg-hover border-b last:border-0"
                      >
                        <td className="tabular py-1.5 pr-3">
                          <Link to={href} className="text-primary hover:underline">
                            {s.barcode || '（未填）'}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-3">
                          <Link to={href} className="hover:underline">
                            {s.name || <span className="text-muted">（未填）</span>}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-3">
                          <StatusBadge status={s.status} />
                        </td>
                        <td className="py-1.5 pr-3">
                          <span className="flex flex-wrap gap-1">
                            {IMAGE_KINDS.map((k) =>
                              s.images.includes(k) ? (
                                <Badge key={k} tone="primary">
                                  {imageKindText(k)}
                                </Badge>
                              ) : (
                                <Badge key={k} className="line-through opacity-60">
                                  {imageKindText(k)}
                                </Badge>
                              ),
                            )}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3">{s.created_by.display_name}</td>
                        <td className="tabular text-muted py-1.5 pr-3 text-xs">
                          {formatTime(s.updated_at)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </Section>
        <Section title="以條碼查產品">
          <Card className="p-4">
            <ProductLookup />
          </Card>
        </Section>
      </div>
    </div>
  )
}

function ProductLookup() {
  const [text, setText] = useState('')
  const [barcode, setBarcode] = useState('')
  const product = useProduct(barcode)
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setBarcode(text.trim())
        }}
      >
        <TextInput
          aria-label="查詢條碼"
          inputMode="numeric"
          placeholder="例如 4710088410108"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={!text.trim()}>
          <Search className="size-4" aria-hidden />
          查詢
        </Button>
      </form>
      {barcode &&
        (product.isError ? (
          <ColdstartError error={product.error} />
        ) : product.isPending ? (
          <p className="text-muted text-sm">查詢中…</p>
        ) : product.data ? (
          <ProductSummary product={product.data} />
        ) : (
          <p className="text-muted text-sm" role="status">
            查無此產品（{barcode}）。
          </p>
        ))}
    </div>
  )
}
