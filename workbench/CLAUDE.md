# CLAUDE.md（workbench／開發工作台前端）

先讀根目錄 `CLAUDE.md`。說明與結構見 `README.md`。

## 規則

- **只呼叫 Go**（`/workbench/v1`），不直接呼叫 Python；型別一律來自 `src/api/gen/`（由 `openapi/workbench.yaml` 產生，不手改）。需要新路由時先改規格（須由人審核），再 `make gen`。
- **數字由後端決定**：分數、比例、警告都取自 API 回應；前端只負責顯示與畫圖，不重算前處理的任何數值。唯一例外是「與合成真值比較」的評測顯示（例如四角誤差、菜數差異），放在 `lib/geometry.ts` 並有單元測試；之後規格加入真值比較欄位時改由後端提供。
- **影像與結果要配對**：結果一律連同算出它的 `imageId` 保存（`useAnalysis`），顯示時由 `AnalysisFrame` 配對同一張影像，不可把舊結果疊在新影像上。
- **介面只寫中文**：警告代碼、錯誤代碼等英文代碼在 `lib/text.ts` 對應中文；程式識別字維持英文。
- **風格**（柔和卡片風，參考 Finexy／Wink 儀表板）：淺灰畫布上的白色大圓角卡片（20px），幾乎不用陰影；導覽、分頁、分段按鈕、徽章都是膠囊形；主要按鈕與選中的導覽為黑底（`bg-ink text-on-ink`）。
- **色系**：強調色為橘（`primary`：滑桿、焦點、重點數字卡 `.hero-card`）；狀態用 `ok`（綠）、`warn`（琥珀）、`danger`（紅），**一律搭配圖示與文字**，不單靠顏色。圖表系列色用 `PALETTE`（`--series-1…8`，經色盲驗證的固定順序、橘在第一，依序取用、不循環）。疊圖：找到＝`FOUND`（橘實線）、真值＝`TRUTH`（藍虛線）。顏色一律用 `index.css` 的主題變數（支援深色模式），不寫死色碼。
- **版面**：左側浮動圖示欄＝深淺色切換＋模組；頂部列＝標誌、頁面膠囊、服務狀態。工具頁用 `Workspace`（控制面板卡＋大標題）＋`Split`（主檢視卡＋右側讀數卡）＋`MainView`（工具列＋撐滿的影像或可捲動的圖表）；狀態用 `StatusCard`，指標用 `MetricGrid`／`Metric`，讀數欄的其他區塊用 `ReadoutBlock`。
- **單張檢視**（`pages/inspect/`）：單張影像的前處理都是同一頁的「任務」，共用一張影像與一組模擬退化，切換任務時保留影像、退化與各任務參數；左欄依序為影像 → 模擬退化 → 處理參數（預設收合），不再分頁。新的單張前處理加成任務，不另開頁面。
- **不要把東西塞在同一個畫面**：次要的設定與資訊（準則、匯出、過去的執行）放進彈窗（`components/ui/Dialog.tsx`，以按鈕開啟）；不常看的細節表格用可展開的區塊（`<details>` 或 `Disclosure`）；有先後順序的操作做成步驟流程（`components/layout/Stepper.tsx`），一次只顯示一個步驟的畫面，底部列放「上一步／下一步」。工具頁的控制面板可由標題左側的按鈕收起（記在 `localStorage` 的 `wb.panelCollapsed`，所有工具頁共用）。
- **找最佳流程（實驗一）是四步流程**（`pages/results/BestFlow.tsx`、`pages/results/bestflow/`）：選擇圖片 → 逐張確認真值（大圖＋號碼輸入，預先帶入的號碼依序取自已確認的答案、檔名，一律要人按確認；程式從原圖讀到的號碼**只列為可點選的候選、不預先帶入**，被評測的解碼器不能同時提供答案）→ 比較方法 → 結論。圖片與答案只存在這個畫面：有進行中的比較或尚未寫進執行的答案時，離開實驗結果頁（`useBlocker`）或關閉分頁（`beforeunload`）前先問；人工真值寫入失敗時在結論頁頂部提醒並可重新送出，不可默默顯示只用程式推定真值算出的結論。圖片的鍵（`items.ts` 的 `nextKey`）同時是查詢鍵，必須在整個工作階段內唯一。後端流程不變：先 `POST /dev/best-flow/runs`，完成後一次 `PUT .../truth` 送出人工真值；執行裡的圖片 ID 是上傳時的原檔名（同名的加 `#2`，`lib/barcodeTruth.ts` 的 `uploadIds`）。規則化檔名（`f_a01_001_<條碼>.jpg`，通用工具的圖片批次命名或 `name_images.py` 產生）中的條碼，後端建立執行時就當作人工確認的真值。**前端不改檔名**：要把原始照片改成條碼號碼，結論頁的彈窗產生 Python 工具 `research/experiments/e1_barcode/rename_by_truth.py` 的指令（邏輯在 `dietai.devtools.rename_by_truth`，預設只改人工確認的，可 `--undo`）。檢查碼只用來即時提示，是否合法仍由後端判定。資料夾來源沒有逐張確認這一步。
- **模組一只有三頁**：單張檢視、多張測試（`pages/multi/`：參數掃描、資料夾批次）、實驗結果（`pages/results/`：E1 消融、自適應策略）。模式在網址最後一段，標題列右側切換；去過的模式以 `KeepAlive` 保持掛載。所有左欄都用 `PanelSections` 由上而下排段落，不用分頁。
- **專案架構圖**（`pages/arch/`、`lib/arch/`）：唯一不經後端的頁面，文件存在 `localStorage`（`wb.arch`），以匯出／匯入 JSON 交換。工作台裡的 `/tools/arch`（舊網址 `/arch/diagram` 會導過來）**只顯示成品**；編輯一律在新分頁的 `/arch/edit`（註冊在 `AppShell` 之外的全頁介面，類似 IcePanel：左側工具列＋點點格子的無限畫布＋右側屬性面板），兩邊經 `storage` 事件同步。元件的位置與尺寸**一律是 20 px 格點的倍數**（`applyOp` 與 `parseDoc` 都會對齊），不要為了對齊其他元件而停在格點之間；連線端點可固定在圖形某一邊的定位點（每邊 1/4、中點、3/4）、自動選邊或是自由端點；畫連線一律經 `layoutEdges`（同一對元件的多條自動連線會錯開）。圖是產出物（匯出的 SVG／PNG 要自帶顏色），新元件的預設樣式與色票寫死在 `lib/arch/theme.ts`，是「顏色用主題變數」的例外；每個元件與連線的樣式存在文件裡。檢視、編輯、匯出共用 `DiagramSvg.tsx` 的畫法，匯出用另一張不含選取與定位點的隱藏圖。模型、路徑、吸附與驗證是純函式，改了要補 `lib/arch/arch.test.ts`。
- **通用工具**（`/tools`，`pages/tools/`）：不屬於特定研究模組的工具，總覽頁以按鈕列出（取自 `nav.ts` 的 `tools` 模組），點了進入各自的專屬頁面；新工具在 `nav.ts` 登記並在 `App.tsx` 註冊路由。目前有圖片批次命名（`/tools/naming`：預覽 → 確認彈窗後改名 → 可還原；改名時後端依資料夾重新規劃，不採用前端的預覽）與架構圖（`/tools/arch`）。
- **選資料夾**：所有輸入本機資料夾路徑的地方，輸入框旁放 `components/FolderPicker.tsx` 的「瀏覽…」按鈕（彈窗逐層點選，`GET /dev/folders` 由 Python 列出子資料夾與影像張數，test split 標示鎖定）。瀏覽器的系統「選擇資料夾」視窗拿不到完整路徑，不要改用它。
- **設定**：請求只帶與預設值不同的欄位（`lib/config.ts` 的 `setOverride`）；表單由 `ParamForm` 依結構自動產生，不手寫欄位。
- **即時調參**：輸入經 `useDebounced`（150 ms）後才進查詢鍵；查詢用 `placeholderData: keepPreviousData` 保留舊結果並淡化；查詢函式要傳入 `signal`，舊請求才會被取消。
- **影像**：影像只上傳一次，之後只帶 `image_id`；顯示用 `artifactUrl(id)`。幾何結果以 `ImageViewer` 的 `overlay`（SVG、影像座標）疊圖，不要求後端畫進影像。
- **圖表**：用 `components/charts.tsx` 的 SVG 元件（顏色用主題變數與 `PALETTE`），不另外引入圖表套件。
- **長時間工作**（批次、E1）以 SSE 回報：用 `useStream`，離開頁面時自動取消。
- **測試**：每個頁面要有 Vitest＋MSW 的頁面測試與一個 Playwright 冒煙測試；純函式放 `lib/` 並寫單元測試。
- 依賴版本固定（package.json 不用 `^`）；升級另開 PR。

## 指令

```bash
npm run lint && npm run typecheck && npm test
npm run test:e2e   # 接真實服務
```
