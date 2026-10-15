// 冷啟動上傳的編輯與確認：左側三個照片槽，右側草稿表單。
// 輸入停止 800 ms 後自動儲存（帶 If-Match）；確認時先儲存再送出，處理 409／412／422。
// 數字一律由後端決定：前端不計算、不換算、不檢查一致性，只顯示後端回報的問題。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CircleCheck, RotateCw, Save, Undo2 } from 'lucide-react'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import {
  api,
  ApiError,
  unwrap,
  type ConfirmProblem,
  type ConfirmRequest,
  type ConflictError,
  type Draft,
  type ImageKind,
  type NutritionIssue,
  type Product,
  type Submission,
} from '@/api/client'
import { ColdstartError, formatTime, StatusBadge, TextInput } from '@/components/coldstart/common'
import { DraftForm } from '@/components/coldstart/DraftForm'
import { ImageSlot } from '@/components/coldstart/ImageSlot'
import { ProductSummary, useProduct } from '@/components/coldstart/ProductSummary'
import { EmptyState, Section } from '@/components/layout/Workspace'
import { Button, Card } from '@/components/ui/primitives'
import { COLDSTART_KEY } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'
import {
  basisLabel,
  draftToForm,
  fieldLabel,
  formToDraft,
  IMAGE_KINDS,
  inMissing,
  sameDraft,
  type FormValues,
} from '@/lib/coldstart'
import { errorText, issueText, nutrientText } from '@/lib/text'

export const AUTOSAVE_MS = 800

const submissionKey = (id: string) => [COLDSTART_KEY, 'submission', id]

export function SubmissionPage() {
  const { id = '' } = useParams()
  const query = useQuery({
    queryKey: submissionKey(id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/workbench/v1/coldstart/submissions/{submission_id}', {
          params: { path: { submission_id: id } },
          signal,
        }),
      ),
  })
  // 重新載入時以新的內容重建編輯器（丟掉本機未儲存的輸入）
  const [generation, setGeneration] = useState(0)
  const reload = async () => {
    const r = await query.refetch()
    if (r.data) setGeneration((g) => g + 1)
  }

  if (query.isError && !query.data) {
    return (
      <div className="p-5">
        <BackLink />
        <ColdstartError error={query.error} className="mt-3" />
      </div>
    )
  }
  if (!query.data) return <EmptyState>載入中…</EmptyState>
  return <Editor key={`${id}:${generation}`} initial={query.data} onReload={reload} />
}

function BackLink() {
  return (
    <Link
      to="/coldstart/submissions"
      className="text-muted hover:text-ink inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-4" aria-hidden />
      上傳清單
    </Link>
  )
}

/** 草稿經表單來回轉換一次，才能與表單送出的內容比較 */
const normalize = (d: Draft) => formToDraft(draftToForm(d)).draft

/** 確認的請求；accept_warnings 省略時送 false */
type ConfirmInput = Omit<ConfirmRequest, 'accept_warnings'> & { accept_warnings?: boolean }

type Problem =
  | { kind: 'exists'; product?: Product }
  | { kind: 'incomplete'; missing: string[] }
  | { kind: 'inconsistent'; issues: NutritionIssue[]; request: ConfirmInput }
  | { kind: 'error'; error: unknown }

const MODE_DONE: Record<ConfirmRequest['mode'], string> = {
  create: '已建立產品',
  add_images: '已把照片補到既有產品',
  revise_nutrition: '已修正既有產品的營養數值',
}

