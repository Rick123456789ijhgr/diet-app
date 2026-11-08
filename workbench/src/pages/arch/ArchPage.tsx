// 專案架構・架構圖：像 C4 Model 一樣逐層放大的架構圖編輯器，樣式為深藍簡報風（可匯出 PNG／SVG 貼進簡報）。
// 純前端：文件存在瀏覽器（localStorage），可匯出／匯入 JSON 與組員交換；不經後端。
import {
  AlertTriangle,
  ChevronRight,
  Download,
  Eye,
  FileJson,
  Image as ImageIcon,
  Maximize,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Undo2,
  Upload,
} from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useSearchParams } from 'react-router'

import { PanelSection, PanelStack } from '@/components/layout/PanelSections'
import { MainView, Split, Workspace } from '@/components/layout/Workspace'
import { Badge, Button, Hint, Segmented } from '@/components/ui/primitives'
import { SLIDE } from '@/lib/arch/theme'
import {
  freeSpot,
  newNode,
  parseDoc,
  pathTo,
  uid,
  type Diagram,
  type EdgeEnd,
} from '@/lib/arch/model'
import { sampleDoc } from '@/lib/arch/sample'
import { cn } from '@/lib/cn'
import { downloadBlob } from '@/lib/download'

import { ArchCanvas, type Selection, serializeSvg, svgToPng } from './ArchCanvas'
import { DiagramSummary, EdgeInspector, NodeInspector, TextField } from './Inspector'
import { useArchDoc } from './useArchDoc'

type Mode = 'view' | 'edit'

/** 鍵盤事件來自輸入框時不處理快捷鍵（避免打字時刪掉元件）。 */
function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

