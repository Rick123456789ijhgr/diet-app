// 冷啟動上傳的頁面：登入、清單、編輯與確認（後端為 src/test/coldstart.ts 的記憶體假實作）。
import { File as NodeFile } from 'node:buffer'

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Draft, SubmissionImage } from '@/api/client'
import {
  addProduct,
  addSubmission,
  coldstart,
  coldstartRequests,
  DECODED_BARCODE,
  resetColdstart,
  TEST_PASSWORD,
} from '@/test/coldstart'
import { renderAt } from '@/test/render'

const WAIT = { timeout: 3000 }

beforeEach(() => {
  resetColdstart()
})

const writes = (suffix: string) =>
  coldstartRequests.filter((r) => r.method !== 'GET' && r.path.endsWith(suffix))

/**
 * 測試用的上傳檔：用 Node 的 File。jsdom 的 File 放進 FormData 後，請求本文會一直讀不完；
 * Node 的 File 則會被轉成字串，假後端只檢查有沒有 file 欄位。
 */
const pngFile = (name: string) =>
  new NodeFile(['x'], name, { type: 'image/png' }) as unknown as File

const labelImage: SubmissionImage = {
  kind: 'label',
  width: 800,
  height: 600,
  content_type: 'image/png',
  uploaded_at: '2026-10-16T01:00:00Z',
  preprocess: { quality_passed: true, warnings: [] },
}

/** 完整的草稿（每 100 毫升八項都有） */
const fullDraft = (patch: Draft = {}): Draft => ({
  barcode: DECODED_BARCODE,
  name: '無糖綠茶',
  content_unit: 'ml',
  net_content: 600,
  nutrition: {
    per_100: {
      energy_kcal: 0,
      protein_g: 0,
      fat_g: 0,
      saturated_fat_g: 0,
      trans_fat_g: 0,
      carbohydrate_g: 0.1,
      sugar_g: 0,
      sodium_mg: 8,
    },
  },
  ...patch,
})

/** 編輯頁的儲存狀態（頂部列的服務狀態也是 status，只在「人工確認」區塊內找）。 */
function saveStatus() {
  return within(screen.getByRole('region', { name: '人工確認' })).getByRole('status')
}

describe('登入', () => {
  it('未登入時顯示登入表單，登入後留在原頁面並顯示清單與登入者，可登出', async () => {
    const user = userEvent.setup()
    addSubmission({ draft: { name: '既有草稿' } })
    renderAt('/coldstart/submissions')
    expect(await screen.findByRole('heading', { name: '登入' }, WAIT)).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '帳號' }), 'rick')
    await user.type(screen.getByLabelText('密碼'), 'wrong')
    await user.click(screen.getByRole('button', { name: '登入' }))
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('帳號或密碼錯誤')

    await user.clear(screen.getByLabelText('密碼'))
    await user.type(screen.getByLabelText('密碼'), TEST_PASSWORD)
    await user.click(screen.getByRole('button', { name: '登入' }))
    const table = await screen.findByRole('table', { name: '冷啟動上傳清單' }, WAIT)
    expect(within(table).getByText('既有草稿')).toBeInTheDocument()
    const banner = screen.getByRole('banner')
    expect(within(banner).getByText('測試員')).toBeInTheDocument()

    await user.click(within(banner).getByRole('button', { name: '登出' }))
    expect(await screen.findByRole('heading', { name: '登入' }, WAIT)).toBeInTheDocument()
    expect(within(banner).queryByText('測試員')).not.toBeInTheDocument()
  })

  it('開發工具頁不需要登入，也不顯示登入者', async () => {
    renderAt('/m2')
    expect(await screen.findByText('條碼、發票、營養標示尚無工具。', {}, WAIT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '登出' })).not.toBeInTheDocument()
  })

  it('沒有設定資料庫時說明如何啟動', async () => {
    coldstart.dbDown = true
    renderAt('/coldstart/submissions')
    const alert = await screen.findByRole('alert', {}, WAIT)
    expect(alert).toHaveTextContent('資料庫或物件儲存未設定或無法連線')
    expect(alert).toHaveTextContent('make up')
  })
})

