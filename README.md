# 飲食紀錄系統（專題）

以結構化資料強化 AI 飲食辨識可靠性之紀錄系統。規劃書見 `docs/`。

## 目錄

| 路徑 | 內容 |
| --- | --- |
| `app/` | Flutter APP |
| `api/` | Go 主伺服器（API、資料存取、任務管理、營養計算） |
| `ai/` | Python 外掛服務（影像前處理、OCR、LLM 校正、資料分析） |
| `proto/` | gRPC 規格（Go ↔ Python） |
| `openapi/` | REST API 規格（Flutter ↔ Go） |
| `db/` | 資料庫 migration |
| `research/` | 實驗設定與 notebook（只 import `ai/` 套件） |
| `deploy/` | Docker Compose 與部署設定 |
| `docs/` | ADR、模組對照表、標註規範 |

## 快速開始

需要 Python 3.11 以上、Go 1.26 以上、Node.js 22 與 make；完整安裝步驟見 [`ONBOARDING.md`](ONBOARDING.md)。

```bash
cp .env.example .env
make setup       # 建立 ai/.venv 並安裝 Python 套件
make test        # 跑所有服務的測試
make workbench   # 開發工作台：http://localhost:8080
make up          # 啟動 PostgreSQL、MinIO、api、ai（需要 Docker）
```

開發規範見 `CLAUDE.md`，架構決策見 `docs/adr/`。
