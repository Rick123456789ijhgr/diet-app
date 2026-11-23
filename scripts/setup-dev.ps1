# 一鍵安裝開發環境（Windows）。雙擊根目錄的「安裝開發環境.bat」即執行本檔。
#
# 用法（在專案根目錄）：
#   powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1 [-SkipPaddle] [-SkipOcr] [-WithDocker]
#
# 可重複執行：已裝好、版本夠新的項目會略過；某一步失敗不影響其他步驟，最後列出失敗項目。
# 版本要求與 CI 一致（.github/workflows/ci.yml）。改版本時兩邊一起改。

[CmdletBinding()]  # 打錯參數時直接報錯，不會開始安裝
param(
    [switch]$SkipPaddle,   # 不裝 PaddleOCR 獨立環境（ai/.venv-paddle，下載量大）
    [switch]$SkipOcr,      # 不裝 Tesseract 與語言包
    [switch]$WithDocker    # 另裝 Docker Desktop（make up／make db-up 需要；需管理員權限與重開機）
)

# Windows PowerShell 5.1 在 Stop 模式下會把原生程式（git、gh、python…）寫到 stderr 的訊息當成例外，
# 所以全域用 Continue，只讓 cmdlet 出錯時中斷；原生程式一律以結束代碼判斷（Assert-ExitCode）。
$ErrorActionPreference = 'Continue'
$PSDefaultParameterValues = @{ '*:ErrorAction' = 'Stop' }
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$NodeMajor  = 22
$PythonMin  = [version]'3.11'
$BufVersion = '1.73.0'
# research/experiments/e2_label/README.md 記錄的語言包；換了就是不同的 OCR 引擎
$ChiTraUrl    = 'https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/chi_tra.traineddata'
$ChiTraSha256 = '1AA60488574CAFA69486D919284F079CA9B68FCC7F6AD8DC1FF1B318DFD97028'
$TesseractDir = 'C:\Program Files\Tesseract-OCR'
$TessdataDir  = Join-Path $env:LOCALAPPDATA 'dietai\tessdata'

$Failed = New-Object System.Collections.Generic.List[string]
$Notes  = New-Object System.Collections.Generic.List[string]

# ---------- 共用函式 ----------

function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Assert-ExitCode([string]$What) {
    if ($LASTEXITCODE -ne 0) { throw "$What 失敗（結束代碼 $LASTEXITCODE）" }
}

