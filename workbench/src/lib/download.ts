// 不經後端，在瀏覽器產生檔案並下載。

/** 物件 URL 延後釋放的時間：點擊後立即 revoke 時，少數瀏覽器還沒開始讀取就失效而下載失敗。 */
export const REVOKE_DELAY_MS = 10_000

/**
 * 以 Blob URL＋暫時的 <a download> 觸發下載，延後釋放 URL。
 * 計時器不需要在元件卸載時清除：只釋放 URL，不更新任何 React 狀態。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
