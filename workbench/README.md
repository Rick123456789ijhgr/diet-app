# 開發工作台

以合成影像或開發照片測試各模組、調整參數。架構與決策見 [ADR 0003](../docs/adr/0003-workbench-react-go.md)，進度見[任務書](../docs/tasks/workbench-react.md)。

```
瀏覽器 → Go 主伺服器（:8080；/workbench/v1 為 API，其餘路徑為建置後的前端）→ Python gRPC（:50051）
```

前端以 `vite build` 輸出到 `api/internal/webui/static/app/`（不進 git），Go 編譯時以 `embed` 打包進執行檔，
因此只有一個網址、一個 Go 程序。尚未完成的頁面會顯示「預計在階段 N 完成」。

## 啟動

需要 Python 3.11 以上、Go 1.26 以上、Node.js 22。

```bash
make workbench        # 建置前端，啟動 Python 與 Go，就緒後開啟 http://localhost:8080；Ctrl+C 全部停止
make workbench-dev    # 改前端時用：另外啟動 Vite 熱更新，開啟 http://localhost:5173
```

Windows 也可以雙擊根目錄的 `啟動工作台.bat`（等同 `make workbench`；已在執行時直接開啟瀏覽器，關閉視窗即停止）。
都會在缺少時自動安裝 Python 套件（`ai/.venv`）與前端套件（`npm ci`），並等服務都就緒才開瀏覽器。

也可以分開啟動：

```bash
cd ai && WORKBENCH_DEV_TOOLS=1 python -m dietai.server          # Python gRPC
cd api && WORKBENCH_DEV_TOOLS=1 go run ./cmd/server               # Go（含最近一次建置的前端）
cd workbench && npm run dev                                       # Vite（/workbench 代理到 :8080）
```

## 冷啟動上傳

冷啟動上傳（左欄「冷啟動」）要寫入產品資料庫，除了上面的服務外還需要 Postgres 與 MinIO，並且須登入。
開發工具頁不需要登入。沒有設定資料庫時，頁面會顯示「資料庫或物件儲存未設定或無法連線」（DB_UNAVAILABLE）。

1. 安裝並開啟 Docker Desktop。
2. 在根目錄把 `.env.example` 複製為 `.env` 並填入密碼，執行 `make db-up`：只啟動 Postgres、物件儲存（S3 相容的 RustFS，
   MinIO 已不提供公開映像；設定沿用 `MINIO_*`）並套用 migration
   （`make up` 會另外啟動容器版的 Go 與 Python，與 `make workbench` 的埠衝突）。
3. `make workbench`：`scripts/dev.mjs` 由 `.env` 推導 `DATABASE_URL`（`localhost:5432`）與 MinIO 設定
   （`MINIO_ENDPOINT=localhost:9000`、`MINIO_ACCESS_KEY`／`MINIO_SECRET_KEY` 沿用 `MINIO_ROOT_USER`／`MINIO_ROOT_PASSWORD`）傳給 Go；
   已設定這些環境變數時以環境變數為準。Go 啟動時的日誌 `"coldstart":true` 代表已連上。
4. 建立帳號（密碼至少 10 個字元，由終端機輸入、不顯示；腳本中可用環境變數 `WBUSER_PASSWORD`）：

   ```bash
   cd api && DATABASE_URL=postgres://diet:<密碼>@localhost:5432/diet?sslmode=disable go run ./cmd/wbuser add <帳號> <顯示名稱>
   go run ./cmd/wbuser passwd <帳號>   # 重設密碼（該帳號所有登入都會失效）
   ```

5. 開啟 `/coldstart/submissions` 登入。

流程：新增上傳（草稿）→ 上傳包裝正面、條碼、營養標示三張照片（後端做前處理；條碼照片解出唯一條碼時預先填入）
→ 對照照片輸入品名、淨重、營養標示（每份與每 100 公克或毫升；停止輸入約 0.8 秒後自動儲存）→ 確認並建立產品。
前端不計算、不換算營養數值；缺少欄位、數值不一致、條碼已存在都由後端回報，頁面只顯示並讓人選擇處理方式。

