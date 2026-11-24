// 營養標示照片的讀取結果（LabelService.ParseLabel）：讀到幾格、讀取警告、邏輯驗證未過的規則、OCR 文字行。
// 讀到的值已由 Go 預填到草稿的空欄位；這裡只供組員對照原圖，驗證未過只提示、不阻擋確認。
import { TriangleAlert } from 'lucide-react'

import type { LabelReadingSummary } from '@/api/client'
import { WarningBadges } from '@/components/results'
import { Badge } from '@/components/ui/primitives'
import { ruleText } from '@/lib/text'

export function LabelReading({ reading }: { reading: LabelReadingSummary }) {
  const failed = reading.checks.filter((c) => !c.passed)
  return (
    <div className="mt-2 space-y-1.5" aria-label="營養標示讀取">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted text-xs">讀取：</span>
        <Badge tone={reading.cells.length > 0 ? 'primary' : 'danger'}>
          {reading.cells.length > 0
            ? `讀到 ${reading.cells.length} 格，已預填空欄位`
            : '沒有可預填的值'}
        </Badge>
        <WarningBadges codes={reading.warnings} tone="accent" />
        {failed.map((c) => (
          <Badge key={c.rule} tone="warn" title={c.detail || undefined}>
            <TriangleAlert aria-hidden />
            驗證未過：{ruleText(c.rule)}
          </Badge>
        ))}
      </div>
      {reading.lines.length > 0 && (
        <details>
          <summary className="text-muted hover:text-ink cursor-pointer text-xs select-none">
            OCR 文字行（{reading.lines.length}）
          </summary>
          <ol className="tabular bg-sunken mt-1 max-h-48 space-y-0.5 overflow-auto rounded-lg p-2 text-xs">
            {reading.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
          <div className="text-muted mt-1 text-xs">{reading.ocr_engine}</div>
        </details>
      )}
    </div>
  )
}