describe('上傳清單', () => {
  beforeEach(() => resetColdstart({ loggedIn: true }))

  it('依狀態篩選', async () => {
    const user = userEvent.setup()
    addSubmission({ draft: { name: '草稿甲' } })
    addSubmission({ status: 'rejected', draft: { name: '退回乙' }, reject_reason: '重複' })
    renderAt('/coldstart/submissions')
    const table = await screen.findByRole('table', { name: '冷啟動上傳清單' }, WAIT)
    expect(within(table).getByText('草稿甲')).toBeInTheDocument()
    expect(within(table).getByText('退回乙')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '已退回' }))
    await waitFor(() => expect(within(table).queryByText('草稿甲')).not.toBeInTheDocument(), WAIT)
    expect(within(table).getByText('退回乙')).toBeInTheDocument()
  })

  it('以條碼查產品：顯示摘要或查無此產品', async () => {
    const user = userEvent.setup()
    addProduct()
    renderAt('/coldstart/submissions')
    const box = await screen.findByRole('textbox', { name: '查詢條碼' }, WAIT)
    await user.type(box, DECODED_BARCODE)
    await user.click(screen.getByRole('button', { name: '查詢' }))
    const summary = await screen.findByRole('region', { name: '產品摘要' }, WAIT)
    expect(summary).toHaveTextContent('既有的綠茶')
    expect(within(summary).getByRole('columnheader', { name: '每 100 毫升' })).toBeInTheDocument()

    await user.clear(box)
    await user.type(box, '12345678')
    await user.click(screen.getByRole('button', { name: '查詢' }))
    expect(await screen.findByText('查無此產品（12345678）。', {}, WAIT)).toBeInTheDocument()
  })

  it('新增上傳並上傳條碼照片後預填條碼；之後的輸入自動儲存並帶 If-Match', async () => {
    const user = userEvent.setup()
    renderAt('/coldstart/submissions')
    await user.click(await screen.findByRole('button', { name: '新增上傳' }, WAIT))
    // 跳到編輯頁，頂部仍標示在「上傳清單」
    const barcode = await screen.findByRole('textbox', { name: '條碼' }, WAIT)
    expect(barcode).toHaveValue('')
    expect(screen.getByRole('link', { name: /上傳清單/, current: 'page' })).toBeInTheDocument()

    await user.upload(screen.getByLabelText('上傳條碼照片'), pngFile('barcode.png'))
    await waitFor(() => expect(barcode).toHaveValue(DECODED_BARCODE), WAIT)
    const slot = screen.getByRole('region', { name: '條碼照片' })
    expect(slot).toHaveTextContent('品質通過')
    expect(slot).toHaveTextContent(`${DECODED_BARCODE}（EAN13）`)
    expect(saveStatus()).toHaveTextContent('已儲存')

    const version = [...coldstart.submissions.values()][0]!.updated_at
    await user.type(screen.getByRole('textbox', { name: '品名' }), '無糖綠茶')
    await user.type(screen.getByRole('textbox', { name: '每 100 公克或毫升・鈉' }), '8.0')
    expect(saveStatus()).toHaveTextContent('有未儲存的變更')
    await waitFor(() => expect(saveStatus()).toHaveTextContent('已儲存'), WAIT)

    const saves = writes('/draft')
    expect(saves).toHaveLength(1)
    expect(saves[0]!.ifMatch).toBe(version)
    // 空白欄位不送（不送 0），數字照輸入轉換
    expect(saves[0]!.body).toEqual({
      barcode: DECODED_BARCODE,
      name: '無糖綠茶',
      nutrition: { per_100: { sodium_mg: 8 } },
    })
    // 輸入框保留原字串
    expect(screen.getByRole('textbox', { name: '每 100 公克或毫升・鈉' })).toHaveValue('8.0')
  })

  it('不是數字的欄位標紅且不儲存', async () => {
    const user = userEvent.setup()
    const sub = addSubmission()
    renderAt(`/coldstart/submissions/${sub.id}`)
    const input = await screen.findByRole('textbox', { name: '每份・糖' }, WAIT)
    await user.type(input, '1,5')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(saveStatus()).toHaveTextContent('不是合法的數字')
    await new Promise((r) => setTimeout(r, 1000))
    expect(writes('/draft')).toHaveLength(0)
  })
})

