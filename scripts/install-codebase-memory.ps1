# 安裝 codebase-memory-mcp（程式碼圖索引 MCP server），說明見 docs/codebase-memory-mcp.md。
# 只安裝執行檔並加入使用者 PATH；不執行官方 install，不改其他 AI 工具設定、不裝 hooks。
#
# 用法（在專案根目錄）：
#   powershell -ExecutionPolicy Bypass -File scripts\install-codebase-memory.ps1
#
# 升級版本：改下面的 $Version 與 $Sha256（取自該版 Release 的 checksums.txt），全隊一起升。
# 所有 codebase-memory-mcp 程序必須是同一個版本，混用會被拒絕執行。

$ErrorActionPreference = 'Stop'

$Version = '0.12.1'
$Sha256  = '4E4E0F16B45233AF5C757A1FCBE3C3B16E9056375B1FBE2CE020B6DE75DEDCC0'
$Repo    = 'DeusData/codebase-memory-mcp'
$Asset   = 'codebase-memory-mcp-windows-amd64.zip'
$Url     = "https://github.com/$Repo/releases/download/v$Version/$Asset"
$Dest    = Join-Path $env:LOCALAPPDATA 'codebase-memory-mcp'
$Exe     = Join-Path $Dest 'codebase-memory-mcp.exe'

$installed = $false
if (Test-Path $Exe) {
    $current = (& $Exe --version) 2>$null
    if ("$current" -match [regex]::Escape($Version)) { $installed = $true }
}

if ($installed) {
    Write-Host "已安裝 v$Version，略過下載。"
} else {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('cbm-' + [guid]::NewGuid())
    New-Item -ItemType Directory $tmp | Out-Null
    try {
        $zip = Join-Path $tmp $Asset
        Write-Host "下載 v$Version ..."
        Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing

        $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
        if ($hash -ne $Sha256) { throw "SHA-256 不符，停止安裝。預期 $Sha256，實際 $hash" }
        Write-Host 'SHA-256 驗證通過。'

        $gh = Get-Command gh -ErrorAction SilentlyContinue
        if ($gh) {
            & gh auth status *> $null
            if ($LASTEXITCODE -eq 0) {
                & gh attestation verify $zip --repo $Repo --signer-workflow "$Repo/.github/workflows/_build.yml" *> $null
                if ($LASTEXITCODE -ne 0) { throw 'SLSA 來源證明驗證失敗，停止安裝。' }
                Write-Host 'SLSA 來源證明驗證通過。'
            }
        }

        # 舊版 daemon 執行中會鎖住執行檔，先停掉
        if (Test-Path $Exe) { & $Exe daemon stop *> $null }

        New-Item -ItemType Directory -Force $Dest | Out-Null
        Expand-Archive $zip -DestinationPath $Dest -Force
        Get-ChildItem $Dest | Unblock-File
    } finally {
        Remove-Item -Recurse -Force $tmp
    }
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $Dest) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $Dest), 'User')
    Write-Host "已將 $Dest 加入使用者 PATH。"
}

# 預設關閉本機網頁 UI（CBM Lens）；要用時見說明文件
& $Exe config set ui_enabled false *> $null

Write-Host ''
Write-Host "完成：$(& $Exe --version)"
Write-Host '請完全關閉 VS Code 再重開，Claude Code 詢問是否信任 .mcp.json 的 server 時選同意。'
