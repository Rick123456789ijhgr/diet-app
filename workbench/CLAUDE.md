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
