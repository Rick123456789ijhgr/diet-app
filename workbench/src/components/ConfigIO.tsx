// 控制面板的「匯出入」分頁：匯出 JSON（可給 Python 的 config_from_json 讀）、Python 建構式、匯入。
import { Check, Copy, Download, FileUp } from 'lucide-react'
import { useState } from 'react'

import type { ConfigClass, ConfigOverride } from '@/api/client'
import { Button } from '@/components/ui/primitives'
import { ConfigImportError, exportJson, importJson, pythonCtor } from '@/lib/config'

export function ConfigIO({
  schema,
  overrides,
  onImport,
}: {
  schema: ConfigClass
  overrides: ConfigOverride
  onImport: (o: ConfigOverride) => void
}) {
  const json = exportJson(schema, overrides)
  const py = pythonCtor(schema, overrides)
  const [text, setText] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const doImport = () => {
    try {
      const o = importJson(schema, text)
      onImport(o)
      setMessage({ ok: true, text: `已匯入，修改 ${Object.keys(o).length} 項` })
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ConfigImportError ? err.message : '匯入失敗',
      })
    }
  }

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <h3 className="font-semibold">Python 建構式</h3>
        <p className="text-muted text-xs">只列出與預設值不同的欄位，可直接貼回程式或實驗設定。</p>
        <CodeBlock text={py} />
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">匯出 JSON</h3>
        <CodeBlock text={json} />
        <Button
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
            const a = document.createElement('a')
            a.href = url
            a.download = `${schema.name}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          <Download className="size-3.5" aria-hidden />
          下載
        </Button>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">匯入 JSON</h3>
        <textarea
          aria-label="匯入的設定 JSON"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"class": "QualityConfig", "values": {...}} 或 {"blur_min": 150}'
          className="border-card-border bg-card focus-visible:border-primary h-28 w-full rounded-md border p-2 font-mono text-xs focus-visible:outline-none"
        />
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={doImport}>
          <FileUp className="size-3.5" aria-hidden />
          匯入
        </Button>
        {message && (
          <p className={message.ok ? 'text-primary text-xs' : 'text-danger text-xs'} role="status">
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="bg-hover max-h-60 overflow-auto rounded-md p-2 pr-9 font-mono text-xs whitespace-pre-wrap">
        {text}
      </pre>
      <button
        type="button"
        aria-label="複製"
        className="text-muted hover:text-ink absolute top-1.5 right-1.5 rounded p-1"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          } catch {
            // 無剪貼簿權限時不處理，使用者可手動選取
          }
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}