function Editor({ initial, onReload }: { initial: Submission; onReload: () => Promise<void> }) {
  const client = useQueryClient()
  const [sub, setSub] = useState(initial)
  const [form, setForm] = useState<FormValues>(() => draftToForm(initial.draft))
  const [saved, setSaved] = useState<Draft>(() => normalize(initial.draft))
  const [saving, setSaving] = useState(0)
  const [saveError, setSaveError] = useState<unknown>()
  /** 412（已被其他人修改）或 409 SUBMISSION_CLOSED：停止寫入，請人重新載入 */
  const [stale, setStale] = useState<ApiError | null>(null)
  const [uploading, setUploading] = useState<Partial<Record<ImageKind, boolean>>>({})
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<ImageKind, unknown>>>({})
  const [missing, setMissing] = useState<string[]>([])
  const [problem, setProblem] = useState<Problem | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<{ product: Product; mode: ConfirmRequest['mode'] } | null>(null)

  // 寫入一律排隊依序送出，每次都帶最新的版本（updated_at），避免自己的請求互相 412
  const version = useRef(initial.updated_at)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const blocked = useRef(false)

  const id = sub.id
  const editable = sub.status === 'draft' && !stale
  const { draft, invalid } = useMemo(() => formToDraft(form), [form])
  const dirty = !sameDraft(draft, saved)

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = queue.current.then(fn)
    queue.current = p.catch(() => undefined)
    return p
  }

  function apply(next: Submission) {
    version.current = next.updated_at
    setSub(next)
    client.setQueryData(submissionKey(next.id), next)
    void client.invalidateQueries({ queryKey: [COLDSTART_KEY, 'submissions'] })
  }

  /** 412、409 SUBMISSION_CLOSED 時停止寫入；回傳是否已處理 */
  function handleStale(err: unknown): boolean {
    if (
      err instanceof ApiError &&
      (err.status === 412 || (err.status === 409 && err.code === 'SUBMISSION_CLOSED'))
    ) {
      blocked.current = true
      setStale(err)
      return true
    }
    return false
  }

  const save = (d: Draft) =>
    enqueue(async () => {
      if (blocked.current) return false
      setSaving((n) => n + 1)
      try {
        const next = await unwrap(
          api.PUT('/workbench/v1/coldstart/submissions/{submission_id}/draft', {
            params: { path: { submission_id: id }, header: { 'If-Match': version.current } },
            body: d,
          }),
        )
        apply(next)
        setSaved(d)
        setSaveError(undefined)
        return true
      } catch (err) {
        if (!handleStale(err)) setSaveError(err)
        return false
      } finally {
        setSaving((n) => n - 1)
      }
    })

  // 自動儲存：輸入停止 AUTOSAVE_MS 後送出；格式不正確或已停止寫入時不送
  const autosave = useEffectEvent(() => void save(draft))
  useEffect(() => {
    if (!editable || !dirty || invalid.length > 0) return
    const t = setTimeout(autosave, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [editable, dirty, invalid.length, draft])

  // 離開頁面時把還沒送出的輸入存起來；關閉分頁前若有未儲存的變更則提醒
  const flushOnLeave = useEffectEvent(() => {
    if (editable && dirty && invalid.length === 0) void save(draft)
  })
  useEffect(() => () => flushOnLeave(), [])
  useEffect(() => {
    if (!dirty || !editable) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, editable])

  /** 把目前的輸入存好（沒有變更時等排隊中的寫入完成）；失敗回傳 false */
  const flush = async () => {
    if (invalid.length > 0) return false
    if (dirty) return save(draft)
    return enqueue(async () => !blocked.current)
  }

  const upload = (kind: ImageKind, file: File) => {
    setUploading((u) => ({ ...u, [kind]: true }))
    setUploadErrors((e) => ({ ...e, [kind]: undefined }))
    void enqueue(async () => {
      try {
        const next = await unwrap(
          api.PUT('/workbench/v1/coldstart/submissions/{submission_id}/images/{kind}', {
            params: { path: { submission_id: id, kind } },
            body: { file: '' },
            bodySerializer: () => {
              const f = new FormData()
              f.append('file', file)
              return f
            },
          }),
        )
        apply(next)
        // 後端可能預先填入條碼（條碼照片解出唯一條碼、草稿尚未填時）；本機已輸入的不覆蓋
        setSaved(normalize(next.draft))
        const prefilled = next.draft.barcode
        if (prefilled) setForm((f) => (f.barcode.trim() ? f : { ...f, barcode: prefilled }))
      } catch (err) {
        if (!handleStale(err)) setUploadErrors((e) => ({ ...e, [kind]: err }))
      } finally {
        setUploading((u) => ({ ...u, [kind]: false }))
      }
    })
  }

  const confirm = async (request: ConfirmInput) => {
    setConfirming(true)
    setProblem(null)
    try {
      if (invalid.length > 0) {
        setProblem({
          kind: 'error',
          error: new Error('有欄位不是合法的數字，請先修正標紅的欄位再確認。'),
        })
        return
      }
      if (!(await flush())) return
      const res = await enqueue(() =>
        unwrap(
          api.POST('/workbench/v1/coldstart/submissions/{submission_id}/confirm', {
            params: { path: { submission_id: id }, header: { 'If-Match': version.current } },
            body: { accept_warnings: false, ...request },
          }),
        ),
      )
      apply(res.submission)
      client.setQueryData([COLDSTART_KEY, 'product', res.product.barcode], res.product)
      setDone({ product: res.product, mode: request.mode })
      setMissing([])
    } catch (err) {
      if (handleStale(err)) return
      if (err instanceof ApiError && err.status === 409 && err.code === 'BARCODE_EXISTS') {
        setProblem({ kind: 'exists', product: (err.body as ConflictError | undefined)?.product })
      } else if (err instanceof ApiError && err.code === 'DRAFT_INCOMPLETE') {
        const m = (err.body as ConfirmProblem | undefined)?.missing ?? []
        setMissing(m)
        setProblem({ kind: 'incomplete', missing: m })
      } else if (err instanceof ApiError && err.code === 'NUTRITION_INCONSISTENT') {
        setMissing([])
        const issues = (err.body as ConfirmProblem | undefined)?.issues ?? []
        setProblem({ kind: 'inconsistent', issues, request })
      } else {
        setProblem({ kind: 'error', error: err })
      }
    } finally {
      setConfirming(false)
    }
  }

  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState<unknown>()
  const reject = async () => {
    setRejectError(undefined)
    try {
      const next = await enqueue(() =>
        unwrap(
          api.POST('/workbench/v1/coldstart/submissions/{submission_id}/reject', {
            params: { path: { submission_id: id }, header: { 'If-Match': version.current } },
            body: { reason: rejectReason.trim() },
          }),
        ),
      )
      apply(next)
    } catch (err) {
      if (!handleStale(err)) setRejectError(err)
    }
  }

  const imageOf = (k: ImageKind) => sub.images.find((i) => i.kind === k)
  const decoded = (imageOf('barcode')?.preprocess.barcodes ?? []).map((b) => b.text)
  const busy = saving > 0 || confirming

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(340px,5fr)_minmax(440px,6fr)] gap-3 pr-3 pb-3">
      <section aria-label="照片" className="flex min-h-0 flex-col gap-3 overflow-y-auto px-1">
        <BackLink />
        {IMAGE_KINDS.map((k) => (
          <ImageSlot
            key={k}
            submissionId={id}
            kind={k}
            image={imageOf(k)}
            editable={editable}
            uploading={!!uploading[k]}
            error={uploadErrors[k]}
            missing={inMissing(missing, `images.${k}`) && !imageOf(k)}
            onFile={(f) => upload(k, f)}
          />
        ))}
      </section>

      <section
        aria-label="人工確認"
        className="bg-card shadow-card min-w-0 overflow-y-auto rounded-[20px] p-5"
      >
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-[22px] leading-tight font-semibold tracking-tight">
              <span className="truncate">{form.name.trim() || '未命名的上傳'}</span>
              <StatusBadge status={sub.status} />
            </h1>
            <p className="text-muted mt-0.5 text-xs">
              {sub.created_by.display_name} 建立於 {formatTime(sub.created_at)}
              {sub.confirmed_by &&
                `・${sub.confirmed_by.display_name} 確認於 ${formatTime(sub.confirmed_at)}`}
            </p>
          </div>
          {sub.status === 'draft' && (
            <div className="flex items-center gap-2">
              <SaveStatus
                saving={saving > 0}
                dirty={dirty}
                invalid={invalid.length > 0}
                error={saveError !== undefined}
                stale={!!stale}
              />
              <Button
                onClick={() => void save(draft)}
                disabled={!editable || busy || invalid.length > 0}
              >
                <Save className="size-4" aria-hidden />
                儲存
              </Button>
              <Button
                variant="primary"
                onClick={() => void confirm({ mode: 'create' })}
                disabled={!editable || busy}
              >
                <CircleCheck className="size-4" aria-hidden />
                {confirming ? '確認中…' : '確認並建立產品'}
              </Button>
            </div>
          )}
        </div>

        {stale && (
          <div
            role="alert"
            className="bg-danger-soft mb-4 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm"
          >
            <div className="flex-1">
              <div className="text-danger font-semibold">{errorText(stale.code)}</div>
              <div className="text-muted text-xs">
                已停止自動儲存。重新載入會取得最新內容，本頁尚未儲存的輸入會被捨棄。
              </div>
            </div>
            <Button onClick={() => void onReload()}>
              <RotateCw className="size-4" aria-hidden />
              重新載入
            </Button>
          </div>
        )}
        {saveError !== undefined && !stale && <ColdstartError error={saveError} className="mb-4" />}

        {problem && (
          <ProblemPanel
            problem={problem}
            unit={form.content_unit}
            busy={busy}
            onConfirm={(r) => void confirm(r)}
            onCancel={() => setProblem(null)}
          />
        )}

        {done && (
          <div className="mb-4">
            <ProductSummary product={done.product} title={MODE_DONE[done.mode]} />
          </div>
        )}
        {!done && sub.status === 'confirmed' && <ConfirmedProduct barcode={sub.draft.barcode} />}
        {sub.status === 'rejected' && (
          <Card className="bg-danger-soft mb-4 px-4 py-3 text-sm shadow-none" role="status">
            <span className="text-danger font-semibold">已退回</span>
            {sub.reject_reason && <span className="ml-2">原因：{sub.reject_reason}</span>}
          </Card>
        )}

        <Section title="標示內容">
          <DraftForm
            form={form}
            setForm={setForm}
            readOnly={!editable}
            invalid={invalid}
            missing={missing}
            decodedBarcodes={decoded}
          />
        </Section>

        {sub.status === 'draft' && (
          <Section title="退回">
            <div className="flex items-start gap-2">
              <TextInput
                aria-label="退回原因"
                placeholder="例如：照片不是包裝、重複上傳"
                value={rejectReason}
                readOnly={!editable}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <Button onClick={() => void reject()} disabled={!editable || !rejectReason.trim()}>
                <Undo2 className="size-4" aria-hidden />
                退回
              </Button>
            </div>
            {rejectError !== undefined && <ColdstartError error={rejectError} className="mt-2" />}
          </Section>
        )}
      </section>
    </div>
  )
}

