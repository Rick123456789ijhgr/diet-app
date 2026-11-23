# codebase-memory-mcp（程式碼圖索引）

[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) 把整個 repo 解析成本機的圖資料庫（函式、呼叫關係、HTTP／gRPC 路由），讓 Claude Code 直接查呼叫鏈、跨服務路徑（React → Go → Python）與修改影響範圍，不必逐檔 grep。

- 全部在本機執行，不會上傳程式碼；索引存在 `~/.cache/codebase-memory-mcp`。
- 專案已在 `.mcp.json` 註冊；排除清單在 `.cbmignore`。
- 選用工具：沒安裝也不影響開發，只是 Claude Code 會顯示這個 server 連線失敗。

## 安裝（Windows）

在專案根目錄執行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-codebase-memory.ps1
```

腳本會下載固定版本、比對 SHA-256（有登入 `gh` 時再驗 SLSA 來源證明）、解壓縮到 `%LOCALAPPDATA%\codebase-memory-mcp\` 並加入 PATH。裝完**完全關閉 VS Code 再重開**，Claude Code 詢問是否信任 `.mcp.json` 的 server 時選同意，再用 `/mcp` 確認連線。

不要執行官方的 `install` 指令：它會改寫電腦上所有 AI 工具的使用者層級設定，並安裝 hooks 與 skills。

## 使用

照平常用中文問 Claude 即可，它會自己判斷何時查圖、何時 grep。適合的問題：

| 想知道 | 例句 |
| --- | --- |
| 修改的影響範圍 | 「這次 diff 會影響哪些地方？」 |
| 跨服務呼叫鏈 | 「工作台按下解碼後，一路到 Python 經過哪些函式？」 |
| 誰在用某個函式 | 「誰呼叫了 `locate_barcode`？」 |
| 找功能在哪 | 「處理 CLAHE 的程式在哪？」 |
| 死碼 | 「哪些 Python 函式沒人呼叫？」 |

字串常數、警告代碼、JSON 與 Markdown 內容仍以 grep 查找較準。

確認 Claude 有沒有用到：對話中的工具呼叫列會出現 `mcp__codebase-memory-mcp__...`。

索引在 Claude Code 開著時會自動跟著 git 變動更新；改了 `.cbmignore` 之後要請 Claude「重新索引這個專案」。

## 視覺化（CBM Lens，選用）

```powershell
codebase-memory-mcp config set ui_enabled true
codebase-memory-mcp daemon stop
codebase-memory-mcp daemon start --open --port=9749
```

瀏覽器會開 `http://127.0.0.1:9749`（只限本機）。用完執行 `codebase-memory-mcp daemon stop`，否則關掉 VS Code 後它仍會常駐。不建議使用其中的本機 Chat（需下載約 567 MB 模型）與 ADR 分頁（存在索引裡，和 `docs/adr/` 是兩套）。

## 移除

刪除 `%LOCALAPPDATA%\codebase-memory-mcp\` 與 `~/.cache/codebase-memory-mcp`，並從使用者 PATH 移除該目錄。
