// 資料夾瀏覽彈窗的路徑工具：網址列的麵包屑分段、最近使用的資料夾（存在瀏覽器）。
// 路徑由後端（執行工作台的電腦）解析，這裡只負責切段顯示，不判斷路徑是否存在。

export interface PathSegment {
  /** 顯示的名稱（磁碟機顯示成「D:」） */
  name: string
  /** 點這一段要前往的完整路徑；起點（本機）為空字串 */
  path: string
}

/**
 * 把絕對路徑切成麵包屑：第一段固定是「本機」（起點），之後依序為磁碟機（或 /）與各層資料夾。
 * Windows 路徑以 \ 分隔（D:\photos\food）、POSIX 以 / 分隔（/home/a）；結尾的分隔符號略過。
 */
export function pathSegments(path: string): PathSegment[] {
  const out: PathSegment[] = [{ name: '本機', path: '' }]
  if (!path) return out
  const drive = /^[A-Za-z]:[\\/]?/.exec(path)
  if (drive) {
    const sep = path.includes('\\') || !path.includes('/') ? '\\' : '/'
    const root = `${path.slice(0, 2)}${sep}`
    out.push({ name: path.slice(0, 2).toUpperCase(), path: root })
    let cur = root
    for (const part of path.slice(drive[0].length).split(/[\\/]/).filter(Boolean)) {
      cur = cur.endsWith(sep) ? `${cur}${part}` : `${cur}${sep}${part}`
      out.push({ name: part, path: cur })
    }
    return out
  }
  if (path.startsWith('/')) {
    out.push({ name: '/', path: '/' })
    let cur = ''
    for (const part of path.split('/').filter(Boolean)) {
      cur = `${cur}/${part}`
      out.push({ name: part, path: cur })
    }
    return out
  }
  // 相對路徑等其他格式：整段當一層（由後端解析）
  out.push({ name: path, path })
  return out
}

/** 路徑的最後一段（資料夾名稱）；磁碟機根目錄回傳「D:」。 */
export function folderName(path: string): string {
  const segs = pathSegments(path)
  return segs.length > 1 ? segs[segs.length - 1]!.name : ''
}

const RECENT_KEY = 'wb.folderPicker.recent'
export const MAX_RECENT = 6

/** 最近選過的資料夾（新的在前）；讀不到時回傳空陣列。 */
export function loadRecent(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 記下選過的資料夾：移到最前面、不重複、最多 MAX_RECENT 個。回傳新的清單。 */
export function rememberRecent(path: string): string[] {
  const next = [path, ...loadRecent().filter((p) => p !== path)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // 無法寫入時只是不記得，不影響選擇
  }
  return next
}
