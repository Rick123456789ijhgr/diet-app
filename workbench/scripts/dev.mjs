// 一次啟動開發工作台需要的三個程序：Python gRPC（開發模式）、Go 主伺服器、Vite。
// 用法：make workbench-react（或在 workbench/ 下 npm run dev:all）。按 Ctrl+C 全部停止。
//
// 環境變數（皆可省略）：AI_GRPC_PORT（預設 50051）、API_PORT（8080）、WEB_PORT（5173）、
// WORKBENCH_NO_OPEN=1（不自動開瀏覽器）。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const isWin = process.platform === 'win32'
const aiPort = process.env.AI_GRPC_PORT ?? '50051'
const apiPort = process.env.API_PORT ?? '8080'
const webPort = process.env.WEB_PORT ?? '5173'

const venvPython = path.join(root, 'ai', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python')
const python = existsSync(venvPython) ? venvPython : 'python'
const vite = path.join(root, 'workbench', 'node_modules', 'vite', 'bin', 'vite.js')

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
    args: [
      vite,
      '--port',
      webPort,
      '--strictPort',
      ...(process.env.WORKBENCH_NO_OPEN ? [] : ['--open']),
    ],
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

console.log(
  `\n開發工作台：http://localhost:${webPort}（Go :${apiPort} → Python :${aiPort}；Ctrl+C 停止）\n`,
)

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
