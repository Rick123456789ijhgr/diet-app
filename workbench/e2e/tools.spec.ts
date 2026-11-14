// 通用工具的冒煙測試：總覽按鈕 → 圖片批次命名（接真的 Go 與 Python，改暫存資料夾裡的檔案）。
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from '@playwright/test'

// 1×1 的灰色 PNG：命名工具只看檔名，不解碼影像
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
  'base64',
)
const CODE = '4710088410108'

test('通用工具・圖片批次命名：預覽、改名、還原', async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wb-naming-'))
  writeFileSync(path.join(dir, `${CODE}.png`), PNG)
  writeFileSync(path.join(dir, '沒有條碼_IMG_1.png'), PNG)

  await page.goto('/tools')
  await page
    .getByRole('navigation', { name: '通用工具' })
    .getByRole('link', { name: /圖片批次命名/ })
    .click()
  await expect(page).toHaveURL(/\/tools\/naming$/)

  await page.getByLabel('資料夾', { exact: true }).fill(dir)
  await page.getByRole('radio', { name: /其他物品/ }).click()
  await page.getByRole('button', { name: '預覽' }).click()
  const table = page.getByRole('table', { name: '改名預覽' })
  await expect(table.getByText(`o_a01_001_${CODE}.png`)).toBeVisible({ timeout: 30_000 })
  await expect(table.getByText('o_a01_002_nocode.png')).toBeVisible()

  await page.getByRole('button', { name: '改名 2 個檔案' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '改名' }).click()
  await expect(page.getByText('已改名 2 個檔案。')).toBeVisible()
  expect(readdirSync(dir).sort()).toEqual(
    ['_rename_log.csv', `o_a01_001_${CODE}.png`, 'o_a01_002_nocode.png'].sort(),
  )

  await page.getByRole('button', { name: '還原先前的改名' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '還原' }).click()
  await expect(page.getByText('已還原 2 個檔案。')).toBeVisible()
  expect(existsSync(path.join(dir, `${CODE}.png`))).toBe(true)
})
