// 啟動開發工作台。按 Ctrl+C 全部停止。
//
// - 一般模式（make workbench、雙擊「啟動工作台.bat」）：建置前端，再啟動 Python gRPC（開發模式）
//   與 Go 主伺服器；Go 以 embed 提供建置後的前端，網址 http://localhost:8080。
// - --dev（make workbench-dev，改前端時用）：另外啟動 Vite（熱更新），網址 http://localhost:5173。
//
// 啟動前先檢查套件：沒有 ai/.venv 或缺少套件時自動安裝；前端套件比 package-lock.json 舊時 npm ci。
// 服務都就緒（經網頁的網址 → Go → Python 取得設定結構成功）後才開啟瀏覽器。
//
// 環境變數（皆可省略）：AI_GRPC_PORT（預設 50051）、API_PORT（8080）、WEB_PORT（5173，只用於 --dev）、
// WORKBENCH_NO_OPEN=1（不自動開瀏覽器）、WORKBENCH_SKIP_SETUP=1（不檢查套件）。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const isWin = process.platform === 'win32'
const aiPort = process.env.AI_GRPC_PORT ?? '50051'
const apiPort = process.env.API_PORT ?? '8080'
const webPort = process.env.WEB_PORT ?? '5173'

const venvPython = path.join(root, 'ai', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python')
const vite = path.join(root, 'workbench', 'node_modules', 'vite', 'bin', 'vite.js')
const devMode = process.argv.includes('--dev')

// 冷啟動上傳需要的資料庫與 MinIO 設定：已設定環境變數時沿用；否則由根目錄 .env（make db-up 用的那份）
// 推導本機位址。兩者都沒有時，Go 照常啟動，冷啟動頁會提示「未連線資料庫」。
function storageEnv() {
  const file = path.join(root, '.env')
  const dotenv = {}
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) dotenv[m[1]] = m[2]
    }
  }
  const get = (k) => process.env[k] ?? dotenv[k]
  const env = {}
  const db = get('DATABASE_URL')
  if (db) env.DATABASE_URL = db
  else if (get('POSTGRES_USER') && get('POSTGRES_DB')) {
    const user = encodeURIComponent(get('POSTGRES_USER'))
    const password = encodeURIComponent(get('POSTGRES_PASSWORD') ?? '')
    env.DATABASE_URL = `postgres://${user}:${password}@localhost:5432/${get('POSTGRES_DB')}?sslmode=disable`
  }
  const minio = get('MINIO_ENDPOINT')
  if (minio || get('MINIO_ROOT_USER')) {
    env.MINIO_ENDPOINT = minio ?? 'localhost:9000'
    env.MINIO_ACCESS_KEY = get('MINIO_ACCESS_KEY') ?? get('MINIO_ROOT_USER') ?? ''
    env.MINIO_SECRET_KEY = get('MINIO_SECRET_KEY') ?? get('MINIO_ROOT_PASSWORD') ?? ''
  }
  return env
}
const webUrl = `http://localhost:${devMode ? webPort : apiPort}`
// 經網頁的網址 → Go → Python 的輕量請求；成功代表服務都就緒
const readyUrl = `${webUrl}/workbench/v1/dev/config-schemas`
const READY_TIMEOUT_MS = 180_000 // 第一次 go run 需要編譯，給足時間

function log(msg) {
  console.log(`\x1b[1m[wb ]\x1b[0m ${msg}`)
}

function fail(msg) {
  console.error(`\x1b[31m[wb ] ${msg}\x1b[0m`)
  process.exit(1)
}

// 同步執行並直接顯示輸出；失敗時結束整個腳本
function runOrFail(cmd, args, cwd, what) {
  // Windows 的 npm 是 npm.cmd，要經過 shell 才能執行
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin && cmd === 'npm' })
  if (r.status !== 0) fail(`${what}失敗，請把上方訊息提供給組員或 AI 工具`)
}

function ensurePython() {
  const aiDir = path.join(root, 'ai')
  if (!existsSync(venvPython)) {
    log('首次執行：建立 ai/.venv')
    runOrFail(isWin ? 'python' : 'python3', ['-m', 'venv', '.venv'], aiDir, '建立虛擬環境')
  }
  const probe = spawnSync(venvPython, ['-c', 'import grpc, cv2, dietai.server'], {
    stdio: 'ignore',
  })
  if (probe.status !== 0) {
    log('安裝 Python 套件，約需數分鐘')
    runOrFail(
      venvPython,
      ['-m', 'pip', 'install', '-e', '.[dev,vision,grpc]'],
      aiDir,
      '安裝 Python 套件',
    )
  }
}

