// dev.mjs 用到的純函式，抽出來才能寫單元測試（dev.mjs 本身一載入就會啟動服務）。

/**
 * 由設定值推導 Go 需要的資料庫與 MinIO 環境變數。
 * get(k) 回傳設定值（呼叫端決定環境變數與 .env 的優先順序），沒有時回傳 undefined。
 */
export function storageEnvFrom(get) {
  const env = {}
  const db = get('DATABASE_URL')
  if (db) env.DATABASE_URL = db
  else if (get('POSTGRES_USER') && get('POSTGRES_DB')) {
    // 帳號密碼可能含 @、: 等字元，要編碼後才能放進連線網址。
    // 主機與埠讀 libpq 的標準環境變數 PGHOST、PGPORT（另起的測試叢集常改埠），未設定時用本機預設 localhost:5432
    const user = encodeURIComponent(get('POSTGRES_USER'))
    const password = encodeURIComponent(get('POSTGRES_PASSWORD') ?? '')
    const host = get('PGHOST') || 'localhost'
    const port = get('PGPORT') || '5432'
    env.DATABASE_URL = `postgres://${user}:${password}@${host}:${port}/${get('POSTGRES_DB')}?sslmode=disable`
  }
  // 沒有專用的存取金鑰時，退回 MinIO 的 root 帳號（本機開發用）
  const minio = get('MINIO_ENDPOINT')
  if (minio || get('MINIO_ROOT_USER')) {
    env.MINIO_ENDPOINT = minio ?? 'localhost:9000'
    env.MINIO_ACCESS_KEY = get('MINIO_ACCESS_KEY') ?? get('MINIO_ROOT_USER') ?? ''
    env.MINIO_SECRET_KEY = get('MINIO_SECRET_KEY') ?? get('MINIO_ROOT_PASSWORD') ?? ''
  }
  return env
}

/**
 * 前端套件的安裝狀態：'missing-lock'（沒有 package-lock.json）、'up-to-date'、'stale'（需要 npm ci）。
 * npm 安裝完會寫入 node_modules/.package-lock.json；比 package-lock.json 舊代表套件有更新。
 * fs 傳入 { existsSync, statSync }，測試時可替換。
 */
export function lockfileState(lock, installed, fs) {
  if (!fs.existsSync(lock)) return 'missing-lock'
  if (fs.existsSync(installed) && fs.statSync(installed).mtimeMs >= fs.statSync(lock).mtimeMs) {
    return 'up-to-date'
  }
  return 'stale'
}