function SaveStatus({
  saving,
  dirty,
  invalid,
  error,
  stale,
}: {
  saving: boolean
  dirty: boolean
  invalid: boolean
  error: boolean
  stale: boolean
}) {
  const [text, bad] = stale
    ? ['已停止儲存', true]
    : saving
      ? ['儲存中…', false]
      : invalid
        ? ['有欄位不是合法的數字，尚未儲存', true]
        : error
          ? ['儲存失敗', true]
          : dirty
            ? ['有未儲存的變更', false]
            : ['已儲存', false]
  return (
    <span role="status" className={cn('text-xs', bad ? 'text-danger' : 'text-muted')}>
      {text}
    </span>
  )
}

function ProblemPanel({
  problem,
  unit,
  busy,
  onConfirm,
  onCancel,
}: {
  problem: Problem
  unit: FormValues['content_unit']
  busy: boolean
  onConfirm: (r: ConfirmInput) => void
  onCancel: () => void
}) {
  const [accepted, setAccepted] = useState(false)
  if (problem.kind === 'error') return <ColdstartError error={problem.error} className="mb-4" />
  return (
    <Card role="alert" className="bg-danger-soft mb-4 px-4 py-3 text-sm shadow-none">
      {problem.kind === 'incomplete' && (
        <>
          <div className="text-danger font-semibold">{errorText('DRAFT_INCOMPLETE')}</div>
          <p className="text-muted mt-0.5 text-xs">請補上以下標紅的欄位後再確認：</p>
          <ul className="mt-2 list-disc pl-5">
            {problem.missing.map((m) => (
              <li key={m}>{fieldLabel(m, unit)}</li>
            ))}
          </ul>
        </>
      )}
      {problem.kind === 'inconsistent' && (
        <>
          <div className="text-danger font-semibold">{errorText('NUTRITION_INCONSISTENT')}</div>
          <p className="text-muted mt-0.5 text-xs">
            請先對照營養標示照片確認輸入沒有打錯；若標示本身確實如此，可勾選後照原樣存入。
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {problem.issues.map((i, n) => (
              <li key={n}>
                <span className="font-medium">{issueText(i.code)}</span>
                <span className="text-muted">
                  （{basisLabel(i.basis, unit)}
                  {i.nutrient && `・${nutrientText(i.nutrient)}`}）
                </span>
                {(i.expected !== undefined || i.actual !== undefined) && (
                  <span className="tabular ml-2">
                    預期 {i.expected ?? '—'}，實際 {i.actual ?? '—'}
                  </span>
                )}
                <div className="text-muted text-xs">{i.message}</div>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            我已核對標示確實如此，照原樣存入
          </label>
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              disabled={!accepted || busy}
              onClick={() => onConfirm({ ...problem.request, accept_warnings: true })}
            >
              照原樣存入
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              取消
            </Button>
          </div>
        </>
      )}
      {problem.kind === 'exists' && (
        <>
          <div className="text-danger font-semibold">{errorText('BARCODE_EXISTS')}</div>
          <p className="text-muted mt-0.5 mb-3 text-xs">
            可以把這次的照片補到既有產品，或以這次輸入的數值修正既有產品的營養標示（舊版保留）。
          </p>
          {problem.product && <ProductSummary product={problem.product} title="既有產品" />}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy || !problem.product}
              onClick={() => onConfirm({ mode: 'add_images', product_id: problem.product!.id })}
            >
              補照片到既有產品
            </Button>
            <Button
              disabled={busy || !problem.product}
              onClick={() =>
                onConfirm({ mode: 'revise_nutrition', product_id: problem.product!.id })
              }
            >
              修正既有產品的營養數值
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              取消
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

/** 已確認的上傳：以條碼查出目前的產品內容 */
function ConfirmedProduct({ barcode }: { barcode?: string }) {
  const product = useProduct(barcode ?? '')
  if (!barcode) return null
  if (product.isError) return <ColdstartError error={product.error} className="mb-4" />
  if (product.isPending) return <p className="text-muted mb-4 text-sm">載入產品中…</p>
  if (!product.data) return <p className="text-muted mb-4 text-sm">查無此產品（{barcode}）。</p>
  return (
    <div className="mb-4">
      <ProductSummary product={product.data} title="產品" />
    </div>
  )
}