function ensureNode() {
  const lock = path.join(root, 'workbench', 'package-lock.json')
  const installed = path.join(root, 'workbench', 'node_modules', '.package-lock.json')
  // npm 安裝完會寫入 node_modules/.package-lock.json；比 package-lock.json 舊代表套件有更新
  if (existsSync(installed) && statSync(installed).mtimeMs >= statSync(lock).mtimeMs) return
  log('安裝前端套件')
  runOrFail('npm', ['ci', '--no-audit', '--no-fund'], path.join(root, 'workbench'), '安裝前端套件')
}

async function isOk(url, timeoutMs) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok
  } catch {
    return false
  }
}

// API 與前端首頁都正常才算就緒：只看 API 會把沒有內嵌前端的舊版 Go（首頁 404）當成就緒
async function isReady(timeoutMs) {
  return (await isOk(readyUrl, timeoutMs)) && (await isOk(`${webUrl}/`, timeoutMs))
}

// 已在執行（例如重複雙擊）時不重複啟動：埠已被佔用，新啟動的程序只會失敗
if (await isReady(1000)) {
  log(`工作台已在執行：${webUrl}`)
  if (!process.env.WORKBENCH_NO_OPEN) openBrowser(webUrl)
  process.exit(0)
}
if (await isOk(readyUrl, 1000)) {
  fail(
    `${webUrl} 上已有舊版工作台在執行，但首頁無法開啟（可能是之前的 make workbench-dev 或舊視窗）。` +
      '請先關閉那個視窗或程序，再重新啟動。',
  )
}

if (!process.env.WORKBENCH_SKIP_SETUP) {
  ensurePython()
  ensureNode()
}
const python = existsSync(venvPython) ? venvPython : 'python'

if (!devMode) {
  // 輸出到 api/internal/webui/static/app/，go run 編譯時以 embed 打包（見 vite.config.ts）
  log('建置前端')
  runOrFail(
    process.execPath,
    [vite, 'build', '--logLevel', 'warn'],
    path.join(root, 'workbench'),
    '建置前端',
  )
}

const procs = [
  {
    name: 'ai ',
    color: 35, // 紫
    cmd: python,
    args: ['-m', 'dietai.server'],
    cwd: path.join(root, 'ai'),
    env: {
      WORKBENCH_DEV_TOOLS: '1',
      AI_GRPC_LISTEN: `127.0.0.1:${aiPort}`,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  },
  {
    name: 'api',
    color: 34, // 藍
    cmd: 'go',
    args: ['run', './cmd/server'],
    cwd: path.join(root, 'api'),
    env: {
      WORKBENCH_DEV_TOOLS: '1',
      AI_GRPC_ADDR: `127.0.0.1:${aiPort}`,
      PORT: apiPort,
      ...storageEnv(),
    },
  },
  {
    name: 'web',
    color: 36, // 青
    cmd: process.execPath,
    args: [vite, '--port', webPort, '--strictPort'],
    cwd: path.join(root, 'workbench'),
    env: { WORKBENCH_API: `http://localhost:${apiPort}` },
  },
].filter((p) => devMode || p.name !== 'web')

const children = []
let stopping = false

function prefix(name, color, chunk) {
  const tag = `\x1b[${color}m[${name}]\x1b[0m `
  return chunk
    .toString()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => tag + line)
    .join('\n')
}

for (const p of procs) {
  const child = spawn(p.cmd, p.args, {
    cwd: p.cwd,
    env: { ...process.env, ...p.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => console.log(prefix(p.name, p.color, d)))
  child.stderr.on('data', (d) => console.error(prefix(p.name, p.color, d)))
  child.on('error', (err) => {
    console.error(prefix(p.name, 31, `無法啟動 ${p.cmd}：${err.message}`))
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(prefix(p.name, 31, `已結束（代碼 ${code}），停止其他程序`))
      stop(code ?? 1)
    }
  })
  children.push(child)
}

log(
  devMode
    ? `啟動中：Python :${aiPort} → Go :${apiPort} → Vite :${webPort}（Ctrl+C 全部停止）`
    : `啟動中：Python :${aiPort} → Go :${apiPort}（Ctrl+C 全部停止）`,
)
void waitUntilReady()

async function waitUntilReady() {
  const started = Date.now()
  while (!stopping && Date.now() - started < READY_TIMEOUT_MS) {
    if (await isReady(3000)) {
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      log(`\x1b[32m就緒\x1b[0m（${secs} 秒）：${webUrl}`)
      if (!process.env.WORKBENCH_NO_OPEN) openBrowser(webUrl)
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!stopping) {
    log(`等候逾時，服務可能還沒就緒；請看上方訊息，或直接開啟 ${webUrl}`)
    if (!process.env.WORKBENCH_NO_OPEN) openBrowser(webUrl)
  }
}

function openBrowser(url) {
  const [cmd, args] = isWin
    ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
}

function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue
    // go run 會再啟動編譯後的執行檔；Windows 要連子程序一起結束
    if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
