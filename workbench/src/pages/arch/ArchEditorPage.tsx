// 架構圖編輯器（/arch/edit，在新分頁開啟、不套工作台外框）：類似 IcePanel 的全頁編輯介面。
//   ┌ 頂列：名稱・層級路徑                              復原 重做｜匯出 匯入｜完成 ┐
//   │ ┌工具┐ 無限畫布（點點格子）                                 │ 屬性面板 │
//   │ └────┘                                                       │          │
//   └──────────────────────────────────────────────────────────────┴──────────┘
// 文件存在 localStorage，工作台的檢視頁會即時更新。
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  FileCode2,
  FileJson,
  Image as ImageIcon,
  MousePointer2,
  Network,
  Redo2,
  RotateCcw,
  Spline,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { Button, Hint } from '@/components/ui/primitives'
import { toMermaid } from '@/lib/arch/mermaid'
import {
  type Diagram,
  type EdgeEnd,
  freeSpot,
  GRID,
  newEdge,
  newNode,
  type NodeShapeKind,
  parseDoc,
  pathTo,
  SHAPES,
  snap,
  uid,
} from '@/lib/arch/model'
import { sampleDoc } from '@/lib/arch/sample'
import { ARCH } from '@/lib/arch/theme'
import { cn } from '@/lib/cn'
import { downloadBlob } from '@/lib/download'

import { Breadcrumb } from './ArchPage'
import { serializeSvg, StaticDiagram, staticBox, svgToPng } from './DiagramSvg'
import { type CanvasApi, EditorCanvas, type Selection, type Tool } from './EditorCanvas'
import { DiagramInspector, EdgeInspector, NodeInspector, ShapeIcon } from './Inspector'
import { useArchDoc } from './useArchDoc'

/** 鍵盤事件來自輸入框時不處理快捷鍵（避免打字時刪掉元件）。 */
function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

