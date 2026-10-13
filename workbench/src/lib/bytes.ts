// 解碼結果原始位元組的顯示（後端以 base64 傳來）。中文解碼由之後的發票模組負責，這裡只顯示位元組。

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** 十六進位，例如「AF F9 B8 A6」；超過 limit 個位元組時截斷並註明總數。 */
export function hexPreview(bytes: Uint8Array, limit = 48): string {
  const hex = Array.from(bytes.slice(0, limit), (b) =>
    b.toString(16).toUpperCase().padStart(2, '0'),
  )
  const more = bytes.length > limit ? ` …（共 ${bytes.length} bytes）` : ''
  return hex.join(' ') + more
}

/** 可列印的 ASCII 原樣顯示，其他位元組以「.」代替。 */
export function asciiPreview(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
}
