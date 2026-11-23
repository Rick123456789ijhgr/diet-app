# 模組一 code review：疑似問題清單

> 範圍：模組一「影像前處理」的 Python 套件、開發工作台（Go 後端、React 前端、Python `devtools`）與 E1 實驗腳本。
> 產生方式：為人工審查補中文註解時，逐檔閱讀程式並記錄疑點；**本清單只列問題，程式一行都沒改**。
> 行號以加上註解後的檔案為準（與本 PR 合併後的 `main` 一致）。
> 標記「已驗證」者已實際執行或對照程式確認；其餘為閱讀程式後的判斷，請審查者確認。

## 使用方式

- 每項附「建議」，審查時在「處理」欄勾選：修正（開 `fix/` 分支）、維持（寫明理由）、待討論。
- 修正時依專案規則每個 PR 附測試；涉及門檻的項目不得以 test split 調整（根目錄 `CLAUDE.md` 規則 7）。

## 一覽

| 嚴重度 | 數量 | 說明 |
| --- | --- | --- |
| A 確定的錯誤 | 6 | 結果會錯或程式會崩潰，建議修正 |
| B 需確認設計意圖 | 10 | 行為與文件或直覺不符，可能是刻意的 |
| C 違反專案規範 | 6 | 與 `CLAUDE.md` 的規定不一致 |
| D 邊界情況與穩健性 | 21 | 罕見輸入下才出錯 |
| E 輕微（風格、使用體驗） | 16 | 不影響正確性 |

---

## A 確定的錯誤