/** 檔名用的安全字串。 */
const fileName = (d: Diagram) => (d.title || d.id).replace(/[\\/:*?"<>|\s]+/g, '_')

export function ArchPage() {
  const { doc, apply, checkpoint, replace, undo, redo, canUndo, canRedo } = useArchDoc()
  const [params, setParams] = useSearchParams()
  const diagram = doc.diagrams[params.get('d') ?? ''] ?? doc.diagrams[doc.root]! // 最上層一定存在（parseDoc 驗證過）
  const trail = pathTo(doc, diagram.id)
  const [mode, setMode] = useState<Mode>('edit')
  const editable = mode === 'edit'
  const [rawSelection, setSelection] = useState<Selection>(null)
  const [error, setError] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  function createChild(nodeId: string) {
    const childId = uid('d')
    apply({ type: 'createChild', diagram: diagram.id, node: nodeId, childId })
    go(childId)
  }

  function addNode() {
    const id = uid('n')
    apply({
      type: 'addNode',
      diagram: diagram.id,
      node: { ...newNode(id, 0, 0), ...freeSpot(diagram) },
    })
    setSelection({ kind: 'node', id })
  }

  function connect(from: EdgeEnd, to: EdgeEnd) {
    const id = uid('e')
    apply({
      type: 'addEdge',
      diagram: diagram.id,
      edge: { id, from, to, route: 'auto', label: '' },
    })
    setSelection({ kind: 'edge', id })
  }

  function removeSelected() {
    if (node) apply({ type: 'removeNode', diagram: diagram.id, node: node.id })
    if (edge) apply({ type: 'removeEdge', diagram: diagram.id, edge: edge.id })
    setSelection(null)
  }

  /** 匯出前取消選取並立即重畫，避免選取框或選取色出現在檔案裡。 */
  function cleanSvg(): string | undefined {
    flushSync(() => setSelection(null))
    return svgRef.current ? serializeSvg(svgRef.current) : undefined
  }

  async function exportPng() {
    const svg = cleanSvg()
    if (!svg) return
    try {
      downloadBlob(await svgToPng(svg), `${fileName(diagram)}.png`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法產生 PNG')
    }
  }

  function exportSvg() {
    const svg = cleanSvg()
    if (svg) downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileName(diagram)}.svg`)
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

  // 快捷鍵：Delete 刪除、Ctrl+Z 復原、Ctrl+Shift+Z／Ctrl+Y 重做、Esc 取消選取或回上一層
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (isTyping(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && editable && selection) {
      e.preventDefault()
      removeSelected()
    } else if (e.key === 'Escape') {
      if (selection) setSelection(null)
      else if (trail.length > 1) go(trail.at(-2)?.diagram.id)
    }
  })
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const setDiagram = (patch: Partial<Diagram>) =>
    apply({ type: 'updateDiagram', diagram: diagram.id, patch }, false)

  const inspectorProps = {
    diagram,
    editable,
    apply,
    checkpoint,
    onDrill: drill,
    onCreateChild: createChild,
    onDeleteNode: (id: string) => {
      apply({ type: 'removeNode', diagram: diagram.id, node: id })
      setSelection(null)
    },
    onDeleteEdge: (id: string) => {
      apply({ type: 'removeEdge', diagram: diagram.id, edge: id })
      setSelection(null)
    },
  }

  const panel = (
    <PanelStack>
      <PanelSection title="圖面">
        <TextField
          label="C4 層級"
          value={diagram.level}
          disabled={!editable}
          onFocus={checkpoint}
          onChange={(level) => setDiagram({ level })}
          placeholder="例如 L2 容器"
        />
        <TextField
          label="標章"
          value={diagram.badge}
          disabled={!editable}
          onFocus={checkpoint}
          onChange={(badge) => setDiagram({ badge })}
          placeholder="空白表示不顯示"
        />
        <TextField
          label="頁面標題"
          value={diagram.title}
          disabled={!editable}
          onFocus={checkpoint}
          onChange={(title) => setDiagram({ title })}
        />
        <div className="grid grid-cols-[1fr_72px] gap-2">
          <TextField
            label="頁首"
            value={diagram.section}
            disabled={!editable}
            onFocus={checkpoint}
            onChange={(section) => setDiagram({ section })}
          />
          <TextField
            label="頁碼"
            value={diagram.page}
            disabled={!editable}
            onFocus={checkpoint}
            onChange={(page) => setDiagram({ page })}
          />
        </div>
        {editable && (
          <Button variant="primary" onClick={addNode} className="w-full">
            <Plus className="size-4" aria-hidden />
            新增元件
          </Button>
        )}
      </PanelSection>
      <PanelSection title="匯出與匯入">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={exportPng}>
            <ImageIcon className="size-4" aria-hidden />
            匯出 PNG
          </Button>
          <Button onClick={exportSvg}>
            <Download className="size-4" aria-hidden />
            匯出 SVG
          </Button>
          <Button onClick={exportJson}>
            <FileJson className="size-4" aria-hidden />
            匯出 JSON
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden />
            匯入 JSON
          </Button>
        </div>
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
        <Hint text="以本專案的架構範例取代目前的內容（可用復原找回）。">
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              replace(sampleDoc())
              go()
            }}
          >
            <RotateCcw className="size-4" aria-hidden />
            還原範例
          </Button>
        </Hint>
        {error && (
          <p role="alert" className="text-danger flex items-start gap-1.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <p className="text-muted text-xs leading-relaxed">
          內容自動存在這個瀏覽器；要給組員或換電腦時匯出 JSON。PNG 為 3840×2160，可直接貼進簡報。
        </p>
      </PanelSection>
    </PanelStack>
  )

  const toolbar = (
    <>
      <nav aria-label="層級" className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
        {trail.map(({ diagram: d }, i) => {
          const last = i === trail.length - 1
          return (
            <span key={d.id} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="text-muted size-3.5 shrink-0" aria-hidden />}
              {last ? (
                <span aria-current="page" className="truncate font-semibold">
                  {d.title || '未命名'}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => go(d.id)}
                  className="text-ink-2 hover:text-ink truncate rounded px-1 hover:underline"
                >
                  {d.title || '未命名'}
                </button>
              )}
            </span>
          )
        })}
        {diagram.level && <Badge className="ml-2">{diagram.level}</Badge>}
      </nav>
      <Hint text="復原（Ctrl+Z）">
        <Button size="sm" variant="ghost" aria-label="復原" disabled={!canUndo} onClick={undo}>
          <Undo2 className="size-4" aria-hidden />
        </Button>
      </Hint>
      <Hint text="重做（Ctrl+Shift+Z）">
        <Button size="sm" variant="ghost" aria-label="重做" disabled={!canRedo} onClick={redo}>
          <Redo2 className="size-4" aria-hidden />
        </Button>
      </Hint>
      <Hint text="全螢幕簡報（Esc 離開）">
        <Button
          size="sm"
          variant="ghost"
          aria-label="全螢幕"
          onClick={() => void stageRef.current?.requestFullscreen?.()}
        >
          <Maximize className="size-4" aria-hidden />
        </Button>
      </Hint>
    </>
  )

  return (
    <Workspace
      panel={panel}
      title="架構圖"
      description="逐層放大的專案架構（類似 C4 Model）：點兩下元件看內部流程；編輯模式可拖曳元件、拉線連接，匯出 PNG／SVG。"
      aside={
        <Segmented
          label="模式"
          value={mode}
          onChange={(m) => {
            setMode(m)
            if (m === 'view') (document.activeElement as HTMLElement | null)?.blur?.()
          }}
          options={[
            {
              value: 'view',
              label: (
                <>
                  <Eye aria-hidden />
                  檢視
                </>
              ),
            },
            {
              value: 'edit',
              label: (
                <>
                  <Pencil aria-hidden />
                  編輯
                </>
              ),
            },
          ]}
        />
      }
    >
      <Split
        main={
          <MainView toolbar={toolbar}>
            <div
              ref={stageRef}
              className={cn('min-h-0 flex-1 overflow-hidden rounded-xl')}
              style={{ background: SLIDE.bg }}
            >
              <ArchCanvas
                diagram={diagram}
                editable={editable}
                selection={selection}
                svgRef={svgRef}
                onSelect={setSelection}
                onDragStart={checkpoint}
                onMove={(id, x, y) =>
                  apply({ type: 'moveNode', diagram: diagram.id, node: id, x, y }, false)
                }
                onConnect={connect}
                onDrill={drill}
              />
            </div>
          </MainView>
        }
        readout={
          node ? (
            <NodeInspector key={node.id} node={node} {...inspectorProps} />
          ) : edge ? (
            <EdgeInspector key={edge.id} edge={edge} {...inspectorProps} />
          ) : (
            <DiagramSummary diagram={diagram} editable={editable} />
          )
        }
      />
    </Workspace>
  )
}