function Install-WingetPackage([string]$Id) {
    Write-Host "    winget install $Id ..."
    & winget install --id $Id --exact --source winget --silent `
        --accept-package-agreements --accept-source-agreements --disable-interactivity
    Assert-ExitCode "winget install $Id"
    Update-SessionPath
}

function Add-UserPath([string]$Dir) {
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($user -split ';') -notcontains $Dir) {
        [Environment]::SetEnvironmentVariable('Path', ($user.TrimEnd(';') + ';' + $Dir), 'User')
        Write-Host "    已將 $Dir 加入使用者 PATH"
    }
    Update-SessionPath
}

function Invoke-Step([string]$Name, [scriptblock]$Action) {
    Write-Host ''
    Write-Host "==> $Name" -ForegroundColor Cyan
    try {
        & $Action
    } catch {
        Write-Host "    [失敗] $($_.Exception.Message)" -ForegroundColor Red
        $Failed.Add($Name)
    }
}

function Write-Done([string]$Msg)  { Write-Host "    [完成] $Msg" -ForegroundColor Green }
function Write-Skip([string]$Msg)  { Write-Host "    [略過] $Msg" -ForegroundColor DarkGray }

function Get-PythonVersion {
    if (-not (Test-Command 'python')) { return $null }
    # Microsoft Store 的 python 捷徑不是真的 Python，執行會失敗
    $v = & python -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $v) { return $null }
    return [version]"$v".Trim()
}

function Get-RequiredGoVersion {
    $line = Get-Content (Join-Path $Root 'api\go.mod') | Where-Object { $_ -match '^go\s+(\d+\.\d+)' } | Select-Object -First 1
    if ($line -match '^go\s+(\d+\.\d+)') { return [version]$Matches[1] }
    throw 'api/go.mod 找不到 go 版本'
}

function Get-GoVersion {
    if (-not (Test-Command 'go')) { return $null }
    $v = & go env GOVERSION 2>$null
    if ("$v" -match 'go(\d+\.\d+)') { return [version]$Matches[1] }
    return $null
}

# ---------- 前置檢查 ----------

if (-not (Test-Command 'winget')) {
    Write-Host '找不到 winget。請先從 Microsoft Store 安裝「應用程式安裝程式」（App Installer），再重新執行。' -ForegroundColor Red
    exit 1
}
Update-SessionPath

Write-Host '開始安裝開發環境；已裝好的項目會自動略過。' -ForegroundColor Cyan

# ---------- 系統工具 ----------

Invoke-Step 'Git' {
    if (Test-Command 'git') { Write-Skip (& git --version) } else { Install-WingetPackage 'Git.Git'; Write-Done (& git --version) }
}

Invoke-Step 'GitHub CLI（gh）' {
    if (-not (Test-Command 'gh')) { Install-WingetPackage 'GitHub.cli' }
    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) { $Notes.Add('尚未登入 GitHub：執行 gh auth login（GitHub.com → HTTPS → 用瀏覽器登入）') }
    Write-Done ((& gh --version) | Select-Object -First 1)
}

Invoke-Step "Python $PythonMin 以上" {
    $v = Get-PythonVersion
    if ($v -and $v -ge $PythonMin) { Write-Skip "Python $v"; return }
    Install-WingetPackage 'Python.Python.3.12'
    $v = Get-PythonVersion
    if (-not $v -or $v -lt $PythonMin) { throw '已安裝 Python 3.12，但 PATH 上的 python 仍不符；請重開終端機後再執行一次' }
    Write-Done "Python $v"
}

Invoke-Step 'Go' {
    $need = Get-RequiredGoVersion
    $v = Get-GoVersion
    if ($v -and $v -ge $need) { Write-Skip "Go $v"; return }
    if ($v) {
        Write-Host "    目前 Go $v，api/go.mod 需要 $need 以上，升級中 ..."
        & winget upgrade --id GoLang.Go --exact --source winget --silent `
            --accept-package-agreements --accept-source-agreements --disable-interactivity
        Update-SessionPath
    } else {
        Install-WingetPackage 'GoLang.Go'
    }
    $v = Get-GoVersion
    if (-not $v -or $v -lt $need) { throw "Go 版本仍低於 $need；請重開終端機後再執行一次" }
    Write-Done "Go $v"
}

Invoke-Step "Node.js $NodeMajor" {
    if (Test-Command 'node') {
        $major = [int](((& node --version) -replace '^v', '') -split '\.')[0]
        if ($major -eq $NodeMajor) { Write-Skip (& node --version); return }
        if ($major -gt $NodeMajor) {
            Write-Skip (& node --version)
            $Notes.Add("Node.js 是 v$major，CI 用 $NodeMajor；若前端測試行為不同，改裝 OpenJS.NodeJS.$NodeMajor")
            return
        }
    }
    Install-WingetPackage "OpenJS.NodeJS.$NodeMajor"
    Write-Done (& node --version)
}

Invoke-Step 'make' {
    if (Test-Command 'make') { Write-Skip ((& make --version) | Select-Object -First 1); return }
    Install-WingetPackage 'ezwinports.make'
    if (-not (Test-Command 'make')) { throw '已安裝 make，但目前視窗找不到；重開終端機後再執行一次' }
    Write-Done ((& make --version) | Select-Object -First 1)
}

Invoke-Step "buf $BufVersion（make gen、make lint 用）" {
    if ((Test-Command 'buf') -and ((& buf --version) -eq $BufVersion)) { Write-Skip "buf $BufVersion"; return }
    & go install "github.com/bufbuild/buf/cmd/buf@v$BufVersion"
    Assert-ExitCode 'go install buf'
    Add-UserPath (Join-Path (& go env GOPATH) 'bin')
    Write-Done "buf $(& buf --version)"
}

# ---------- 專案環境 ----------

Invoke-Step '.env' {
    if (Test-Path '.env') { Write-Skip '.env 已存在'; return }
    Copy-Item '.env.example' '.env'
    Write-Done '已由 .env.example 建立（不可 commit；要測 LLM 時再填 LLM_API_KEY）'
}

Invoke-Step 'Python 套件（ai/.venv）' {
    & make setup
    Assert-ExitCode 'make setup'
    Write-Done 'ai/.venv'
}