| # | 位置 | 問題 | 建議 | 處理 |
| --- | --- | --- | --- | --- |
| A1 | [types.py:105](../../ai/src/dietai/preprocess/types.py#L105) `Box.crop` | 起點截到 0，終點沒截。框整個在影像左方或上方時（如 `x=-10, w=5`，`x1=-5`），切片變成 `img[..., 0:-5]`，回傳一塊錯誤且非空的區域。**已驗證**：`Box(-10, 0, 5, 3)` 對 10×10 影像回傳 3×5。 | 終點也夾到 `[0, 寬/高]`，並補測試 | ☐ |
| A2 | [manifest.py:149-153](../../ai/src/dietai/evaluation/manifest.py#L149-L153) `write_manifest` | 設了 `extrasaction="raise"`，但先用 `{k: row.get(k, "") for k in fieldnames}` 過濾，raise 永遠不會觸發；沒列在 `tag_columns` 的標籤欄被靜默丟掉。**已驗證**（讀程式）。 | 決定要報錯還是丟棄；要報錯就直接傳 `row` | ☐ |
| A3 | [server/workbench.py:196](../../ai/src/dietai/server/workbench.py#L196) 配合 [store.py:195](../../ai/src/dietai/devtools/store.py#L195) | 條碼掃描縮圖以 `barcode-sweep:...` 為衍生來源鍵，但它不是暫存影像 ID，`_evict` 會清掉 `k[0]` 不在 `_items` 的對應，所以縮圖從不重用，每次掃描新增三張，與程式註解相反。結果正確，只多占暫存區。**已驗證**（讀程式）。 | 另設不受 `_evict` 清除的快取，或改寫註解 | ☐ |
| A4 | [lib/config.ts:123](../../workbench/src/lib/config.ts#L123) | 匯入 `{"values": null}` 或 `values` 不是物件時，下一步 `Object.entries` 丟 TypeError 而非 `ConfigImportError`，介面顯示不出中文錯誤。 | 檢查型別後丟 `ConfigImportError` | ☐ |
| A5 | [lib/config.ts:72](../../workbench/src/lib/config.ts#L72) `pyScalar` | 字串值沒有跳脫 `'` 與 `\`，產生的 Python 建構式語法會錯（目前序列欄位多為 rung 名稱，影響小）。 | 用 `JSON.stringify` 或手動跳脫 | ☐ |
| A6 | [scripts/dev.mjs:108](../../workbench/scripts/dev.mjs#L108) `ensureNode` | 沒有 `package-lock.json` 時 `statSync(lock)` 丟例外，腳本直接崩潰，不走 `fail()` 的中文訊息。 | 先 `existsSync(lock)` | ☐ |

## B 需確認設計意圖

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| B1 | [barcode.py:240](../../ai/src/dietai/preprocess/barcode.py#L240) `min_agree` | 票數跨嘗試累計，多尺度同一階的兩個倍率就能湊滿 2 票。若「確認」本意是兩個不同前處理階同意，需改為依階計票。 | ☐ |
| B2 | [evaluation/barcode.py:167](../../ai/src/dietai/evaluation/barcode.py#L167) `judge` | 模組 docstring 寫負樣本「有任何結果 → false_positive」，實際只看已達 `min_agree` 的 `hits`；`min_agree > 1` 時零星解碼判為 true_negative。行為或文件擇一修正。 | ☐ |
| B3 | [invoice_qr.py:68](../../ai/src/dietai/preprocess/invoice_qr.py#L68) | 左右兩碼只依中心 x 座標區分，照片轉 90°／180° 時會判錯或對調。建議 Go 端解析時以內容再確認（右碼以 `**` 開頭）。 | ☐ |
| B4 | [label.py:133](../../ai/src/dietai/preprocess/label.py#L133)、[label.py:149](../../ai/src/dietai/preprocess/label.py#L149) | 光斑比例與 `GLARE_RETAKE` 都用膨脹後遮罩，`glare_max_ratio` 實際比的是「光斑＋外圈」，細碎光斑較早觸發重拍。 | ☐ |
| B5 | [food.py:199](../../ai/src/dietai/preprocess/food.py#L199) | 中心落在較大橢圓內的候選一律捨棄，大盤上的小碟（盤中盤）會漏掉。 | ☐ |
| B6 | [server/workbench.py:116](../../ai/src/dietai/server/workbench.py#L116) | 只要有旋轉或縮放就丟掉整份真值，連與位置無關的 EAN-13 內容也丟。 | ☐ |
| B7 | [quality.py:58](../../ai/src/dietai/preprocess/quality.py#L58) | 短邊小於 `blur_short_side` 的影像先放大再算拉普拉斯，分數偏低，`LOW_RESOLUTION` 常連帶 `TOO_BLURRY`。校準 `blur_min` 時要注意。 | ☐ |
| B8 | [barcode.py:202](../../ai/src/dietai/preprocess/barcode.py#L202) | 只驗 EAN-13 檢查碼，UPC-A／EAN-8 依賴 zxing-cpp 預設不回傳錯誤結果；換解碼器時沒有這層保護。 | ☐ |
| B9 | [stream.go](../../api/internal/workbench/stream.go) `GetE1Run` | 只檢查 `run_id`，`root` 可指向任意本機資料夾，測試集鎖定依賴 Python 端。僅開發工具路由，應屬刻意。 | ☐ |
| B10 | [E1Page.tsx:158](../../workbench/src/pages/E1Page.tsx#L158) | 「改選最新的一次」依賴後端把最新的放在 `runs[0]`，前端不排序；需確認後端有保證此順序。 | ☐ |

## C 違反專案規範

| # | 位置 | 問題 | 依據 | 處理 |
| --- | --- | --- | --- | --- |
| C1 | [food.py](../../ai/src/dietai/preprocess/food.py) 166、168、323 行與 21 行 | 高斯核 5×5、膨脹核 3×3、`_COVERAGE_BINS=36` 寫死在程式內 | `ai/CLAUDE.md`：門檻與參數一律放 config | ☐ |
| C2 | [charts.tsx:293](../../workbench/src/components/charts.tsx#L293) `StackedBars` | `% PALETTE.length` 取色，超過 8 個鍵顏色循環重複 | `workbench/CLAUDE.md`：色盤不循環 | ☐ |
| C3 | [charts.tsx:411](../../workbench/src/components/charts.tsx#L411)、[primitives.tsx:103](../../workbench/src/components/ui/primitives.tsx#L103) | 寫死 `'white'`、`bg-white` | 不寫死色碼、用主題變數 | ☐ |
| C4 | [SweepPage.tsx:552](../../workbench/src/pages/SweepPage.tsx#L552) | 門檻線標籤顯示英文欄位名（如 `blur_min`） | 工作台標籤只寫中文 | ☐ |
| C5 | [QualityPage.tsx](../../workbench/src/pages/QualityPage.tsx) 260 行一帶 | 模糊、過暗、過亮的 `good` 由前端拿數值比門檻得出，只有短邊用後端 `resolution_ok` | 數字與判定由後端決定 | ☐ |
| C6 | [server/preprocess.py:118](../../ai/src/dietai/server/preprocess.py#L118) | `vlm(v: Any, ...)` 應為 `food.VlmImage`，型別檢查失效 | mypy 嚴格型別 | ☐ |

## D 邊界情況與穩健性

### Python

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| D1 | [label.py:327](../../ai/src/dietai/preprocess/label.py#L327) `_locate` | 縮小圖座標換回原圖直接除以倍率，未做半像素修正 `(x+0.5)/f-0.5`；短邊 4000→720 時約偏 2 像素。長邊倍率因四捨五入也略有差異。 | ☐ |
| D2 | [decoders.py:140](../../ai/src/dietai/preprocess/decoders.py#L140) `PyzbarDecoder` | 四角依影像座標排序，與 `DecodeHit` 文件「以條碼本身方向為準」不一致；ZBar 回傳空 polygon 時 `minAreaRect` 丟例外。僅實驗對照用。 | ☐ |
| D3 | [server/preprocess.py](../../ai/src/dietai/server/preprocess.py) | 前處理函式自己丟的 `ValueError`（如 `validate_image`）不在 `to_rpc_error` 對照表，會變成 `INTERNAL`。 | ☐ |
| D4 | [configs.py:96](../../ai/src/dietai/devtools/configs.py#L96) `_field_in` | 以子字串比對欄位名，同時覆寫互為前綴的欄位（`a`、`a_max`）時錯誤可能歸到錯的欄位。 | ☐ |
| D5 | [images.py:55](../../ai/src/dietai/devtools/images.py#L55) `decode_image` | 不限制像素數，極端壓縮影像（decompression bomb）解碼後可能很大；檔案大小已有 gRPC 32 MB 與 Go 端上限把關。 | ☐ |
| D6 | [synthetic/datasets.py:88](../../ai/src/dietai/synthetic/datasets.py#L88) | 雜訊種子 `seed + i`，seed=0 與 seed=1 的兩份資料集雜訊序列部分重疊；需要統計獨立時才有影響。 | ☐ |
| D20 | [rpc.py:184](../../ai/src/dietai/server/rpc.py#L184)、[rpc.py:222](../../ai/src/dietai/server/rpc.py#L222) `stream` | 工作執行緒先 `put("done")`、之後才在 finally `it.close()`；事件迴圈收到 done 時執行緒可能仍存活，正常完成也會先記一筆「已取消（N 筆）」再記 OK。只影響日誌。 | ☐ |
| D21 | `research/experiments/e1_barcode/`：[make_synthetic.py:35](../../research/experiments/e1_barcode/make_synthetic.py#L35)、[analyze.py:53](../../research/experiments/e1_barcode/analyze.py#L53)、[run.py:70](../../research/experiments/e1_barcode/run.py#L70) | `--codes 0`、run.json 損壞或缺 `manifest` 鍵、`run_experiment` 丟 ValueError（欄名衝突、輸出資料夾非空）時印 traceback，而非 `p.error` 的中文訊息。 | ☐ |

### Go

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| D7 | [stream.go:77](../../api/internal/workbench/stream.go#L77) `openStream` | 空串流時依賴 grpc-go 在 EOF 後再次 `Recv()` 仍回 `io.EOF`，`stream_test.go` 沒有涵蓋。建議補測試。 | ☐ |
| D8 | [handler.go:62](../../api/internal/workbench/handler.go#L62)、[stream.go](../../api/internal/workbench/stream.go)、handler.go:258 | SSE 或影像寫到一半失敗（使用者離開）時，200 標頭已送出又呼叫 `writeError`，產生 "superfluous response.WriteHeader" 日誌，JSON 接在已送出內容後；context 未取消時記成 500 錯誤日誌。 | ☐ |
| D9 | [errors.go:84](../../api/internal/workbench/errors.go#L84) | 未預期錯誤把 `err.Error()` 原樣回給前端；開發工具可接受，若路由上線需改。 | ☐ |
| D10 | Go 工作台 JSON 路由 | JSON 本文由產生的程式碼解碼，沒有 `http.MaxBytesReader`，只有 multipart 受 `MaxUploadBytes` 保護。 | ☐ |

### 前端

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| D11 | [FoodPage.tsx:196](../../workbench/src/pages/FoodPage.tsx#L196) | 盤緣步驟關閉時用 `plateTrial.shown`（沿用上次結果），沒比對 `imageId`；換圖後可能把舊影像的橢圓疊到新影像上，違反「影像與結果配對」。 | ☐ |
| D12 | [BarcodePage.tsx:271](../../workbench/src/pages/BarcodePage.tsx#L271) | 「只用原圖」讀數用 `baseline.shown`，同樣沒比對 `imageId`。 | ☐ |
| D13 | [BarcodePage.tsx:139](../../workbench/src/pages/BarcodePage.tsx#L139) | `attempts` 來自 `analysis.shown`，畫面用 `AnalysisFrame` 配對後的 `r`；換圖期間可能不同組，下拉選單 value 可能超出範圍。 | ☐ |
| D14 | [E1Page.tsx:185](../../workbench/src/pages/E1Page.tsx#L185) | 快速執行帶防抖後的資料夾，輸入後 400 ms 內按執行會用舊路徑。 | ☐ |
| D15 | [E1Page.tsx:309](../../workbench/src/pages/E1Page.tsx#L309)、[E1Page.tsx:606](../../workbench/src/pages/E1Page.tsx#L606) | `progress.total` 為 0 時寬度 NaN；`arms` 為空時非空斷言 `!` 掩蓋 undefined。 | ☐ |
| D16 | [sse.ts:90](../../workbench/src/lib/sse.ts#L90)、[sse.ts:92](../../workbench/src/lib/sse.ts#L92) | 串流中途 `event: error` 一律當 500，React Query 會重試（連 `PATH_NOT_FOUND` 也重送）；data 非 JSON 時丟 SyntaxError 而非 `ApiError`。 | ☐ |
| D17 | [useLocalImage.ts:40](../../workbench/src/hooks/useLocalImage.ts#L40) | 讀檔失敗丟一般 `Error`，被 [queryClient.ts:45](../../workbench/src/queryClient.ts#L45) 重試一次。 | ☐ |
| D18 | [ImageViewer.tsx:141](../../workbench/src/components/ImageViewer.tsx#L141) | 只處理 `onPointerUp`，沒有 `onPointerCancel`；觸控被中斷後下次移動可能誤當拖曳。 | ☐ |
| D19 | [dev.mjs:50](../../workbench/scripts/dev.mjs#L50)、[dev.mjs:280](../../workbench/scripts/dev.mjs#L280) | `DATABASE_URL` 主機與埠寫死 `localhost:5432`，另起叢集時連錯資料庫；非 Windows 只對 `go run` 送 SIGTERM，子程序是否一起結束需在 Linux／macOS 實測。 | ☐ |

## E 輕微（風格、使用體驗）

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| E1 | [config.py](../../ai/src/dietai/preprocess/config.py) `bg_border_ratio` | 表單上限 0.3，`__post_init__` 允許到 < 0.5，兩者不一致 | ☐ |
| E2 | [sweep.py:63](../../ai/src/dietai/devtools/sweep.py#L63) | `hi` 超出範圍時錯誤欄位也標為 `"lo"` | ☐ |
| E3 | [evaluation/\_\_init\_\_.py](../../ai/src/dietai/evaluation/__init__.py) | `__all__` 中 `"first_rung"` 未依字母排序 | ☐ |
| E4 | [handler.go:202](../../api/internal/workbench/handler.go#L202) | 註解「登入於階段 5 實作」已過時，登入已實作 | ☐ |
| E5 | [handler.go:296](../../api/internal/workbench/handler.go#L296) | `name` 欄位 `LimitReader(part, 256)` 可能把 UTF-8 中文切在字元中間 | ☐ |
| E6 | [QualityPage.tsx:86](../../workbench/src/pages/QualityPage.tsx#L86) | 原有一行過時、重複的 JSDoc，建議刪除 | ☐ |
| E7 | [ImageSourcePanel.tsx:108](../../workbench/src/components/ImageSourcePanel.tsx#L108) | 徽章顏色計入 seed、數量不計，只改 seed 時呈強調色卻顯示「0 項」 | ☐ |
| E8 | [LadderControls.tsx:143](../../workbench/src/components/LadderControls.tsx#L143)、74 行 | 倍率可全部取消成空陣列（後端是否接受未確認）；「還原順序與倍率」實際也還原採用格式 | ☐ |
| E9 | [ParamForm.tsx:86](../../workbench/src/components/ParamForm.tsx#L86)、[ParamForm.tsx:94](../../workbench/src/components/ParamForm.tsx#L94) | 同頁兩個 `ParamForm` 有同名欄位時 id 重複；說明提示的觸發元素是 SVG，鍵盤無法聚焦 | ☐ |
| E10 | [overlays.tsx:97](../../workbench/src/components/overlays.tsx#L97) | `rotate()` 單位是度，規格 `Ellipse.angle` 未寫單位；建議在 proto 註明 | ☐ |
| E11 | [SweepPage.tsx](../../workbench/src/pages/SweepPage.tsx) 207、333、400、586 行 | 範圍未檢查下限小於上限；條碼模式匯出入不含 `ZxingConfig`、`configError` 只給 Ladder 表單；`find(...)!` 欄位對不上會崩潰；成功階堆疊順序與 E1 頁不一致 | ☐ |
| E12 | [BatchPage.tsx:257](../../workbench/src/pages/BatchPage.tsx#L257)、275 行 | `JSON.stringify` 比參數受鍵順序影響，可能誤報「參數已修改」；讀取失敗的列仍有 pointer 樣式 | ☐ |
| E13 | [BatchPage.tsx:88](../../workbench/src/pages/BatchPage.tsx#L88)、[ConfigIO.tsx:62](../../workbench/src/components/ConfigIO.tsx#L62)、ConfigIO.tsx:109 | `a.click()` 後立刻 `revokeObjectURL`，少數瀏覽器下載失敗；`setTimeout` 卸載時未清除 | ☐ |
| E14 | [primitives.tsx](../../workbench/src/components/ui/primitives.tsx) | Slider 的 `aria-label` 同時標在 Root 與 Thumb；`DraftNumberInput` 的 effect 依賴內聯 `format`，每次渲染都跑 | ☐ |
| E15 | E1 頁條碼數、批次頁最多張數輸入框；[FoodPage.tsx:118](../../workbench/src/pages/FoodPage.tsx#L118)；[E1Page.tsx:552](../../workbench/src/pages/E1Page.tsx#L552)、580 行 | onChange 即夾範圍，清空會立刻變 1；`find(...)!` 欄位缺少時崩潰；不在 `RUNG_ORDER` 的新階被略過；熱度圖欄未排序 | ☐ |
| E16 | [rpc.py:140](../../ai/src/dietai/server/rpc.py#L140) | `_DONE = object()` 全 repo 未使用，是死碼。**已驗證**（grep）。 | ☐ |