冒煙測試 `e2e/coldstart.spec.ts` 需要上述環境與測試帳號（`WORKBENCH_TEST_USER`、`WORKBENCH_TEST_PASSWORD`），沒有時自動略過。

## 指令

```bash
npm run lint        # ESLint＋Prettier
npm run typecheck   # TypeScript（strict）
npm test            # Vitest＋Testing Library，後端以 MSW 假造（src/test/server.ts）
npm run test:e2e    # Playwright 冒煙測試，接真的 Go 與 Python（沒在執行時以 --dev 模式自動啟動）；首次執行前 npx playwright install chromium
npm run build       # 型別檢查並建置到 api/internal/webui/static/app/
```

## 結構

```
src/
  api/client.ts       openapi-fetch 客戶端、ApiError、artifactUrl
  api/gen/            由 openapi/workbench.yaml 產生（make gen），不手改
  nav.ts              模組與頁面註冊表（左側圖示欄＝模組，頂部膠囊＝頁面）
  App.tsx             路由；完成的頁面在這裡註冊（延遲載入）
  queryClient.ts      TanStack Query 設定；IMAGE_NOT_FOUND 時自動重新上傳
  components/
    layout/           外框（AppShell：左側圖示欄＋頂部列）、工具頁卡片版面（Workspace、Split、MainView）
    ui/primitives.tsx 基本元件（shadcn/ui 風格，以 Radix 為底）
    ToolPanel.tsx     左側控制面板（影像／參數／匯出入分頁）
    ParamForm.tsx     依 Python param() 宣告自動產生的參數表單
    LadderControls    條碼階梯的序列參數（嘗試順序、多尺度倍率、採用格式）
    ImageViewer.tsx   可縮放、拖曳、查座標的影像檢視，幾何結果以 SVG 疊圖
    overlays.tsx      疊圖用的四邊形、矩形、橢圓（找到＝橘、真值＝藍虛線）
    results.tsx       結果區：AnalysisFrame（載入、錯誤、淡化）、狀態（StatusCard）、讀數格（MetricGrid／Metric）、表格
    ImageSourcePanel  影像來源（合成場景參數／上傳）＋模擬退化
    ConfigIO.tsx      匯出 JSON、Python 建構式、匯入
    coldstart/        冷啟動上傳：登入外框（LoginGate）、照片槽、草稿表單、產品摘要
  hooks/
    useImagePipeline  來源 → 暫存原圖 → 退化後影像
    useAnalysis       分析查詢：防抖、取消舊請求、往返時間、出錯時保留上次結果
    useRenderView     診斷檢視（邊緣、遮罩、各階影像等）
    useAuth           登入狀態（GET /auth/me）、登入、登出
  lib/                設定覆寫、合成場景、縮放、位元組與幾何顯示、中文文字對照（純函式，有單元測試）
  pages/              各頁
scripts/dev.mjs       建置前端並啟動 Python、Go（--dev 另啟動 Vite）；自動安裝缺少的套件、就緒後開瀏覽器
e2e/                  Playwright 冒煙測試
```

## 新增一個頁面

1. 在 `nav.ts` 把該工具的 `ready` 改為 `true`。
2. 在 `pages/` 新增頁面：`Workspace`（控制面板＋頁首）＋`ToolPanel`，`useImagePipeline` 取影像、`useAnalysis` 呼叫分析、`AnalysisFrame` 處理載入與錯誤，結果用 `Split`（`MainView` 主檢視＋讀數欄），參數用 `ParamForm`，影像用 `ImageViewer fill`（幾何結果用 `overlays.tsx` 疊圖）。可參考 `QualityPage`、`LabelPage`。
3. 在 `App.tsx` 註冊路由（`lazy` 載入）。
4. 補 `src/test/server.ts` 的假回應與頁面測試，並在 `e2e/` 加一個冒煙測試。

後端需要的新路由與 RPC 先改規格（`openapi/workbench.yaml`、`proto/`，須由人審核），再 `make gen`。
