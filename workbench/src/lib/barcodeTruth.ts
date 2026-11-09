// 找最佳流程「逐張確認真值」用的純函式：人工輸入號碼的正規化與檢查、由檔名推回號碼、送出用的圖片 ID。
// 依真值把原始照片改名由 Python 工具負責（research/experiments/e1_barcode/rename_by_truth.py）。
// 檢查只為了在輸入當下提示；送出後仍由後端（dietai.devtools.best_flow.set_truth）判定是否合法。

/** 人工輸入的號碼：去除空白；12 位（UPC-A）補成 13 位。與後端 normalize_truth 相同。 */
export function normalizeCode(text: string): string {
  const s = text.replace(/\s+/g, '')
  return /^\d{12}$/.test(s) ? `0${s}` : s
}

/** EAN-13 或 EAN-8（含檢查碼）；輸入須先經 normalizeCode。 */
export function validCode(code: string): boolean {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false
  const digits = [...code].map(Number)
  const check = digits.pop()!
  // 由右往左（不含檢查碼）權重依序為 3、1、3、1…；EAN-8 與 EAN-13 同一條規則
  const total = digits.reverse().reduce((sum, d, i) => sum + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (total % 10)) % 10 === check
}

/** 檢查人工輸入，回傳給畫面顯示的狀態。 */
export function checkCode(text: string): { code: string; ok: boolean; message: string } {
  const code = normalizeCode(text)
  if (!code) return { code, ok: false, message: '輸入條碼號碼' }
  if (!/^\d+$/.test(code)) return { code, ok: false, message: '只能輸入數字' }
  if (code.length !== 8 && code.length !== 13) {
    return { code, ok: false, message: `${code.length} 位：條碼應為 8、12 或 13 位` }
  }
  if (!validCode(code)) return { code, ok: false, message: '檢查碼不對，請再核對一次' }
  return { code, ok: true, message: code.length === 8 ? 'EAN-8 檢查碼正確' : 'EAN-13 檢查碼正確' }
}

/** Python 改名工具把「沒有條碼」的照片改成這個前綴開頭；由檔名推回答案時認這個前綴。 */
export const NO_CODE_PREFIX = '沒有條碼_'

/** 一張圖的答案：條碼、沒有條碼，或跳過（交給程式自動推定）。 */
export type Answer = { kind: 'code'; code: string } | { kind: 'none' } | { kind: 'skip' }

/** 拆出主檔名與副檔名（副檔名含句點；沒有時為空字串）。 */
export function splitName(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.')
  return i > 0 ? { stem: name.slice(0, i), ext: name.slice(i) } : { stem: name, ext: '' }
}

/**
 * 由檔名推回答案：檔名就是合法的條碼（可接 _2、-3 之類的序號）→ 條碼；
 * 以「沒有條碼_」開頭 → 沒有條碼；其他 → null。讓改過名的圖片下次放進來就帶入號碼。
 */
export function answerFromName(name: string): Answer | null {
  const { stem } = splitName(name)
  if (stem.startsWith(NO_CODE_PREFIX)) return { kind: 'none' }
  const m = /^(\d{8}|\d{12,13})(?:[_\-\s(#].*)?$/.exec(stem)
  if (!m) return null
  const code = normalizeCode(m[1]!)
  return validCode(code) ? { kind: 'code', code } : null
}

/**
 * 上傳後執行裡的圖片 ID：就是上傳時的檔名；同名的第二張起加「#2」「#3」…
 * 與後端 dietai.devtools.best_flow._write_inputs 的規則相同（送出人工真值時要用這個 ID）。
 */
export function uploadIds(names: readonly string[]): string[] {
  const seen = new Set<string>()
  return names.map((name) => {
    let out = name
    for (let i = 2; seen.has(out); i++) out = `${name}#${i}`
    seen.add(out)
    return out
  })
}

/** 送給後端的人工真值：條碼或空字串（沒有條碼）；跳過與未作答的不送，交給程式推定。 */
export function truthsOf(
  names: readonly string[],
  answers: readonly (Answer | null)[],
): Record<string, string> {
  const out: Record<string, string> = {}
  answers.forEach((a, i) => {
    if (a?.kind === 'code') out[names[i]!] = a.code
    else if (a?.kind === 'none') out[names[i]!] = ''
  })
  return out
}
