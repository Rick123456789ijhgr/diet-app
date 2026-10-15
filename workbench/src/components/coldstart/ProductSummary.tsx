// 產品摘要：品名、條碼、淨重、有效營養標示（每份與每 100）、照片數。數值照後端回傳原樣顯示。
import { useQuery } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Product } from '@/api/client'
import { DataTable } from '@/components/results'
import { Card } from '@/components/ui/primitives'
import { COLDSTART_KEY } from '@/hooks/useAuth'
import { NUTRIENT_KEYS, nutrientLabel, per100Label } from '@/lib/coldstart'
import { imageKindText, unitText } from '@/lib/text'

import { formatTime } from './common'

/** 以條碼查產品；查無此產品（404）時為 null。 */
export function useProduct(barcode: string) {
  return useQuery({
    queryKey: [COLDSTART_KEY, 'product', barcode],
    queryFn: async ({ signal }) => {
      try {
        return await unwrap(
          api.GET('/workbench/v1/coldstart/products/{barcode}', {
            params: { path: { barcode } },
            signal,
          }),
        )
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    enabled: barcode !== '',
  })
}

const show = (v: number | undefined) => (v === undefined ? '—' : String(v))

export function ProductSummary({ product, title }: { product: Product; title?: string }) {
  const { per_serving, per_100 } = product.nutrition
  const unit = unitText(product.content_unit)
  const kinds = [...new Set(product.images.map((i) => imageKindText(i.kind)))]
  const confirmed = per_100 ?? per_serving
  return (
    <Card className="p-4" aria-label={title ?? '產品摘要'} role="region">
      {title && <div className="text-muted mb-1 text-xs font-semibold">{title}</div>}
      <div className="font-semibold">{product.name}</div>
      <dl className="text-muted mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt>條碼</dt>
        <dd className="tabular text-ink">{product.barcode}</dd>
        {product.brand && (
          <>
            <dt>品牌</dt>
            <dd className="text-ink">{product.brand}</dd>
          </>
        )}
        {product.net_content !== undefined && (
          <>
            <dt>淨重或容量</dt>
            <dd className="tabular text-ink">
              {product.net_content} {unit}
            </dd>
          </>
        )}
        {product.serving_size !== undefined && (
          <>
            <dt>每份份量</dt>
            <dd className="tabular text-ink">
              {product.serving_size} {unit}
            </dd>
          </>
        )}
        {product.servings_per_package !== undefined && (
          <>
            <dt>每包裝份數</dt>
            <dd className="tabular text-ink">{product.servings_per_package}</dd>
          </>
        )}
        <dt>照片</dt>
        <dd className="text-ink">
          {product.images.length} 張{kinds.length > 0 && `（${kinds.join('、')}）`}
        </dd>
        {confirmed && (
          <>
            <dt>營養標示確認</dt>
            <dd className="text-ink">
              {confirmed.confirmed_by.display_name}・{formatTime(confirmed.confirmed_at)}
            </dd>
          </>
        )}
      </dl>
      {per_serving || per_100 ? (
        <DataTable
          label={`${product.name}的營養標示`}
          columns={['項目', '每份', per100Label(product.content_unit)]}
          rows={NUTRIENT_KEYS.map((k) => [
            nutrientLabel(k),
            show(per_serving?.[k]),
            show(per_100?.[k]),
          ])}
        />
      ) : (
        <p className="text-muted mt-2 text-sm">尚無有效的營養標示。</p>
      )}
    </Card>
  )
}