describe('確認', () => {
  beforeEach(() => resetColdstart({ loggedIn: true }))

  it('條碼已存在（409）：顯示既有產品，選擇補照片到既有產品', async () => {
    const user = userEvent.setup()
    const existing = addProduct()
    const sub = addSubmission({ draft: fullDraft(), images: [labelImage] })
    renderAt(`/coldstart/submissions/${sub.id}`)
    await user.click(await screen.findByRole('button', { name: '確認並建立產品' }, WAIT))

    const alert = await screen.findByRole('alert', {}, WAIT)
    expect(alert).toHaveTextContent('此條碼的產品已存在')
    expect(within(alert).getByRole('region', { name: '既有產品' })).toHaveTextContent('既有的綠茶')
    await user.click(within(alert).getByRole('button', { name: '補照片到既有產品' }))

    expect(
      await screen.findByRole('region', { name: '已把照片補到既有產品' }, WAIT),
    ).toBeInTheDocument()
    const confirms = writes('/confirm')
    expect(confirms.map((r) => r.body)).toEqual([
      { mode: 'create', accept_warnings: false },
      { mode: 'add_images', product_id: existing.id, accept_warnings: false },
    ])
    // 確認後改為唯讀
    expect(screen.getByRole('textbox', { name: '品名' })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: '確認並建立產品' })).not.toBeInTheDocument()
    expect(screen.getByText('已確認')).toBeInTheDocument()
  })

  it('欄位不完整（422）：列出並標紅缺少的欄位與照片', async () => {
    const user = userEvent.setup()
    const sub = addSubmission({ draft: { barcode: DECODED_BARCODE, content_unit: 'g' } })
    renderAt(`/coldstart/submissions/${sub.id}`)
    await user.click(await screen.findByRole('button', { name: '確認並建立產品' }, WAIT))

    const alert = await screen.findByRole('alert', {}, WAIT)
    expect(alert).toHaveTextContent('欄位尚未填完')
    expect(alert).toHaveTextContent('品名')
    expect(alert).toHaveTextContent('營養標示（每 100 公克）：鈉')
    expect(alert).toHaveTextContent('營養標示照片')
    const name = screen.getByRole('textbox', { name: '品名' })
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: '每 100 公克・鈉' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByRole('textbox', { name: '每份・鈉' })).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('region', { name: '營養標示照片' })).toHaveTextContent('缺少照片')
    // 填上後不再標紅
    await user.type(name, '餅乾')
    expect(name).not.toHaveAttribute('aria-invalid')
  })

  it('數值不一致（422）：勾選已核對後以 accept_warnings 再送一次成功', async () => {
    const user = userEvent.setup()
    const draft = fullDraft()
    draft.nutrition!.per_100!.sugar_g = 5
    const sub = addSubmission({ draft, images: [labelImage] })
    renderAt(`/coldstart/submissions/${sub.id}`)
    await user.click(await screen.findByRole('button', { name: '確認並建立產品' }, WAIT))

    const alert = await screen.findByRole('alert', {}, WAIT)
    expect(alert).toHaveTextContent('營養數值不一致')
    expect(alert).toHaveTextContent('糖大於碳水化合物')
    expect(alert).toHaveTextContent('每 100 毫升・糖')
    expect(alert).toHaveTextContent('預期 0.1，實際 5')
    const accept = within(alert).getByRole('button', { name: '照原樣存入' })
    expect(accept).toBeDisabled()
    await user.click(within(alert).getByRole('checkbox', { name: /我已核對標示確實如此/ }))
    await user.click(accept)

    expect(await screen.findByRole('region', { name: '已建立產品' }, WAIT)).toHaveTextContent(
      '無糖綠茶',
    )
    expect(writes('/confirm').map((r) => r.body)).toEqual([
      { mode: 'create', accept_warnings: false },
      { mode: 'create', accept_warnings: true },
    ])
  })

  it('確認前先儲存未儲存的輸入，兩次寫入都帶最新版本', async () => {
    const user = userEvent.setup()
    const sub = addSubmission({ draft: fullDraft({ name: '' }), images: [labelImage] })
    renderAt(`/coldstart/submissions/${sub.id}`)
    await user.type(await screen.findByRole('textbox', { name: '品名' }, WAIT), '麥茶')
    await user.click(screen.getByRole('button', { name: '確認並建立產品' }))
    expect(await screen.findByRole('region', { name: '已建立產品' }, WAIT)).toHaveTextContent(
      '麥茶',
    )
    const [save] = writes('/draft')
    const [confirm] = writes('/confirm')
    expect(save!.body).toMatchObject({ name: '麥茶' })
    // 假後端會檢查 If-Match：確認成功表示帶的是儲存後的新版本
    expect(confirm!.ifMatch).not.toBe(save!.ifMatch)
  })

  it('已被其他人修改（412）：停止自動儲存，重新載入後顯示最新內容', async () => {
    const user = userEvent.setup()
    const sub = addSubmission({ draft: { name: '原本' } })
    renderAt(`/coldstart/submissions/${sub.id}`)
    const name = await screen.findByRole('textbox', { name: '品名' }, WAIT)
    // 別人在這之間改了
    coldstart.submissions.set(sub.id, {
      ...sub,
      draft: { name: '別人改的' },
      updated_at: '2026-10-16T09:00:00Z',
    })
    await user.type(name, '甲')

    const alert = await screen.findByRole('alert', {}, WAIT)
    expect(alert).toHaveTextContent('這筆上傳已被其他人修改，請重新載入')
    expect(saveStatus()).toHaveTextContent('已停止儲存')
    expect(screen.getByRole('button', { name: '確認並建立產品' })).toBeDisabled()
    await user.type(name, '乙') // 唯讀，輸入無效
    await new Promise((r) => setTimeout(r, 1000))
    expect(writes('/draft')).toHaveLength(1)

    await user.click(within(alert).getByRole('button', { name: '重新載入' }))
    await waitFor(
      () => expect(screen.getByRole('textbox', { name: '品名' })).toHaveValue('別人改的'),
      WAIT,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('退回：填原因後改為唯讀並顯示原因', async () => {
    const user = userEvent.setup()
    const sub = addSubmission({ draft: { name: '模糊照片' } })
    renderAt(`/coldstart/submissions/${sub.id}`)
    await user.type(await screen.findByRole('textbox', { name: '退回原因' }, WAIT), '照片不是包裝')
    await user.click(screen.getByRole('button', { name: '退回' }))
    expect(await screen.findByText('原因：照片不是包裝', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '品名' })).toHaveAttribute('readonly')
    expect(writes('/reject')[0]!.ifMatch).toBeTruthy()
  })
})
