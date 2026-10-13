# CLAUDE.md（workbench／開發工作台前端）

先讀根目錄 `CLAUDE.md`。說明與結構見 `README.md`。

## 規則

- **只呼叫 Go**（`/workbench/v1`），不直接呼叫 Python；型別一律來自 `src/api/gen/`（由 `openapi/workbench.yaml` 產生，不手改）。需要新路由時先改規格（須由人審核），再 `make gen`。
- **數字由後端決定**：分數、比例、警告都取自 API 回應；前端只負責顯示與畫圖，不重算前處理的任何數值。
- **介面只寫中文**：警告代碼、錯誤代碼等英文代碼在 `lib/text.ts` 對應中文；程式識別字維持英文。
- **色系**：靛藍主色、紫輔色；狀態只用靛藍（正常）與紅（異常），不使用綠與橘。顏色一律用 `index.css` 的主題變數（支援深色模式），不寫死色碼。
- **設定**：請求只帶與預設值不同的欄位（`lib/config.ts` 的 `setOverride`）；表單由 `ParamForm` 依結構自動產生，不手寫欄位。
- **即時調參**：輸入經 `useDebounced`（150 ms）後才進查詢鍵；查詢用 `placeholderData: keepPreviousData` 保留舊結果並淡化；查詢函式要傳入 `signal`，舊請求才會被取消。
- **影像**：影像只上傳一次，之後只帶 `image_id`；顯示用 `artifactUrl(id)`。幾何結果以 `ImageViewer` 的 `overlay`（SVG、影像座標）疊圖，不要求後端畫進影像。
- **測試**：每個頁面要有 Vitest＋MSW 的頁面測試與一個 Playwright 冒煙測試；純函式放 `lib/` 並寫單元測試。
- 依賴版本固定（package.json 不用 `^`）；升級另開 PR。

## 指令

```bash
npm run lint && npm run typecheck && npm test
npm run test:e2e   # 接真實服務
```
