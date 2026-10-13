import { expect, test } from '@playwright/test'

test('條碼：合成 EAN-13 解碼成功，各階影像與步驟可顯示', async ({ page }) => {
  await page.goto('/m1/barcode')
  await expect(page.getByText('解碼成功')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('4710088410108').first()).toBeVisible()
  await expect(page.getByText(/只用原圖：成功/)).toBeVisible()

  await page.getByRole('radio', { name: /各階影像/ }).click()
  await expect(page.getByAltText('送進解碼器的影像版本')).toBeVisible()
  await page.getByRole('radio', { name: /步驟/ }).click()
  await expect(page.getByRole('table', { name: '各階嘗試的結果與耗時' })).toBeVisible()
})

test('電子發票：找到左右兩碼並顯示 Big5 位元組', async ({ page }) => {
  await page.goto('/m1/barcode')
  await expect(page.getByText('解碼成功')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('radio', { name: /電子發票 QR/ }).click()
  await expect(page.getByText('找到左右兩碼')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('radio', { name: /位元組/ }).click()
  // 「茶葉蛋」的 Big5 位元組
  await expect(page.getByText(/AF F9 B8 AD B3 4A/)).toBeVisible()
})

test('營養標示：四角誤差符合驗收，各檢視可顯示', async ({ page }) => {
  await page.goto('/m1/label')
  await expect(page.getByText('處理完成')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('符合驗收（< 10 px）')).toBeVisible()
  for (const [name, alt] of [
    ['邊緣', '定位用的 Canny 邊緣圖'],
    ['光斑遮罩', '光斑遮罩'],
    ['輸出', '前處理後的營養標示'],
  ] as const) {
    await page.getByRole('radio', { name }).click()
    await expect(page.getByAltText(alt)).toBeVisible()
  }
})

test('食物照片：切出與真值相同的菜數', async ({ page }) => {
  await page.goto('/m1/food')
  await expect(page.getByText('處理完成')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('+0 相對真值')).toBeVisible()
  await page.getByRole('radio', { name: /各道菜/ }).click()
  await expect(page.getByAltText('第 3 道菜')).toBeVisible()
  await page.getByRole('radio', { name: /VLM 輸入/ }).click()
  await expect(page.getByAltText('VLM 實際收到的整張影像')).toBeVisible()
  await expect(page.getByRole('table', { name: /不同長邊上限/ })).not.toContainText('…', {
    timeout: 15_000,
  })
})

/** 在「影像」分頁設定一個退化滑桿旁的數字欄位 */
async function degrade(page: import('@playwright/test').Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).and(page.locator('input')).fill(value)
}

test('條碼：旋轉 45° 時只用原圖失敗，逐步升級仍可解碼', async ({ page }) => {
  await page.goto('/m1/barcode')
  await expect(page.getByText('解碼成功')).toBeVisible({ timeout: 30_000 })
  await degrade(page, '旋轉', '45')
  await expect(page.getByText(/只用原圖：失敗/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('解碼成功')).toBeVisible()
})

test('條碼：清空多尺度倍率時回報參數不合法', async ({ page }) => {
  await page.goto('/m1/barcode')
  await expect(page.getByText('解碼成功')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('tab', { name: /階梯參數/ }).click()
  await page.getByRole('button', { name: '×0.5' }).click()
  await page.getByRole('button', { name: '×2' }).click()
  await expect(page.getByRole('alert')).toContainText('參數不合法')
  await expect(page.getByRole('alert')).toContainText('scales')
})

test('營養標示：大面積光斑要求重拍', async ({ page }) => {
  await page.goto('/m1/label')
  await expect(page.getByText('處理完成')).toBeVisible({ timeout: 30_000 })
  await degrade(page, '光斑', '0.2')
  await expect(page.getByText('反光過大，請重拍')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('有警告')).toBeVisible()
})

test('食物照片：開啟盤緣找到 3 個；沒有盤子時警告', async ({ page }) => {
  await page.goto('/m1/food')
  await expect(page.getByText('處理完成')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('tab', { name: /參數/ }).click()
  await page.getByRole('switch', { name: '盤緣橢圓' }).click()
  await expect(page.getByText('盤緣').locator('..').getByText('3', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByRole('tab', { name: /影像/ }).click()
  await page.getByLabel('盤數', { exact: true }).fill('0')
  await expect(page.getByText('切不出任何一道菜')).toBeVisible({ timeout: 10_000 })
})
