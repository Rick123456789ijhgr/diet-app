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
// PGHOST／PGPORT（由 POSTGRES_* 推導 DATABASE_URL 時的主機與埠，預設 localhost:5432）、WORKBENCH_NO_OPEN=1（不自動開瀏覽器）、WORKBENCH_SKIP_SETUP=1（不檢查套件）。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { lockfileState, storageEnvFrom } from './devEnv.mjs'

// 專案根目錄（本檔在 workbench/scripts/ 下，往上兩層）；不依賴從哪個目錄執行
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const isWin = process.platform === 'win32'
const aiPort = process.env.AI_GRPC_PORT ?? '50051'
const apiPort = process.env.API_PORT ?? '8080'
const webPort = process.env.WEB_PORT ?? '5173'

const venvPython = path.join(root, 'ai', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python')
// 直接以 node 執行 Vite 的 JS 進入點，不經 npx／.cmd 包裝，Windows 上不必透過 shell
const vite = path.join(root, 'workbench', 'node_modules', 'vite', 'bin', 'vite.js')
const devMode = process.argv.includes('--dev')

// 冷啟動上傳需要的資料庫與 MinIO 設定：已設定環境變數時沿用；否則由根目錄 .env（make db-up 用的那份）
// 推導本機位址。兩者都沒有時，Go 照常啟動，冷啟動頁會提示「未連線資料庫」。
function storageEnv() {
  const file = path.join(root, '.env')
  const dotenv = {}
  if (existsSync(file)) {
    // 簡易解析 KEY=VALUE：值不去引號、不處理跳脫與行尾註解；註解行（#）與 export 開頭的行對不上規則式，會被略過
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) dotenv[m[1]] = m[2]
    }
  }
  // 環境變數優先於 .env
  return storageEnvFrom((k) => process.env[k] ?? dotenv[k])
}
// 使用者要開的網址：--dev 時是 Vite（由它代理到 Go），否則直接是 Go
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

// 確保 ai/.venv 存在且能 import 伺服器需要的套件；探測失敗才執行耗時的 pip install
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
  const state = lockfileState(lock, installed, { existsSync, statSync })
  // npm ci 需要 package-lock.json；缺檔時給中文訊息，不讓 statSync 丟例外崩潰
  if (state === 'missing-lock') {
    fail('找不到 workbench/package-lock.json，請確認檔案完整（git checkout 或重新 clone）')
  }
  if (state === 'up-to-date') return
  log('安裝前端套件')
  runOrFail('npm', ['ci', '--no-audit', '--no-fund'], path.join(root, 'workbench'), '安裝前端套件')
}

// 單次健康檢查：連不上、逾時或非 2xx 都回傳 false，不丟例外
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

// 啟動順序：檢查套件 → （一般模式）建置前端 → 同時啟動 Python、Go（、Vite）→ 輪詢健康檢查直到就緒
if (!process.env.WORKBENCH_SKIP_SETUP) {
  ensurePython()
  ensureNode()
}
// 跳過檢查且沒有 venv 時，退回系統 PATH 上的 python
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

// 三個服務同時啟動，不互相等待：Go 啟動時 Python 可能還沒好，由下方的健康檢查等全部就緒。
// name 補成三個字元，讓各服務的輸出前綴對齊。
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
      // 輸出不緩衝才能即時看到日誌；強制 UTF-8，Windows 主控台輸出中文時才不會因編碼出錯
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
    // --strictPort：埠被佔用時直接失敗，而不是悄悄換埠，否則 webUrl 與健康檢查會對不上
    args: [vite, '--port', webPort, '--strictPort'],
    cwd: path.join(root, 'workbench'),
    env: { WORKBENCH_API: `http://localhost:${apiPort}` },
  },
].filter((p) => devMode || p.name !== 'web')

const children = []
let stopping = false

// 每行加上彩色的服務名稱前綴；chunk 是任意切開的輸出片段，一行被切成兩塊時前綴會出現在行中間（僅影響顯示）
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
  // 任一服務意外結束就全部停止，避免留下半套服務（例如 Go 在跑但 Python 已掛）
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

// 每 500 ms 輪詢一次（每次最多等 3 秒），直到就緒、逾時或已在停止中；逾時仍開瀏覽器，讓使用者自己看狀態
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

// 用各平台的預設程式開啟網址；Windows 的 start 第一個引號參數是視窗標題，所以先放空字串
// detached＋unref：不讓瀏覽器程序綁住本腳本的結束
function openBrowser(url) {
  const [cmd, args] = isWin
    ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
}

// 停止所有子程序後結束；stopping 旗標讓重複呼叫（Ctrl+C 與子程序 exit 事件同時發生）只執行一次
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue
    // go run 會再啟動編譯後的執行檔；Windows 要連子程序一起結束
    if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  // 稍等一下讓子程序的最後輸出印完再結束
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
