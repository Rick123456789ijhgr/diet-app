# 新組員上手指南

從零開始：取得專案、安裝工具、跑起工作台、送出第一個 PR。以 Windows 為主，macOS／Linux 用對應的套件管理工具即可。

## 1. 取得權限

專案在 <https://github.com/Rick123456789ijhgr/diet-app>（公開，可直接下載）。要推分支、開 PR 須是協作者：把 GitHub 帳號給 Rick，收到邀請後到信箱或 GitHub 通知按「接受」。

## 2. 下載專案

```powershell
winget install Git.Git
winget install GitHub.cli
```

裝完**關掉終端機再重開**，然後：

```powershell
gh auth login                          # GitHub.com → HTTPS → 用瀏覽器登入
gh repo clone Rick123456789ijhgr/diet-app
cd diet-app
```

## 3. 一鍵安裝開發環境

雙擊根目錄的 **`安裝開發環境.bat`**（或執行 `powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1`）。會自動安裝並設定：

| 項目 | 內容 |
| --- | --- |
| 系統工具 | Python 3.11+、Go（依 `api/go.mod`）、Node.js 22、make、buf 1.73.0 |
| 專案環境 | `.env`（由 `.env.example` 複製）、`ai/.venv`（`make setup`）、`workbench/node_modules` |
| OCR | Tesseract 與繁中語言包 `chi_tra`（驗證 SHA-256，設定 `DIETAI_TESSDATA`）、PaddleOCR 獨立環境 `ai/.venv-paddle` |
| AI 工具 | codebase-memory-mcp（說明見 `docs/codebase-memory-mcp.md`） |

可以重複執行：已裝好的會略過，某一步失敗不影響其他步驟，最後會列出失敗項目。裝完**關掉所有終端機與 VS Code 再重開**。

選用參數（雙擊時無法加，請在終端機執行 `安裝開發環境.bat -參數`）：

| 參數 | 用途 |
| --- | --- |
| `-WithDocker` | 另裝 Docker Desktop：要用 `make up`／`make db-up`（Postgres、MinIO、冷啟動上傳）時。需管理員權限與重開機。 |
| `-SkipPaddle` | 不裝 PaddleOCR（下載量大；不做 E2 營養標示實驗可略過） |
| `-SkipOcr` | 不裝 Tesseract |

開發 `app/` 時另裝 Flutter（尚未納入腳本）。

> 不必在 `.env` 填 `LLM_API_KEY`，除非要測 LLM 相關功能；金鑰只放 Python 服務，不可出現在 APP 或 Go。

## 4. 確認環境正常

```powershell
make test                              # Go、Python、工作台前端的測試
make lint
make workbench                         # 開啟 http://localhost:8080，Ctrl+C 全部停止
```

不想打指令時，雙擊根目錄的 `啟動工作台.bat`：會檢查缺少的工具、自動安裝套件，就緒後開啟工作台。

需要資料庫時（要先以 `安裝開發環境.bat -WithDocker` 裝 Docker Desktop）：

```powershell
make db-up                             # 只啟動 Postgres、MinIO 並套用 migration
make up                                # 啟動所有服務
```

## 5. 開始工作前要讀

1. [`CLAUDE.md`](CLAUDE.md)：**不可違反的規則**（數字由程式決定、Go 是唯一寫入者、規格與 migration 由人主導等）。各服務資料夾另有自己的 `CLAUDE.md`，越近越優先。
2. [`docs/module-map.md`](docs/module-map.md)：模組與資料夾對照。
3. [`docs/adr/`](docs/adr/)：重大設計決策。
4. 要做工作台時看 [`workbench/README.md`](workbench/README.md)。

## 6. 工作流程

```powershell
git switch main; git pull
git switch -c feat/ai-preprocess-deskew          # 或 fix/api-barcode-checksum
# ……修改、加測試……
make test; make lint
git commit -m "feat(ai/preprocess): 新增 CLAHE 步驟"
git push -u origin HEAD
gh pr create                                     # PR 描述以繁體中文為主
```

- 從 `main` 開短命分支；每個 PR 小而單一目的，且必須附測試。
- Commit 採 Conventional Commits，說明用繁體中文。
- 疊加的 PR（base 不是 `main`）要依序合併，合併前確認 base 分支。
- 不要手改任何 `gen/` 目錄；要改就改規格後執行 `make gen`。

## 常見問題

- **安裝腳本有項目失敗**：依紅字原因處理後再雙擊 `安裝開發環境.bat` 一次，已裝好的會略過。
- **`make`、`go` 等指令找不到**：安裝後要關掉終端機與 VS Code 再重開，讓 PATH 生效。
- **`go` 要求更新版本**：`api/go.mod` 升版後，再執行一次安裝腳本即會升級 Go。
- **工作台啟動失敗**：把終端機的錯誤訊息整段貼給組員或 AI 工具。
