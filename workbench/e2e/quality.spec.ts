import { expect, test } from '@playwright/test'

// 防抖延遲（hooks/useDebounced 的預設值）；量測延遲時扣掉
const DEBOUNCE_MS = 150

test('品質檢查：合成影像、調整退化、切換檢視', async ({ page }) => {
  await page.goto('/m1/quality')
  await expect(page.getByText('通過品質檢查')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('模糊分數')).toBeVisible()

  // 拖動退化參數到結果更新的延遲（ADR 0003 目標：本機 < 200 ms，不含防抖）
  const sigma = page.getByLabel('模糊 σ', { exact: true }).and(page.locator('input'))
  const start = Date.now()
  await sigma.fill('6')
  await expect(page.getByText('過於模糊')).toBeVisible()
  const latency = Date.now() - start - DEBOUNCE_MS
  console.log(`退化＋品質檢查的端到端延遲（扣除防抖）：${latency} ms`)
  expect(latency).toBeLessThan(400) // 含瀏覽器重繪與測試框架輪詢的餘裕

  // 參數：提高模糊下限也會失敗；還原後恢復
  await sigma.fill('0')
  await expect(page.getByText('通過品質檢查')).toBeVisible()
  await page.getByRole('tab', { name: /參數/ }).click()
  const blurMin = page.getByLabel('模糊下限', { exact: true }).and(page.locator('input'))
  await blurMin.fill('100000')
  await expect(page.getByText('未通過')).toBeVisible()
  await page.getByRole('button', { name: '全部還原' }).click()
  await expect(page.getByText('通過品質檢查')).toBeVisible()

  // 各種檢視都能顯示
  for (const [name, check] of [
    ['邊緣響應', page.getByAltText('拉普拉斯響應熱度圖')],
    ['曝光遮罩', page.getByAltText('過暗與過亮像素遮罩')],
    ['直方圖', page.getByRole('img', { name: /灰階直方圖/ })],
    ['步驟', page.getByRole('table', { name: '處理步驟' })],
  ] as const) {
    await page.getByRole('radio', { name }).click()
    await expect(check).toBeVisible()
  }
})

test('上傳影像', async ({ page }) => {
  await page.goto('/m1/quality')
  await expect(page.getByText('通過品質檢查')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('radio', { name: /上傳/ }).click()
  await expect(page.getByText('在左側「影像」選擇要上傳的照片。')).toBeVisible()
  // 1×1 的灰色 PNG：短邊不足，應出現解析度不足
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.locator('input[type=file]').setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await expect(page.getByText('解析度不足')).toBeVisible({ timeout: 10_000 })
})
