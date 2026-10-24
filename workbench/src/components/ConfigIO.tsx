// 控制面板的「匯出入」分頁：匯出 JSON（可給 Python 的 config_from_json 讀）、Python 建構式、匯入。
import { Check, Copy, Download, FileUp } from 'lucide-react'
import { useState } from 'react'

import type { ConfigClass, ConfigOverride } from '@/api/client'
import { Button } from '@/components/ui/primitives'
import { ConfigImportError, exportJson, importJson, pythonCtor } from '@/lib/config'

/**
 * 設定的匯出入。
 * - schema／overrides：目前的設定結構與覆寫；匯出內容每次渲染由兩者推導，不另存狀態。
 * - onImport：匯入成功後回傳新的覆寫（取代目前的覆寫）。
 */
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
          // 以 Blob URL＋暫時的 <a download> 觸發下載（不需後端）；點擊後立即釋放 URL，避免記憶體洩漏
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
