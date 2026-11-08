// 架構圖文件的狀態：編輯操作、復原／重做、存在瀏覽器（localStorage）。
import { useCallback, useEffect, useReducer } from 'react'

import { type ArchDoc, applyOp, type Op, parseDoc } from '@/lib/arch/model'
import { sampleDoc } from '@/lib/arch/sample'

export const STORAGE_KEY = 'wb.arch'

/** 復原最多保留的步數。 */
const HISTORY_LIMIT = 100

interface History {
  past: ArchDoc[]
  present: ArchDoc
  future: ArchDoc[]
}

type Action =
  /** record 為 false 時不記入復原（拖曳中的連續移動，由拖曳開始時的 checkpoint 記一次） */
  | { type: 'apply'; op: Op; record: boolean }
  | { type: 'checkpoint' }
  | { type: 'replace'; doc: ArchDoc }
  | { type: 'undo' }
  | { type: 'redo' }

function push(past: ArchDoc[], doc: ArchDoc): ArchDoc[] {
  const next = [...past, doc]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}

export function historyReducer(h: History, a: Action): History {
  switch (a.type) {
    case 'apply': {
      const present = applyOp(h.present, a.op)
      if (present === h.present) return h
      return a.record ? { past: push(h.past, h.present), present, future: [] } : { ...h, present }
    }
    case 'checkpoint':
      return { past: push(h.past, h.present), present: h.present, future: [] }
    case 'replace':
      return { past: push(h.past, h.present), present: a.doc, future: [] }
    case 'undo': {
      // 拖曳開始記了 checkpoint 卻沒有真的移動時，過去那一筆與現在相同；一起跳過
      let past = h.past
      while (past.length && past[past.length - 1] === h.present) past = past.slice(0, -1)
      const prev = past.at(-1)
      if (!prev) return { ...h, past }
      return {
        past: past.slice(0, -1),
        present: prev,
        future: [h.present, ...h.future],
      }
    }
    case 'redo': {
      const [next, ...rest] = h.future
      if (!next) return h
      return { past: push(h.past, h.present), present: next, future: rest }
    }
  }
}

/** 讀取瀏覽器中保存的文件；沒有、讀不到或格式不對時用範例。 */
export function loadDoc(): ArchDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return parseDoc(JSON.parse(raw))
  } catch {
    // 私密視窗、被封鎖的儲存空間或舊格式：改用範例
  }
  return sampleDoc()
}

export function useArchDoc() {
  const [h, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: loadDoc(),
    future: [],
  }))

  // 每次變動都存回瀏覽器（拖曳時也存，文件很小）
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(h.present))
    } catch {
      // 存不進去時不影響編輯；使用者仍可匯出 JSON
    }
  }, [h.present])

  const apply = useCallback((op: Op, record = true) => dispatch({ type: 'apply', op, record }), [])
  const checkpoint = useCallback(() => dispatch({ type: 'checkpoint' }), [])
  const replace = useCallback((doc: ArchDoc) => dispatch({ type: 'replace', doc }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])

  return {
    doc: h.present,
    canUndo: h.past.some((d) => d !== h.present),
    canRedo: h.future.length > 0,
    apply,
    checkpoint,
    replace,
    undo,
    redo,
  }
}
