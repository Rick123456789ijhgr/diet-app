// 專案架構圖的冒煙測試：純前端，不需要 Python。
// 檢視頁按「編輯」開新分頁 → 拖曳（吸附對齊）、拉線、匯出 PNG → 檢視頁即時更新。
import { expect, test } from '@playwright/test'

test('架構圖：檢視頁開新分頁編輯，拖曳吸附、拉線、匯出，檢視頁即時更新', async ({
  page,
  context,
}) => {
  await page.goto('/tools/arch?d=m1')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const view = page.getByRole('group', { name: /架構圖$/ })
  await expect(view.getByRole('button', { name: '品質測量' })).toBeVisible()

  // 「編輯」開新分頁，停在同一層
  const [editor] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: '編輯' }).click(),
  ])
  await expect(editor).toHaveURL(/\/arch\/edit\?d=m1$/)
  const canvas = editor.getByRole('group', { name: /編輯畫布$/ })
  await expect(canvas.getByRole('button', { name: '品質測量' })).toBeVisible()

  // 把「模組二」拖到「優化策略」正下方附近：左緣自動對齊
  const out = editor.locator('[data-node="out"] > path').first()
  const strategy = editor.locator('[data-node="strategy"] > path').first()
  const o = (await out.boundingBox())!
  const s = (await strategy.boundingBox())!
  await editor.mouse.move(o.x + 30, o.y + 30)
  await editor.mouse.down()
  await editor.mouse.move(s.x + 30 + 3, o.y + 200, { steps: 12 })
  await editor.mouse.up()
  expect(Math.abs((await out.boundingBox())!.x - s.x)).toBeLessThan(1)

  // 工具列新增矩形，從「影像輸入」右側的定位點拉線到新元件（自動選邊）
  await editor.getByRole('button', { name: '新增矩形' }).click()
  await editor.locator('[data-node="in"] > path').first().hover()
  const anchor = (await editor.getByTestId('anchor-in-main-right').boundingBox())!
  const target = (await canvas.getByRole('button', { name: '新元件' }).boundingBox())!
  await editor.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2)
  await editor.mouse.down()
  await editor.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
    steps: 10,
  })
  await editor.mouse.up()
  await expect(editor.getByText('影像輸入（右側）')).toBeVisible()

  // 改連線樣式為虛線
  await editor.getByRole('radio', { name: '虛線' }).click()

  // 線條工具：從「測試輸入」上緣的定位點畫到空白處（自由端點）
  await editor.keyboard.press('l')
  const test1 = (await editor.locator('[data-node="test"] > path').first().boundingBox())!
  await editor.mouse.move(test1.x + test1.width / 2, test1.y + 1)
  await editor.mouse.down()
  await editor.mouse.move(test1.x + test1.width / 2, test1.y + test1.height + 120, { steps: 8 })
  await editor.mouse.up()
  await expect(editor.getByText(/^自由端點/)).toBeVisible()
  await editor.keyboard.press('v')

  // 匯出 PNG
  const download = editor.waitForEvent('download')
  await editor.getByRole('button', { name: /匯出/ }).click()
  await editor.getByRole('menuitem', { name: /PNG/ }).click()
  expect((await download).suggestedFilename()).toBe('影像前處理.png')

  // 檢視頁（另一個分頁）即時出現新元件
  await expect(view.getByRole('button', { name: '新元件' })).toBeVisible()
})
