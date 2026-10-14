import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from '@playwright/test'

// 1×1 的灰色 PNG（解析度不足）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
)

test('參數掃描：品質檢查的觸發等級與條碼成功率', async ({ page }) => {
  await page.goto('/m1/sweep')
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
})

test('資料夾批次：逐張結果、單張檢視，測試集被拒絕', async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wb-batch-'))
  for (const name of ['a.png', 'b.png', 'c.png']) writeFileSync(path.join(dir, name), PNG)

  await page.goto('/m1/batch')
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

test('E1：快速執行後顯示整體成功率與信賴區間', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/m1/e1')
  await page.getByRole('tab', { name: '快速執行' }).click()
  // 只跑最小的一組，加快速度
  for (const arm of ['a6_full']) {
    const btn = page.getByRole('button', { name: arm, exact: true })
    if ((await btn.getAttribute('aria-pressed')) === 'true') await btn.click()
  }
  await page.getByRole('spinbutton', { name: '條碼數' }).fill('1')
  await page.getByRole('button', { name: '執行' }).click()
  await expect(page.getByText('完成，已切換到新的執行結果。')).toBeVisible({ timeout: 150_000 })
  await expect(page.getByRole('img', { name: /整體成功率長條圖/ })).toBeVisible()
  await expect(page.getByRole('table', { name: '各實驗組的整體彙整' })).toContainText('a0_raw')
})
