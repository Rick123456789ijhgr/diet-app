import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from '@playwright/test'

// 1×1 的灰色 PNG（解析度不足）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
)

test('多張測試・參數掃描：品質檢查的觸發等級與條碼成功率', async ({ page }) => {
  await page.goto('/m1/multi/sweep')
  await expect(page.getByRole('img', { name: /模糊分數隨高斯模糊 σ變化/ })).toBeVisible({
    timeout: 30_000,
  })
  // 合成標示模糊到 σ=8 時一定過於模糊
  await expect(page.getByText(/^≥ /).first()).toBeVisible()

  await page.getByRole('radio', { name: /條碼解碼/ }).click()
  await expect(page.getByRole('img', { name: /兩種方法的成功率/ })).toBeVisible({ timeout: 30_000 })
  // 旋轉到 45° 時只用原圖會失敗，逐步升級全部成功
  await expect(page.getByText(/首次失敗於/)).toBeVisible()
  await expect(page.getByText('全部成功')).toBeVisible()
  // 同一批樣本的品質門檻對照
  await page.getByRole('radio', { name: /品質門檻/ }).click()
  await expect(page.getByRole('img', { name: /品質不通過率/ })).toBeVisible()

  // 營養標示：合成標示對真實四角評分；未退化時一定找得到
  await page.getByRole('radio', { name: /營養標示/ }).click()
  await expect(page.getByRole('img', { name: /定位結果隨/ })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('radio', { name: /四角誤差/ }).click()
  await expect(page.getByRole('img', { name: /四角誤差中位數/ })).toBeVisible()
})

test('多張測試・資料夾批次：逐張結果、單張檢視，測試集被拒絕', async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wb-batch-'))
  for (const name of ['a.png', 'b.png', 'c.png']) writeFileSync(path.join(dir, name), PNG)

  await page.goto('/m1/multi/folder')
  await page.getByRole('textbox', { name: '資料夾' }).fill(dir)
  await page.getByRole('button', { name: '執行' }).click()
  const table = page.getByRole('table', { name: '每張影像的品質檢查結果' })
  await expect(table.getByRole('row')).toHaveCount(4, { timeout: 30_000 }) // 表頭＋3 張
  await expect(page.getByText('解析度不足', { exact: true })).toBeVisible()
  await table.getByText('b.png').click()
  await expect(page.getByAltText('b.png（original）')).toBeVisible()

  const locked = path.join(dir, 'splits', 'test')
  mkdirSync(locked, { recursive: true })
  await page.getByRole('textbox', { name: '資料夾' }).fill(locked)
  await page.getByRole('button', { name: '執行' }).click()
  await expect(page.getByRole('alert')).toContainText('測試集已鎖定')
})

test('實驗結果・E1：快速執行後顯示整體成功率與信賴區間', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/m1/results/e1')
  await page.getByRole('button', { name: /快速執行/ }).click()
  // 只跑最小的一組，加快速度
  for (const arm of ['a6_full']) {
    await page.getByRole('checkbox', { name: arm, exact: true }).uncheck()
  }
  await page.getByRole('spinbutton', { name: '條碼數' }).fill('1')
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByText('完成，已切換到新的執行結果。')).toBeVisible({ timeout: 150_000 })
  await expect(page.getByRole('img', { name: /整體成功率長條圖/ })).toBeVisible()
  await expect(page.getByRole('table', { name: '各實驗組的整體彙整' })).toContainText('a0_raw')
})

test('找最佳流程：上傳圖片、逐張確認真值、比較後顯示推薦流程', async ({ page }) => {
  test.setTimeout(120_000)
  // 檔名每次不同：避免與先前執行的同名圖片混淆
  const tag = Date.now()
  const [one, two] = [`gray-${tag}-1.png`, `gray-${tag}-2.png`]
  await page.goto('/m1/results/best')
  await page.getByLabel('選擇圖片').setInputFiles([
    { name: one, mimeType: 'image/png', buffer: PNG },
    { name: two, mimeType: 'image/png', buffer: PNG },
  ])
  await page.getByRole('button', { name: /下一步：逐張確認真值/ }).click()
  // 灰色小圖讀不到條碼：看圖輸入號碼，Enter 確認並換下一張
  await expect(page.getByText('原圖讀不到條碼')).toBeVisible({ timeout: 30_000 })
  const input = page.getByRole('textbox', { name: '條碼號碼' })
  await input.fill('4710088410108')
  await input.press('Enter')
  await expect(page.getByText(/^第 2 張/)).toBeVisible()
  await page.getByRole('button', { name: '沒有條碼' }).click()
  // 處理流程：選內建的「只用原圖」方案
  await page.getByRole('button', { name: /下一步：選擇處理流程/ }).click()
  await page
    .getByRole('navigation', { name: '處理流程方案' })
    .getByRole('button', { name: /只用原圖/ })
    .click()
  await page.getByRole('button', { name: '開始比較' }).click()
  await expect(page.getByRole('list', { name: '推薦流程' })).toContainText('原圖', {
    timeout: 90_000,
  })
  await page.getByText('三種做法的詳細數字').click()
  await expect(page.getByRole('table', { name: '三種做法的比較' })).toContainText('0／1')
  // 人工確認的真值以原檔名為 ID 存進執行
  await page.getByRole('radio', { name: /真值/ }).click()
  await page.getByRole('radio', { name: /全部/ }).click()
  const list = page.getByRole('list', { name: '真值確認' })
  const row = (name: string) => list.getByRole('listitem').filter({ hasText: name })
  await expect(row(one)).toContainText('採用 4710088410108（人工）')
  await expect(row(two)).toContainText('沒有條碼（人工）')
  // 改原始照片檔名的指令
  await page.getByRole('button', { name: '把原始照片改名' }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByText(/rename_by_truth\.py/)
      .first(),
  ).toBeVisible()
})
