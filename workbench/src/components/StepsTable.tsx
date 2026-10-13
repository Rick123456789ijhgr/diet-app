import type { Step } from '@/api/client'

/** 前處理各步驟的耗時與實際使用的參數。 */
export function StepsTable({ steps }: { steps: Step[] }) {
  return (
    <table className="w-full text-sm" aria-label="處理步驟">
      <thead>
        <tr className="text-muted border-card-border border-b text-left text-xs">
          <th className="py-2 pr-3 font-medium">步驟</th>
          <th className="py-2 pr-3 text-right font-medium">耗時（ms）</th>
          <th className="py-2 font-medium">參數</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s, i) => (
          <tr key={`${s.name}-${i}`} className="border-card-border border-b last:border-0">
            <td className="py-2 pr-3 font-mono text-xs">{s.name}</td>
            <td className="tabular py-2 pr-3 text-right">{s.elapsed_ms.toFixed(2)}</td>
            <td className="text-muted py-2 font-mono text-xs break-all">
              {Object.entries(s.params)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join('　')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
