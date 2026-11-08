// 專案架構圖的冒煙測試：純前端，不需要 Python；拖曳、拉線、逐層進入、匯出 PNG。
import { expect, test } from '@playwright/test'

test('架構圖：拖曳元件、拉線連接、逐層進入、匯出 PNG', async ({ page }) => {
  await page.goto('/arch/diagram?d=m1')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const canvas = page.getByRole('group', { name: /架構圖$/ })
  await expect(canvas.getByRole('button', { name: '品質測量' })).toBeVisible()

  // 拖曳「模組二」往下
  const out = page.locator('[data-node="out"] rect').first()
  const before = (await out.boundingBox())!
  await page.mouse.move(before.x + 40, before.y + 40)
  await page.mouse.down()
  await page.mouse.move(before.x + 40, before.y + 140, { steps: 8 })
  await page.mouse.up()
  const after = (await out.boundingBox())!
  expect(after.y - before.y).toBeGreaterThan(50)

  // 新增元件，從「影像輸入」的把手拉線到新元件
  await page.getByRole('button', { name: '新增元件' }).click()
  await page.locator('[data-node="in"] rect').first().hover()
  const handle = (await page.getByTestId('handle-in-main').boundingBox())!
  const target = (await canvas.getByRole('button', { name: '新元件' }).boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByRole('heading', { name: '連線' })).toBeVisible()

  // 匯出 PNG
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '匯出 PNG' }).click()
  expect((await download).suggestedFilename()).toBe('影像前處理.png')

  // 回最上層，再點兩下逐層進入
  await page.getByRole('button', { name: '飲食紀錄 APP' }).click()
  await canvas.getByRole('button', { name: 'Python 外掛' }).dblclick()
  await expect(page.getByRole('navigation', { name: '層級' })).toContainText('服務內部元件')
})
