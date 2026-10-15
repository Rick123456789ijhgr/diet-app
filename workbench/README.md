# 開發工作台（React 版）

以合成影像或開發照片測試各模組、調整參數。架構與決策見 [ADR 0003](../docs/adr/0003-workbench-react-go.md)，進度見[任務書](../docs/tasks/workbench-react.md)。

```
瀏覽器（React，:5173）→ Go 主伺服器（/workbench/v1，:8080）→ Python gRPC（:50051）
```

新版完成前（任務書階段 4）與 Streamlit 版（`make workbench`）並存；尚未遷移的頁面會顯示「預計在階段 N 完成」。

## 啟動

需要 Python 3.11 以上、Go 1.25、Node.js 22。

```bash
make workbench-react        # 一次啟動三個程序，就緒後開啟瀏覽器；Ctrl+C 全部停止
```

Windows 也可以雙擊根目錄的 `啟動全部服務.bat`（已在執行時直接開啟瀏覽器，關閉視窗即停止）。
兩者都會在缺少時自動安裝 Python 套件（`ai/.venv`）與前端套件（`npm ci`），並等三個服務都就緒才開瀏覽器。

只改前端時，也可以分開啟動：

```bash
cd ai && WORKBENCH_DEV_TOOLS=1 python -m dietai.server          # Python gRPC
cd api && WORKBENCH_DEV_TOOLS=1 go run ./cmd/server               # Go
cd workbench && npm run dev                                       # Vite（/workbench 代理到 :8080）
```

## 指令

```bash
npm run lint        # ESLint＋Prettier
npm run typecheck   # TypeScript（strict）
npm test            # Vitest＋Testing Library，後端以 MSW 假造（src/test/server.ts）
npm run test:e2e    # Playwright 冒煙測試，接真的 Go 與 Python（沒在執行時會自動啟動）；首次執行前 npx playwright install chromium
npm run build
```

## 結構

```
src/
  api/client.ts       openapi-fetch 客戶端、ApiError、artifactUrl
  api/gen/            由 openapi/workbench.yaml 產生（make gen），不手改
  nav.ts              模組與頁面註冊表（左欄＝模組，頂部膠囊＝頁面）
  App.tsx             路由；完成的頁面在這裡註冊（延遲載入）
  queryClient.ts      TanStack Query 設定；IMAGE_NOT_FOUND 時自動重新上傳
  components/
    layout/           外框（AppShell）、工具頁雙欄（Workspace）
    ui/primitives.tsx 基本元件（shadcn/ui 風格，以 Radix 為底）
    ToolPanel.tsx     左側控制面板（影像／參數／匯出入分頁）
    ParamForm.tsx     依 Python param() 宣告自動產生的參數表單
    LadderControls    條碼階梯的序列參數（嘗試順序、多尺度倍率、採用格式）
    ImageViewer.tsx   可縮放、拖曳、查座標的影像檢視，幾何結果以 SVG 疊圖
    overlays.tsx      疊圖用的四邊形、矩形、橢圓（找到＝紫、真值＝靛藍虛線）
    results.tsx       結果區：AnalysisFrame（載入、錯誤、淡化）、狀態列、指標卡、表格
    ImageSourcePanel  影像來源（合成場景參數／上傳）＋模擬退化
    ConfigIO.tsx      匯出 JSON、Python 建構式、匯入
  hooks/
    useImagePipeline  來源 → 暫存原圖 → 退化後影像
    useAnalysis       分析查詢：防抖、取消舊請求、往返時間、出錯時保留上次結果
    useRenderView     診斷檢視（邊緣、遮罩、各階影像等）
  lib/                設定覆寫、合成場景、縮放、位元組與幾何顯示、中文文字對照（純函式，有單元測試）
  pages/              各頁
scripts/dev.mjs       一次啟動 Python、Go、Vite（自動安裝缺少的套件、就緒後開瀏覽器）
e2e/                  Playwright 冒煙測試
```

## 新增一個頁面

1. 在 `nav.ts` 把該工具的 `ready` 改為 `true`。
2. 在 `pages/` 新增頁面：`Workspace`＋`ToolPanel` 排版，`useImagePipeline` 取影像、`useAnalysis` 呼叫分析、`AnalysisFrame` 處理載入與錯誤，參數用 `ParamForm`，影像用 `ImageViewer`（幾何結果用 `overlays.tsx` 疊圖）。可參考 `QualityPage`、`LabelPage`。
3. 在 `App.tsx` 註冊路由（`lazy` 載入）。
4. 補 `src/test/server.ts` 的假回應與頁面測試，並在 `e2e/` 加一個冒煙測試。

後端需要的新路由與 RPC 先改規格（`openapi/workbench.yaml`、`proto/`，須由人審核），再 `make gen`。
