// 把一張圖轉成 Mermaid flowchart 文字（可貼進 GitHub／Markdown）。
// - 強調塊寫進元件標籤的最後一行（Mermaid 沒有這個概念），接在強調塊上的連線改接元件本身。
// - 形狀與線型盡量對應：橢圓→([ ])、菱形→{ }、圓柱→[( )]、六角形→{{ }}；虛線→-.->；沒有箭頭→---。
// - 自由端點（沒接在元件上）的連線 Mermaid 無法表示，略過。
import { type ArchEdge, type Diagram, hasAccent, isNodeEnd, type NodeShapeKind } from './model'

/** Mermaid 標籤內的特殊字元改成實體碼（雙引號、直線會打斷語法）。 */
function esc(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/\|/g, '#124;').replace(/\n/g, '<br/>')
}

const BRACKETS: Record<NodeShapeKind, [string, string]> = {
  rect: ['[', ']'],
  ellipse: ['([', '])'],
  diamond: ['{', '}'],
  cylinder: ['[(', ')]'],
  hexagon: ['{{', '}}'],
}

/** 畫面上由左到右排得比較寬時用 LR，否則 TB。 */
function direction(d: Diagram): 'LR' | 'TB' {
  if (d.nodes.length < 2) return 'LR'
  const xs = d.nodes.map((n) => n.x)
  const ys = d.nodes.map((n) => n.y)
  return Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 'LR' : 'TB'
}

function arrow(e: ArchEdge): string {
  const dashed = e.style.dash !== 'solid'
  switch (e.style.arrow) {
    case 'none':
      return dashed ? '-.-' : '---'
    case 'both':
      return dashed ? '<-.->' : '<-->'
    default:
      return dashed ? '-.->' : '-->'
  }
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
    const [open, close] = BRACKETS[n.style.shape]
    lines.push(`  ${ids.get(n.id)}${open}"${label}"${close}`)
  }
  for (const e of d.edges) {
    if (!isNodeEnd(e.from) || !isNodeEnd(e.to)) continue
    // 只有起點箭頭：反過來寫成一般箭頭
    const [a, b] = e.style.arrow === 'start' ? [e.to, e.from] : [e.from, e.to]
    const from = ids.get(a.node)
    const to = ids.get(b.node)
    if (!from || !to) continue
    const link = arrow(e)
    lines.push(e.label ? `  ${from} ${link}|"${esc(e.label)}"| ${to}` : `  ${from} ${link} ${to}`)
  }
  return `${lines.join('\n')}\n`
}
