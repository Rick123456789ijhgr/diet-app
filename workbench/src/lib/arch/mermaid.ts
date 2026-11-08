// 把一張圖轉成 Mermaid flowchart 文字（可貼進 GitHub／Markdown）。
// Mermaid 沒有「強調塊」的概念：強調塊寫進元件標籤的最後一行，接在強調塊上的連線改接元件本身。
import { type Diagram, hasAccent } from './model'

/** Mermaid 標籤內的特殊字元改成實體碼（雙引號、直線會打斷語法）。 */
function esc(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/\|/g, '#124;').replace(/\n/g, '<br/>')
}

/** 畫面上由左到右排得比較寬時用 LR，否則 TB。 */
function direction(d: Diagram): 'LR' | 'TB' {
  if (d.nodes.length < 2) return 'LR'
  const xs = d.nodes.map((n) => n.x)
  const ys = d.nodes.map((n) => n.y)
  return Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 'LR' : 'TB'
}

export function toMermaid(d: Diagram): string {
  // 元件 id 只保留英數與底線，重複時加序號
  const ids = new Map<string, string>()
  const used = new Set<string>()
  for (const n of d.nodes) {
    const base = `n_${n.id.replace(/[^A-Za-z0-9_]/g, '_')}`
    let id = base
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`
    used.add(id)
    ids.set(n.id, id)
  }
  const lines = [`%% ${d.title}${d.level ? `（${d.level}）` : ''}`, `flowchart ${direction(d)}`]
  for (const n of d.nodes) {
    const label = [n.kicker, n.title || '未命名', hasAccent(n) ? `〔${n.accent}〕` : '']
      .filter(Boolean)
      .map(esc)
      .join('<br/>')
    lines.push(`  ${ids.get(n.id)}["${label}"]`)
  }
  for (const e of d.edges) {
    const from = ids.get(e.from.node)
    const to = ids.get(e.to.node)
    if (!from || !to) continue
    lines.push(e.label ? `  ${from} -->|"${esc(e.label)}"| ${to}` : `  ${from} --> ${to}`)
  }
  return `${lines.join('\n')}\n`
}
