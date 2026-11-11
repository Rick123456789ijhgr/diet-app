// 找最佳流程：使用者選的圖片（含預覽網址與答案）與上傳快取。
import { useCallback, useEffect, useRef, useState } from 'react'

import { type ImageRef } from '@/api/client'
import { uploadImage } from '@/hooks/useImagePipeline'
import { answerFromName, type Answer } from '@/lib/barcodeTruth'

/** 一張選好的圖片。 */
export interface Item {
  /** 這次開啟工作台期間唯一的鍵（同名檔案也不同；離開頁面再回來也不重複，見 nextKey） */
  key: string
  file: File
  /** 本機預覽網址（object URL）；環境不支援時為空字串 */
  url: string
  /** 由檔名推回的答案（檔名就是條碼時），下一步預先帶入，仍要人確認 */
  nameAnswer: Answer | null
  /** 人工確認的答案；null 為還沒確認（送出時交給程式推定） */
  answer: Answer | null
}

const objectUrl = (f: File) =>
  typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : ''
const revoke = (url: string) => {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

// 流水號放在模組層級而不是元件裡：鍵同時是「讀條碼建議」的查詢鍵，離開頁面後查詢快取還會留一陣子，
// 若每次掛載都從 f1 重新編號，新選的圖片會拿到上一批圖片的號碼。
let seq = 0
const nextKey = () => `f${++seq}`

/** 圖片清單：新增、移除、清空、設定答案；移除與卸載時釋放預覽網址。 */
export function useItems() {
  const [items, setItems] = useState<Item[]>([])
  // 卸載時釋放所有預覽網址；用 ref 取得最新清單，避免 effect 依賴 items 而每次更新都執行
  const latest = useRef(items)
  useEffect(() => {
    latest.current = items
  }, [items])
  useEffect(() => () => latest.current.forEach((i) => revoke(i.url)), [])

  const add = useCallback((files: File[]) => {
    const added = files.map((file) => ({
      key: nextKey(),
      file,
      url: objectUrl(file),
      nameAnswer: answerFromName(file.name),
      answer: null,
    }))
    setItems((prev) => [...prev, ...added])
  }, [])
  const remove = useCallback((key: string) => {
    setItems((prev) => {
      prev.filter((i) => i.key === key).forEach((i) => revoke(i.url))
      return prev.filter((i) => i.key !== key)
    })
  }, [])
  const clear = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => revoke(i.url))
      return []
    })
  }, [])
  const answer = useCallback((answers: Record<string, Answer | null>) => {
    setItems((prev) => prev.map((i) => (i.key in answers ? { ...i, answer: answers[i.key]! } : i)))
  }, [])
  return { items, add, remove, clear, answer }
}

/** 上傳快取：同一張圖只上傳一次（確認真值時讀條碼用，開始比較時沿用同一個 image_id）。 */
export function useUploads() {
  const cache = useRef(new Map<string, Promise<ImageRef>>())
  return useCallback((item: Item): Promise<ImageRef> => {
    const hit = cache.current.get(item.key)
    if (hit) return hit
    const ref = uploadImage(item.file)
    cache.current.set(item.key, ref)
    // 失敗的上傳不留在快取，下次重試
    ref.catch(() => {
      if (cache.current.get(item.key) === ref) cache.current.delete(item.key)
    })
    return ref
  }, [])
}
