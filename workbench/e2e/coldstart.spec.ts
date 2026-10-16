// 冷啟動上傳的冒煙測試：需要資料庫（make up）與測試帳號，沒有時略過。
// 帳號以 cd api && go run ./cmd/wbuser add <帳號> <顯示名稱> 建立，
// 再設定 WORKBENCH_TEST_USER、WORKBENCH_TEST_PASSWORD 後執行 npm run test:e2e。
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const USER = process.env.WORKBENCH_TEST_USER
const PASSWORD = process.env.WORKBENCH_TEST_PASSWORD
const API = '/workbench/v1'

/** 以開發工具產生合成影像並下載成 PNG（上傳用的檔案 fixture） */
async function synthesize(
  request: APIRequestContext,
  scene: string,
  params: Record<string, unknown> = {},
) {
  const res = await request.post(`${API}/dev/images/synthesize`, { data: { scene, params } })
  expect(res.ok(), `合成影像失敗：${res.status()}`).toBeTruthy()
  const { image_id } = (await res.json()) as { image_id: string }
  const img = await request.get(`${API}/dev/artifacts/${encodeURIComponent(image_id)}`)
  expect(img.ok()).toBeTruthy()
  return {
    name: `${scene}.png`,
    mimeType: img.headers()['content-type'] ?? 'image/png',
    buffer: await img.body(),
  }
}

async function fill(page: Page, label: string, value: string) {
  await page.getByRole('textbox', { name: label, exact: true }).fill(value)
}

test('冷啟動：登入、新增、上傳三張照片、填欄位、確認', async ({ page, request }) => {
  test.skip(
    !USER || !PASSWORD,
    '沒有設定 WORKBENCH_TEST_USER、WORKBENCH_TEST_PASSWORD，略過冷啟動冒煙測試',
  )

  const login = await request.post(`${API}/auth/login`, {
    data: { username: USER, password: PASSWORD },
  })
  test.skip(
    login.status() === 503,
    '沒有設定資料庫（DB_UNAVAILABLE）：需先 make up 並設定 DATABASE_URL，略過冷啟動冒煙測試',
  )
  expect(login.ok(), `測試帳號無法登入：${login.status()}`).toBeTruthy()
  const list = await request.get(`${API}/coldstart/submissions`)
  test.skip(
    list.status() === 503,
    '沒有設定資料庫（DB_UNAVAILABLE）：需先 make up 並設定 DATABASE_URL，略過冷啟動冒煙測試',
  )

  const [front, barcode, label] = await Promise.all([
    synthesize(request, 'food'),
    synthesize(request, 'ean13'),
    synthesize(request, 'nutrition'),
  ])

  // 以介面登入（瀏覽器自己的 Cookie）
  await page.goto('/coldstart/submissions')
  await page.getByRole('textbox', { name: '帳號' }).fill(USER!)
  await page.getByLabel('密碼').fill(PASSWORD!)
  await page.getByRole('button', { name: '登入' }).click()
  await expect(
    page.getByRole('table', { name: '冷啟動上傳清單' }).or(page.getByText('沒有符合的上傳。')),
  ).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '新增上傳' }).click()
  await expect(page.getByRole('textbox', { name: '條碼', exact: true })).toBeVisible()

  await page.getByLabel('上傳包裝正面照片').setInputFiles(front)
  await page.getByLabel('上傳條碼照片').setInputFiles(barcode)
  await page.getByLabel('上傳營養標示照片').setInputFiles(label)
  // 條碼照片解出唯一條碼時後端會預先填入
  await expect(page.getByRole('textbox', { name: '條碼', exact: true })).toHaveValue(
    '4710088410108',
    { timeout: 30_000 },
  )
  await expect(page.getByRole('region', { name: '營養標示照片' }).getByRole('img')).toBeVisible()

  await fill(page, '品名', `冒煙測試綠茶 ${Date.now()}`)
  await fill(page, '品牌', '測試')
  await fill(page, '淨重或容量', '600')
  await page.getByRole('combobox', { name: '單位' }).selectOption('ml')
  await fill(page, '每份份量', '300')
  await fill(page, '每包裝份數', '2')
  const per100: Record<string, string> = {
    熱量: '20',
    蛋白質: '1',
    脂肪: '0.5',
    飽和脂肪: '0.1',
    反式脂肪: '0',
    碳水化合物: '3',
    糖: '2',
    鈉: '10',
  }
  const perServing: Record<string, string> = {
    熱量: '60',
    蛋白質: '3',
    脂肪: '1.5',
    飽和脂肪: '0.3',
    反式脂肪: '0',
    碳水化合物: '9',
    糖: '6',
    鈉: '30',
  }
  for (const [k, v] of Object.entries(per100)) await fill(page, `每 100 毫升・${k}`, v)
  for (const [k, v] of Object.entries(perServing)) await fill(page, `每份・${k}`, v)
  await expect(page.getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({
    timeout: 10_000,
  })

  await page.getByRole('button', { name: '確認並建立產品' }).click()
  // 同一條碼可能已由先前的執行建立：改為補照片到既有產品
  const done = page.getByRole('region', { name: /已建立產品|已把照片補到既有產品/ })
  const exists = page.getByRole('button', { name: '補照片到既有產品' })
  const inconsistent = page.getByRole('checkbox', { name: /我已核對標示確實如此/ })
  await expect(done.or(exists).or(inconsistent)).toBeVisible({ timeout: 15_000 })
  if (await inconsistent.isVisible()) {
    await inconsistent.check()
    await page.getByRole('button', { name: '照原樣存入' }).click()
    await expect(done.or(exists)).toBeVisible({ timeout: 15_000 })
  }
  if (await exists.isVisible()) await exists.click()
  await expect(done).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('已確認').first()).toBeVisible()
})