Invoke-Step '工作台前端套件（workbench/node_modules）' {
    Push-Location 'workbench'
    try {
        & npm ci --no-audit --no-fund
        Assert-ExitCode 'npm ci'
    } finally {
        Pop-Location
    }
    Write-Done 'workbench/node_modules'
}

# ---------- OCR ----------

if ($SkipOcr) {
    Write-Host ''
    Write-Host '==> Tesseract：依 -SkipOcr 略過' -ForegroundColor DarkGray
} else {
    Invoke-Step 'Tesseract 與繁中語言包' {
        $exe = Join-Path $TesseractDir 'tesseract.exe'
        if (Test-Path $exe) { Write-Skip 'Tesseract 已安裝' } else { Install-WingetPackage 'UB-Mannheim.TesseractOCR' }
        if (-not (Test-Path $exe)) { throw "找不到 $exe" }

        New-Item -ItemType Directory -Force $TessdataDir | Out-Null
        foreach ($lang in 'eng', 'osd') {
            $dst = Join-Path $TessdataDir "$lang.traineddata"
            if (-not (Test-Path $dst)) { Copy-Item (Join-Path $TesseractDir "tessdata\$lang.traineddata") $dst }
        }

        $chi = Join-Path $TessdataDir 'chi_tra.traineddata'
        $ok = (Test-Path $chi) -and ((Get-FileHash $chi -Algorithm SHA256).Hash -eq $ChiTraSha256)
        if (-not $ok) {
            Write-Host '    下載 chi_tra 語言包（約 13 MB）...'
            $tmp = "$chi.download"
            Invoke-WebRequest -Uri $ChiTraUrl -OutFile $tmp -UseBasicParsing
            $hash = (Get-FileHash $tmp -Algorithm SHA256).Hash
            if ($hash -ne $ChiTraSha256) { Remove-Item $tmp; throw "chi_tra 語言包 SHA-256 不符：$hash" }
            Move-Item -Force $tmp $chi
        }

        if ([Environment]::GetEnvironmentVariable('DIETAI_TESSDATA', 'User') -ne $TessdataDir) {
            [Environment]::SetEnvironmentVariable('DIETAI_TESSDATA', $TessdataDir, 'User')
        }
        $env:DIETAI_TESSDATA = $TessdataDir
        Write-Done "語言包在 $TessdataDir（環境變數 DIETAI_TESSDATA）"
    }
}

if ($SkipPaddle) {
    Write-Host ''
    Write-Host '==> PaddleOCR：依 -SkipPaddle 略過' -ForegroundColor DarkGray
} else {
    Invoke-Step 'PaddleOCR 獨立環境（ai/.venv-paddle）' {
        & make setup-paddle
        Assert-ExitCode 'make setup-paddle'
        Write-Done 'ai/.venv-paddle（模型在首次執行時下載）'
    }
}

# ---------- AI 工具 ----------

Invoke-Step 'codebase-memory-mcp（程式碼圖索引，選用）' {
    & (Join-Path $PSScriptRoot 'install-codebase-memory.ps1')
}

# ---------- 選用 ----------

if ($WithDocker) {
    Invoke-Step 'Docker Desktop' {
        if (Test-Command 'docker') { Write-Skip (& docker --version); return }
        Install-WingetPackage 'Docker.DockerDesktop'
        $Notes.Add('Docker Desktop 裝好後需重開機，並開啟一次 Docker Desktop 完成初始設定')
    }
}

# ---------- 結果 ----------

Write-Host ''
Write-Host '================================================' -ForegroundColor Cyan
if ($Failed.Count -eq 0) {
    Write-Host '全部完成。' -ForegroundColor Green
} else {
    Write-Host "有 $($Failed.Count) 個項目失敗（上方有原因），處理後再執行一次即可：" -ForegroundColor Red
    foreach ($f in $Failed) { Write-Host "  - $f" -ForegroundColor Red }
}
Write-Host ''
Write-Host '接下來：'
Write-Host '  1. 關掉所有終端機與 VS Code 再重開，讓 PATH 與環境變數生效'
foreach ($n in $Notes) { Write-Host "  - $n" }
Write-Host '  2. 驗證：make test；啟動工作台：make workbench 或雙擊「啟動工作台.bat」'
if (-not $WithDocker) { Write-Host '  （需要資料庫時：再執行一次並加上 -WithDocker）' }

if ($Failed.Count -gt 0) { exit 1 }
