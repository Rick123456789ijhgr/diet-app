// 控制面板的「匯出入」分頁：匯出 JSON（可給 Python 的 config_from_json 讀）、Python 建構式、匯入。
import { Check, Copy, Download, FileUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ConfigClass, ConfigOverride } from '@/api/client'
import { Button } from '@/components/ui/primitives'
import { ConfigImportError, exportJson, importJson, pythonCtor } from '@/lib/config'
import { downloadBlob } from '@/lib/download'

/**
 * 設定的匯出入。
 * - schema／overrides：目前的設定結構與覆寫；匯出內容每次渲染由兩者推導，不另存狀態。
 * - onImport：匯入成功後回傳新的覆寫（取代目前的覆寫）。
 * - title：同一頁有多組設定（例如條碼的階梯與解碼器）時，各組的標題；也加在匯入框的名稱上以便區分。
 */
export function ConfigIO({
  schema,
  overrides,
  onImport,
  title,
}: {
  schema: ConfigClass
  overrides: ConfigOverride
  onImport: (o: ConfigOverride) => void
  title?: string
}) {
  const json = exportJson(schema, overrides)
  const py = pythonCtor(schema, overrides)
  const [text, setText] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  // importJson 會檢查 JSON 格式、類別名稱與欄位型別，不合法時丟 ConfigImportError（訊息已是中文）；
  // 其他非預期例外只顯示通用訊息
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
      {title && <h2 className="text-base font-semibold">{title}</h2>}
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
          // 不需後端；URL 延後釋放（見 downloadBlob）
          onClick={() =>
            downloadBlob(new Blob([json], { type: 'application/json' }), `${schema.name}.json`)
          }
        >
          <Download className="size-3.5" aria-hidden />
          下載
        </Button>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">匯入 JSON</h3>
        <textarea
          aria-label={title ? `匯入的設定 JSON（${title}）` : '匯入的設定 JSON'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"class": "QualityConfig", "values": {...}} 或 {"blur_min": 150}'
          className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card readout h-28 w-full rounded-lg border p-2 text-xs focus-visible:outline-none"
        />
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={doImport}>
          <FileUp className="size-3.5" aria-hidden />
          匯入
        </Button>
        {message && (
          // role="status"：匯入結果出現時螢幕閱讀器會朗讀
          <p className={message.ok ? 'text-ok text-xs' : 'text-danger text-xs'} role="status">
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}

/** 唯讀程式碼區塊＋右上角複製按鈕；複製成功後圖示短暫（1.2 秒）變成打勾。 */
function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  // 「已複製」計時器；卸載時清除，避免對已卸載的元件更新狀態
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className="relative">
      <pre className="bg-sunken border-card-border readout max-h-60 overflow-auto rounded-lg border p-2 pr-9 text-xs whitespace-pre-wrap">
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
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1200)
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
