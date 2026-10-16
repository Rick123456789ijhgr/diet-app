// 一次啟動開發工作台需要的三個程序：Python gRPC（開發模式）、Go 主伺服器、Vite。
// 用法：雙擊根目錄的「啟動全部服務.bat」、make workbench-react，或在 workbench/ 下 npm run dev:all。
// 按 Ctrl+C 全部停止。
//
// 啟動前先檢查套件：沒有 ai/.venv 或缺少套件時自動安裝；前端套件比 package-lock.json 舊時 npm ci。
// 三個服務都就緒（經 Vite → Go → Python 取得設定結構成功）後才開啟瀏覽器。
//
// 環境變數（皆可省略）：AI_GRPC_PORT（預設 50051）、API_PORT（8080）、WEB_PORT（5173）、
// WORKBENCH_NO_OPEN=1（不自動開瀏覽器）、WORKBENCH_SKIP_SETUP=1（不檢查套件）。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const isWin = process.platform === 'win32'
const aiPort = process.env.AI_GRPC_PORT ?? '50051'
const apiPort = process.env.API_PORT ?? '8080'
const webPort = process.env.WEB_PORT ?? '5173'

const venvPython = path.join(root, 'ai', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python')
const vite = path.join(root, 'workbench', 'node_modules', 'vite', 'bin', 'vite.js')
const webUrl = `http://localhost:${webPort}`
// 經 Vite 代理 → Go → Python 的輕量請求；成功代表三個服務都就緒
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
      ['-m', 'pip', 'install', '-e', '.[dev,vision,workbench,grpc]'],
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

if (!process.env.WORKBENCH_SKIP_SETUP) {
  ensurePython()
  ensureNode()
}
const python = existsSync(venvPython) ? venvPython : 'python'

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
    env: { WORKBENCH_DEV_TOOLS: '1', AI_GRPC_ADDR: `127.0.0.1:${aiPort}`, PORT: apiPort },
  },
  {
    name: 'web',
    color: 36, // 青
    cmd: process.execPath,
    args: [vite, '--port', webPort, '--strictPort'],
    cwd: path.join(root, 'workbench'),
    env: { WORKBENCH_API: `http://localhost:${apiPort}` },
  },
]

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

log(`啟動中：Python :${aiPort} → Go :${apiPort} → Vite :${webPort}（Ctrl+C 全部停止）`)
void waitUntilReady()

async function waitUntilReady() {
  const started = Date.now()
  while (!stopping && Date.now() - started < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(readyUrl, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const secs = ((Date.now() - started) / 1000).toFixed(1)
        log(`\x1b[32m就緒\x1b[0m（${secs} 秒）：${webUrl}`)
        if (!process.env.WORKBENCH_NO_OPEN) openBrowser(webUrl)
        return
      }
    } catch {
      // 還沒啟動完成，稍後再試
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
