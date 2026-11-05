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

test('找最佳流程：上傳圖片、確認真值後顯示推薦流程', async ({ page }) => {
  test.setTimeout(120_000)
  // 檔名每次不同：結果資料夾中可能已有先前執行的同名圖片
  const tag = Date.now()
  const [one, two] = [`gray-${tag}-1.png`, `gray-${tag}-2.png`]
  await page.goto('/m1/results/best')
  await page.getByLabel('選擇圖片').setInputFiles([
    { name: one, mimeType: 'image/png', buffer: PNG },
    { name: two, mimeType: 'image/png', buffer: PNG },
  ])
  await page.getByRole('button', { name: '開始比較' }).click()
  // 灰色小圖沒有任何方法讀得到：兩張都是「未知」，尚無結論，直接帶到真值確認
  const list = page.getByRole('list', { name: '真值確認' })
  const row = (name: string) => list.getByRole('listitem').filter({ hasText: name })
  await expect(row(one)).toBeVisible({ timeout: 90_000 })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await row(one).getByLabel(`${one} 的條碼`).fill('4710088410108')
  await row(one).getByRole('button', { name: '採用', exact: true }).click()
  // 確定後該列移出「未確定」
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await row(two).getByRole('button', { name: '沒有條碼' }).click()
  await expect(page.getByText(/所有圖片都已確定真值/)).toBeVisible()
  await page.getByRole('radio', { name: /結論/ }).click()
  await expect(page.getByRole('list', { name: '推薦流程' })).toContainText('原圖')
  await expect(page.getByRole('table', { name: '三種做法的比較' })).toContainText('0／1')
})