/** 檔名用的安全字串。 */
const fileName = (d: Diagram) => (d.title || d.id).replace(/[\\/:*?"<>|\s]+/g, '_')

export function ArchEditorPage() {
  const { doc, apply, checkpoint, replace, undo, redo, canUndo, canRedo } = useArchDoc()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const diagram = doc.diagrams[params.get('d') ?? ''] ?? doc.diagrams[doc.root]! // 最上層一定存在
  const [rawSelection, setSelection] = useState<Selection>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [error, setError] = useState<string | null>(null)
  const canvas = useRef<CanvasApi>(null)
  const exportSvgRef = useRef<SVGSVGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 分頁標題
  useEffect(() => {
    const prev = document.title
    document.title = '架構圖編輯器'
    return () => {
      document.title = prev
    }
  }, [])

  // 復原或刪除後，選取的東西可能已不存在
  const node =
    rawSelection?.kind === 'node' ? diagram.nodes.find((n) => n.id === rawSelection.id) : undefined
  const edge =
    rawSelection?.kind === 'edge' ? diagram.edges.find((e) => e.id === rawSelection.id) : undefined
  const selection: Selection = node || edge ? rawSelection : null

  /** 切換到某張圖；省略 id 時回到最上層。 */
  function go(id?: string) {
    setSelection(null)
    setParams(id && id !== doc.root ? { d: id } : {})
  }

  function drill(nodeId: string) {
    const child = diagram.nodes.find((n) => n.id === nodeId)?.child
    if (child && doc.diagrams[child]) go(child)
  }

  /** 新增元件：exact 時以 p 為中心（點兩下空白處），否則在 p 附近找空位（工具列）。 */
  function addNodeAt(p: { x: number; y: number }, exact = false, shape: NodeShapeKind = 'rect') {
    const id = uid('n')
    const node = newNode(id, 0, 0, shape)
    const pos = exact
      ? { x: snap(p.x - node.w / 2), y: snap(p.y - node.h / 2) }
      : freeSpot(diagram, p, node)
    apply({ type: 'addNode', diagram: diagram.id, node: { ...node, ...pos } })
    setSelection({ kind: 'node', id })
    setTool('select')
  }

  function connect(from: EdgeEnd, to: EdgeEnd) {
    const id = uid('e')
    apply({ type: 'addEdge', diagram: diagram.id, edge: newEdge(id, from, to) })
    setSelection({ kind: 'edge', id })
  }

  function removeSelected() {
    if (node) apply({ type: 'removeNode', diagram: diagram.id, node: node.id })
    if (edge) apply({ type: 'removeEdge', diagram: diagram.id, edge: edge.id })
    setSelection(null)
  }

  function svgText(): { text: string; w: number; h: number } | undefined {
    const svg = exportSvgRef.current
    if (!svg) return undefined
    const b = staticBox(diagram)
    return { text: serializeSvg(svg), w: b.w, h: b.h }
  }

  async function exportPng() {
    const s = svgText()
    if (!s) return
    try {
      downloadBlob(await svgToPng(s.text, s.w, s.h), `${fileName(diagram)}.png`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法產生 PNG')
    }
  }

  function exportSvg() {
    const s = svgText()
    if (s) downloadBlob(new Blob([s.text], { type: 'image/svg+xml' }), `${fileName(diagram)}.svg`)
  }

  function exportMermaid() {
    const blob = new Blob([toMermaid(diagram)], { type: 'text/plain' })
    downloadBlob(blob, `${fileName(diagram)}.mmd`)
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    downloadBlob(blob, 'architecture.json')
  }

  async function importJson(file: File) {
    try {
      replace(parseDoc(JSON.parse(await file.text())))
      setError(null)
      go()
    } catch (e) {
      setError(`匯入失敗：${e instanceof SyntaxError ? '不是 JSON 檔' : (e as Error).message}`)
    }
  }

  /** 完成：關閉這個分頁（由工作台開的分頁可以關）；關不掉時回到檢視頁。 */
  function done() {
    window.close()
    setTimeout(() => {
      if (!window.closed)
        navigate(diagram.id === doc.root ? '/tools/arch' : `/tools/arch?d=${diagram.id}`)
    }, 150)
  }

  // 快捷鍵
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (isTyping(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      e.preventDefault()
      removeSelected()
    } else if (e.key === 'Escape') {
      const trail = pathTo(doc, diagram.id)
      if (tool !== 'select') setTool('select')
      else if (selection) setSelection(null)
      else if (trail.length > 1) go(trail.at(-2)?.diagram.id)
    } else if (e.shiftKey && e.code === 'Digit1') {
      e.preventDefault()
      canvas.current?.fit()
    } else if (e.shiftKey && e.code === 'Digit2') {
      e.preventDefault()
      canvas.current?.recenter()
    } else if (!mod && !e.shiftKey && e.key.toLowerCase() === 'v') {
      setTool('select')
    } else if (!mod && !e.shiftKey && e.key.toLowerCase() === 'l') {
      setTool('line')
    } else if (arrows[e.key] && node) {
      e.preventDefault()
      const [dx, dy] = arrows[e.key]!
      const step = GRID * (e.shiftKey ? 5 : 1)
      apply({
        type: 'moveNode',
        diagram: diagram.id,
        node: node.id,
        x: node.x + dx * step,
        y: node.y + dy * step,
      })
    }
  })
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const common = { diagram, apply, checkpoint }

  return (
    <div className="bg-canvas text-ink flex h-full flex-col">
      <header className="bg-card border-card-border flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="bg-ink text-on-ink inline-flex size-7 items-center justify-center rounded-lg">
            <Network className="size-4" aria-hidden />
          </span>
          <h1 className="text-[14px] font-semibold">架構圖編輯器</h1>
        </div>
        <span className="bg-card-border h-5 w-px shrink-0" aria-hidden />
        <Breadcrumb doc={doc} diagramId={diagram.id} onGo={go} className="flex-1" />

        {error && (
          <p role="alert" className="text-danger flex items-center gap-1.5 text-xs">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {error}
            <button type="button" aria-label="關閉訊息" onClick={() => setError(null)}>
              <X className="size-3.5" aria-hidden />
            </button>
          </p>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <Hint text="復原（Ctrl+Z）" side="bottom">
            <Button size="sm" variant="ghost" aria-label="復原" disabled={!canUndo} onClick={undo}>
              <Undo2 className="size-4" aria-hidden />
            </Button>
          </Hint>
          <Hint text="重做（Ctrl+Shift+Z）" side="bottom">
            <Button size="sm" variant="ghost" aria-label="重做" disabled={!canRedo} onClick={redo}>
              <Redo2 className="size-4" aria-hidden />
            </Button>
          </Hint>
          <span className="bg-card-border mx-1 h-5 w-px" aria-hidden />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button size="sm">
                <Download className="size-3.5" aria-hidden />
                匯出
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="bg-card shadow-card z-50 min-w-48 rounded-xl p-1"
              >
                <MenuItem icon={<ImageIcon />} onSelect={() => void exportPng()}>
                  PNG 圖片（這張圖）
                </MenuItem>
                <MenuItem icon={<Download />} onSelect={exportSvg}>
                  SVG 向量圖（這張圖）
                </MenuItem>
                <MenuItem icon={<FileCode2 />} onSelect={exportMermaid}>
                  Mermaid 文字（這張圖）
                </MenuItem>
                <DropdownMenu.Separator className="bg-card-border my-1 h-px" />
                <MenuItem icon={<FileJson />} onSelect={exportJson}>
                  JSON（整份，可匯入）
                </MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Hint text="匯入整份 JSON（可用復原找回原本的內容）" side="bottom">
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden />
              匯入
            </Button>
          </Hint>
          <Hint text="以本專案的架構範例取代目前的內容（可用復原找回）" side="bottom">
            <Button
              size="sm"
              variant="ghost"
              aria-label="還原範例"
              onClick={() => {
                replace(sampleDoc())
                go()
              }}
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </Button>
          </Hint>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            aria-label="選擇架構圖 JSON"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importJson(f)
              e.target.value = ''
            }}
          />
          <span className="bg-card-border mx-1 h-5 w-px" aria-hidden />
          <Hint text="內容已自動儲存；關閉這個分頁回到工作台" side="bottom">
            <Button size="sm" variant="primary" onClick={done}>
              <Check className="size-3.5" aria-hidden />
              完成
            </Button>
          </Hint>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <EditorCanvas
            diagram={diagram}
            selection={selection}
            tool={tool}
            apiRef={canvas}
            onSelect={setSelection}
            onDragStart={checkpoint}
            onMove={(id, x, y) =>
              apply({ type: 'moveNode', diagram: diagram.id, node: id, x, y }, false)
            }
            onResize={(id, w, h) =>
              apply({ type: 'updateNode', diagram: diagram.id, node: id, patch: { w, h } }, false)
            }
            onCreateEdge={connect}
            onUpdateEdge={(id, which, end) =>
              apply(
                { type: 'updateEdge', diagram: diagram.id, edge: id, patch: { [which]: end } },
                false,
              )
            }
            onDrill={drill}
            onAddAt={(p) => addNodeAt(p, true)}
          />
          {/* 左側工具列：選取、線條、各種形狀（點了在畫面中央附近的空位新增） */}
          <div
            role="toolbar"
            aria-label="工具"
            aria-orientation="vertical"
            className="bg-card shadow-card absolute top-3 left-3 flex flex-col gap-0.5 rounded-xl p-1"
          >
            <ToolButton
              label="選取"
              shortcut="V"
              pressed={tool === 'select'}
              onClick={() => setTool('select')}
            >
              <MousePointer2 className="size-[18px]" aria-hidden />
            </ToolButton>
            <ToolButton
              label="線條"
              shortcut="L"
              pressed={tool === 'line'}
              onClick={() => setTool(tool === 'line' ? 'select' : 'line')}
            >
              <Spline className="size-[18px]" aria-hidden />
            </ToolButton>
            <span className="bg-card-border mx-1.5 my-1 h-px" aria-hidden />
            {SHAPES.map((sh) => (
              <ToolButton
                key={sh.value}
                label={`新增${sh.label}`}
                onClick={() =>
                  addNodeAt(canvas.current?.center() ?? { x: 0, y: 0 }, false, sh.value)
                }
              >
                <ShapeIcon shape={sh.value} />
              </ToolButton>
            ))}
          </div>
          {tool === 'line' && (
            <p className="bg-ink text-on-ink pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs">
              從任意處拖到另一處畫線；靠近定位點會自動吸附。按 Esc 或 V 結束。
            </p>
          )}
        </main>
        <aside
          aria-label="屬性"
          className="bg-card border-card-border w-[300px] shrink-0 overflow-y-auto border-l"
        >
          {node ? (
            <NodeInspector
              key={node.id}
              node={node}
              {...common}
              onDrill={() => drill(node.id)}
              onCreateChild={() => {
                const childId = uid('d')
                apply({ type: 'createChild', diagram: diagram.id, node: node.id, childId })
                go(childId)
              }}
              onDelete={removeSelected}
            />
          ) : edge ? (
            <EdgeInspector key={edge.id} edge={edge} {...common} onDelete={removeSelected} />
          ) : (
            <DiagramInspector {...common} />
          )}
        </aside>
      </div>

      {/* 匯出用的乾淨圖（白底、沒有選取與把手）；隱藏，只拿來序列化 */}
      <div style={{ display: 'none' }}>
        <StaticDiagram
          svgRef={exportSvgRef}
          diagram={diagram}
          idPrefix="export"
          background={ARCH.exportBg}
          labelBg={ARCH.exportBg}
        />
      </div>
    </div>
  )
}

function ToolButton({
  label,
  shortcut,
  pressed,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Hint text={shortcut ? `${label}（${shortcut}）` : label} side="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn(
          'text-ink-2 hover:bg-hover hover:text-ink focus-visible:ring-primary/40 inline-flex size-9 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:outline-none',
          pressed && 'bg-ink text-on-ink hover:bg-ink hover:text-on-ink',
        )}
      >
        {children}
      </button>
    </Hint>
  )
}

function MenuItem({
  icon,
  onSelect,
  children,
}: {
  icon: ReactNode
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="data-[highlighted]:bg-hover flex cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none [&_svg]:size-4 [&_svg]:text-muted"
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  )
}
