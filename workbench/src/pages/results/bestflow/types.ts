// 找最佳流程：本頁自行宣告的後端回應形狀與共用的小工具。
// 以下型別是本頁自行宣告的後端回應形狀（規格中為自由 JSON：FreeJson），
// 由 dietai.devtools.best_flow.run_json 產生；欄位改名時這裡不會有型別錯誤提醒。

/** GET /dev/e1/runs：本頁只用找最佳流程的執行清單。 */
export interface RunList {
  root: string
  best_flow_runs?: { name: string; path: string }[]
}

/** 一個候選條碼：解出它的方法與檢查碼是否正確。 */
export interface Candidate {
  code: string
  methods: string[]
  checksum_ok: boolean
}

/** 真值表的一列。status：auto（自動推定）、review（需確認）、unknown（沒有方法讀到）。 */
export interface ImageRow {
  id: string
  image: string
  status: 'auto' | 'review' | 'unknown'
  truth: string
  candidates: Candidate[]
  /** 採用的真值；null 為尚未確定（不納入統計）。truth 空字串表示沒有條碼 */
  applied: { truth: string; source: 'auto' | 'manual' } | null
  error: string
  thumb_id: string
}

/** dietai.evaluation.summarize 的一列（單一方法或一條流程）。 */
export interface Summary {
  arm: string
  n: number
  correct: number
  rate: number | null
  ci_low: number | null
  ci_high: number | null
  misread: number
  missed: number
  negatives: number
  false_positive: number
  errors: number
  median_ms: number | null
  lost?: number
  gained?: number
  p_value?: number
}

/** 貪婪選擇的一步：加入這個方法多救回幾張、新增幾張誤讀／誤報，以及加入後的累計結果。 */
export interface Step {
  method: string
  rescued: number
  new_misread: number
  new_false_positive: number
  correct: number
  positives: number
  misread: number
  false_positive: number
  rate: number | null
  mean_ms: number
}

export interface Result {
  methods: Summary[]
  error?: string
  greedy?: {
    order: string[]
    stop: 'min_gain' | 'constraints' | 'exhausted'
    excluded: number
    steps: Step[]
  }
  compare?: { orders: Record<string, string[]>; summary: Summary[] }
  export?: { class: string; values: Record<string, unknown>; exact: boolean }
  errors?: number
}

/** GET /dev/best-flow/runs/{run_id}：真值表與結論。 */
export interface Run {
  name: string
  path: string
  meta: { created: string; source: string; images: number; min_methods: number }
  counts: {
    images: number
    decided: number
    undecided: number
    positives: number
    negatives: number
    auto: number
    review: number
    unknown: number
  }
  images: ImageRow[]
  result: Result | null
}

/** 執行的 SSE 事件：start → 多筆 progress → done（帶新執行的名稱）。 */
export type RunEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; name: string; path: string }

/** 貪婪選擇的準則；maxMeanMs 為 0 表示不限。 */
export interface Criteria {
  minGain: number
  maxNewWrong: number
  maxMeanMs: number
}

export const STOP_TEXT: Record<string, string> = {
  min_gain: '下一個方法能多救回的張數低於下限',
  constraints: '剩下的方法都會增加誤讀／誤報，或超過耗時上限',
  exhausted: '所有方法都已加入',
}

/** 比較的三條流程。 */
export const LADDER_TEXT: Record<string, string> = {
  raw: '只用原圖',
  greedy: '推薦流程',
  all: '全部方法依序都試',
}

export const STATUS_BADGE: Record<
  ImageRow['status'],
  { tone: 'ok' | 'warn' | 'danger'; text: string }
> = {
  auto: { tone: 'ok', text: '自動' },
  review: { tone: 'warn', text: '需確認' },
  unknown: { tone: 'danger', text: '未知' },
}

/** 比例轉百分比字串（一位小數）；null 顯示「—」。 */
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

/** 查詢參數：準則只送與預設值不同的部分（0 表示不限的耗時不送）。 */
export function criteriaQuery(root: string, c: Criteria) {
  return {
    ...(root ? { root } : {}),
    ...(c.minGain !== 1 ? { min_gain: c.minGain } : {}),
    ...(c.maxNewWrong !== 0 ? { max_new_wrong: c.maxNewWrong } : {}),
    ...(c.maxMeanMs > 0 ? { max_mean_ms: c.maxMeanMs } : {}),
  }
}

export const DEFAULT_CRITERIA: Criteria = { minGain: 1, maxNewWrong: 0, maxMeanMs: 0 }
