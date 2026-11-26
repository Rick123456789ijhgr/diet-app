# 模組一 code review：疑似問題清單

> 範圍：模組一「影像前處理」的 Python 套件、開發工作台（Go 後端、React 前端、Python `devtools`）與 E1 實驗腳本。
> 產生方式：為人工審查補中文註解時，逐檔閱讀程式並記錄疑點；**本清單只列問題，程式一行都沒改**。
> 行號以加上註解後的檔案為準（與本 PR 合併後的 `main` 一致）。
> 標記「已驗證」者已實際執行或對照程式確認；其餘為閱讀程式後的判斷，請審查者確認。

## 使用方式

- 每項附「建議」，審查時在「處理」欄勾選：修正（開 `fix/` 分支）、維持（寫明理由）、待討論。
- 修正時依專案規則每個 PR 附測試；涉及門檻的項目不得以 test split 調整（根目錄 `CLAUDE.md` 規則 7）。
- 2026-11-26 逐項核對 A–E 節：多數已在後續 PR 中修正（「處理」欄註明現況）；需設計決定的由 Rick 決定，修正見 #95–#97。檔名與行號為清單撰寫時的位置，前端頁面已改名（例如 `SweepPage` → `pages/multi/SweepMode.tsx`）。

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
| A1 | [types.py:105](../../ai/src/dietai/preprocess/types.py#L105) `Box.crop` | 起點截到 0，終點沒截。框整個在影像左方或上方時（如 `x=-10, w=5`，`x1=-5`），切片變成 `img[..., 0:-5]`，回傳一塊錯誤且非空的區域。**已驗證**：`Box(-10, 0, 5, 3)` 對 10×10 影像回傳 3×5。 | 終點也夾到 `[0, 寬/高]`，並補測試 | 已修正（2026-11-26 核對：`Box.crop` 起點終點都夾到影像範圍） |
| A2 | [manifest.py:149-153](../../ai/src/dietai/evaluation/manifest.py#L149-L153) `write_manifest` | 設了 `extrasaction="raise"`，但先用 `{k: row.get(k, "") for k in fieldnames}` 過濾，raise 永遠不會觸發；沒列在 `tag_columns` 的標籤欄被靜默丟掉。**已驗證**（讀程式）。 | 決定要報錯還是丟棄；要報錯就直接傳 `row` | 已修正（2026-11-26 核對：`write_manifest` 開檔前檢查多出的欄位並報錯） |
| A3 | [server/workbench.py:196](../../ai/src/dietai/server/workbench.py#L196) 配合 [store.py:195](../../ai/src/dietai/devtools/store.py#L195) | 條碼掃描縮圖以 `barcode-sweep:...` 為衍生來源鍵，但它不是暫存影像 ID，`_evict` 會清掉 `k[0]` 不在 `_items` 的對應，所以縮圖從不重用，每次掃描新增三張，與程式註解相反。結果正確，只多占暫存區。**已驗證**（讀程式）。 | 另設不受 `_evict` 清除的快取，或改寫註解 | 已修正（2026-11-26 核對：`put_derived(detached=True)`，掃描縮圖不受 `_evict` 清除） |
| A4 | [lib/config.ts:123](../../workbench/src/lib/config.ts#L123) | 匯入 `{"values": null}` 或 `values` 不是物件時，下一步 `Object.entries` 丟 TypeError 而非 `ConfigImportError`，介面顯示不出中文錯誤。 | 檢查型別後丟 `ConfigImportError` | 已修正（2026-11-26 核對：`values` 非物件時丟 `ConfigImportError`） |
| A5 | [lib/config.ts:72](../../workbench/src/lib/config.ts#L72) `pyScalar` | 字串值沒有跳脫 `'` 與 `\`，產生的 Python 建構式語法會錯（目前序列欄位多為 rung 名稱，影響小）。 | 用 `JSON.stringify` 或手動跳脫 | 已修正（2026-11-26 核對：`pyScalar` 跳脫 `\` 與 `'`） |
| A6 | [scripts/dev.mjs:108](../../workbench/scripts/dev.mjs#L108) `ensureNode` | 沒有 `package-lock.json` 時 `statSync(lock)` 丟例外，腳本直接崩潰，不走 `fail()` 的中文訊息。 | 先 `existsSync(lock)` | 已修正（2026-11-26 核對：`lockfileState` 先 `existsSync`，缺檔走 `fail()`） |

## B 需確認設計意圖

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| B1 | [barcode.py:240](../../ai/src/dietai/preprocess/barcode.py#L240) `min_agree` | 票數跨嘗試累計，多尺度同一階的兩個倍率就能湊滿 2 票。若「確認」本意是兩個不同前處理階同意，需改為依階計票。 | 維持：預設 `min_agree=1` 時結果不變；同 F 節，等有 f_a01 以外的照片再一起評估（Rick 決定） |
| B2 | [evaluation/barcode.py:167](../../ai/src/dietai/evaluation/barcode.py#L167) `judge` | 模組 docstring 寫負樣本「有任何結果 → false_positive」，實際只看已達 `min_agree` 的 `hits`；`min_agree > 1` 時零星解碼判為 true_negative。行為或文件擇一修正。 | 已修正（2026-11-26 核對：改文件：模組說明寫明負樣本只看已確認的 `hits`） |
| B3 | [invoice_qr.py:68](../../ai/src/dietai/preprocess/invoice_qr.py#L68) | 左右兩碼只依中心 x 座標區分，照片轉 90°／180° 時會判錯或對調。建議 Go 端解析時以內容再確認（右碼以 `**` 開頭）。 | 修正：Python 端即依 `**` 指定左右，並以此決定階梯何時停止（`fix/ai-preprocess-invoice-qr`） |
| B4 | [label.py:133](../../ai/src/dietai/preprocess/label.py#L133)、[label.py:149](../../ai/src/dietai/preprocess/label.py#L149) | 光斑比例與 `GLARE_RETAKE` 都用膨脹後遮罩，`glare_max_ratio` 實際比的是「光斑＋外圈」，細碎光斑較早觸發重拍。 | 維持並註明：`GlareResult` 寫明比例為擴張後面積，校準 `glare_max_ratio` 時用同樣的擴張半徑（#95，Rick 決定） |
| B5 | [food.py:199](../../ai/src/dietai/preprocess/food.py#L199) | 中心落在較大橢圓內的候選一律捨棄，大盤上的小碟（盤中盤）會漏掉。去重半徑 1 寫死在程式內（同 C1 的性質）；要調整時應改成 `FoodConfig` 參數（批次 3 複查）。 | 修正：#95（去重半徑改為 `FoodConfig.plate_dedup_radius`，預設 1.0 行為不變；盤中盤需調小此值） |
| B6 | [server/workbench.py:116](../../ai/src/dietai/server/workbench.py#L116) | 只要有旋轉或縮放就丟掉整份真值，連與位置無關的 EAN-13 內容也丟。 | 修正：#96（旋轉或縮放時只拿掉 `quad`、`plates`、`plate_boxes`，條碼與發票真值保留） |
| B7 | [quality.py:58](../../ai/src/dietai/preprocess/quality.py#L58) | 短邊小於 `blur_short_side` 的影像先放大再算拉普拉斯，分數偏低，`LOW_RESOLUTION` 常連帶 `TOO_BLURRY`。校準 `blur_min` 時要注意。 | 修正：#95（`LOW_RESOLUTION` 時不判 `TOO_BLURRY`，模糊分數照常回傳） |
| B8 | [barcode.py:202](../../ai/src/dietai/preprocess/barcode.py#L202) | 只驗 EAN-13 檢查碼，UPC-A／EAN-8 依賴 zxing-cpp 預設不回傳錯誤結果；換解碼器時沒有這層保護。 | 維持：用 zxing-cpp 時屬防禦性改動；同 B1，等新照片再評估（Rick 決定） |
| B9 | [stream.go](../../api/internal/workbench/stream.go) `GetE1Run` | 只檢查 `run_id`，`root` 可指向任意本機資料夾，測試集鎖定依賴 Python 端。僅開發工具路由，應屬刻意。 | 維持：開發工具路由刻意不限 root，測試集鎖定由 Python 端負責（Rick 決定） |
| B10 | [E1Page.tsx:158](../../workbench/src/pages/E1Page.tsx#L158) | 「改選最新的一次」依賴後端把最新的放在 `runs[0]`，前端不排序；需確認後端有保證此順序。 | 已修正（2026-11-26 核對：後端 `list_runs` 依名稱（時間戳記開頭）倒序，前端註解已寫明） |

## C 違反專案規範

| # | 位置 | 問題 | 依據 | 處理 |
| --- | --- | --- | --- | --- |
| C1 | [food.py](../../ai/src/dietai/preprocess/food.py) 166、168、323 行與 21 行 | 高斯核 5×5、膨脹核 3×3、`_COVERAGE_BINS=36` 寫死在程式內 | `ai/CLAUDE.md`：門檻與參數一律放 config | 已修正（2026-11-26 核對：核大小與格數改為 `FoodConfig` 參數；同性質的 label.py 常數見 G5） |
| C2 | [charts.tsx:293](../../workbench/src/components/charts.tsx#L293) `StackedBars` | `% PALETTE.length` 取色，超過 8 個鍵顏色循環重複 | `workbench/CLAUDE.md`：色盤不循環 | 已修正（2026-11-26 核對：`foldSeries` 把第 8 個以後的鍵併為「其他」） |
| C3 | [charts.tsx:411](../../workbench/src/components/charts.tsx#L411)、[primitives.tsx:103](../../workbench/src/components/ui/primitives.tsx#L103) | 寫死 `'white'`、`bg-white` | 不寫死色碼、用主題變數 | 已修正（2026-11-26 核對：已無 `'white'`／`bg-white`；架構圖的 `#ffffff` 屬 workbench/CLAUDE.md 的例外） |
| C4 | [SweepPage.tsx:552](../../workbench/src/pages/SweepPage.tsx#L552) | 門檻線標籤顯示英文欄位名（如 `blur_min`） | 工作台標籤只寫中文 | 已修正（2026-11-26 核對：門檻線標籤用 schema 的中文名稱（頁面改為 `pages/multi/SweepMode.tsx`）） |
| C5 | [QualityPage.tsx](../../workbench/src/pages/QualityPage.tsx) 260 行一帶 | 模糊、過暗、過亮的 `good` 由前端拿數值比門檻得出，只有短邊用後端 `resolution_ok` | 數字與判定由後端決定 | 已修正（2026-11-26 核對：`good` 一律取後端判定（頁面改為 `pages/inspect/QualityTask.tsx`）） |
| C6 | [server/preprocess.py:118](../../ai/src/dietai/server/preprocess.py#L118) | `vlm(v: Any, ...)` 應為 `food.VlmImage`，型別檢查失效 | mypy 嚴格型別 | 已修正（2026-11-26 核對：`vlm(v: VlmImage, ...)`） |

## D 邊界情況與穩健性

### Python

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| D1 | [label.py:327](../../ai/src/dietai/preprocess/label.py#L327) `_locate` | 縮小圖座標換回原圖直接除以倍率，未做半像素修正 `(x+0.5)/f-0.5`；短邊 4000→720 時約偏 2 像素。長邊倍率因四捨五入也略有差異。 | 已修正（2026-11-26 核對：`_quad_to_original` 做半像素修正並依各軸倍率） |
| D2 | [decoders.py:140](../../ai/src/dietai/preprocess/decoders.py#L140) `PyzbarDecoder` | 四角依影像座標排序，與 `DecodeHit` 文件「以條碼本身方向為準」不一致；ZBar 回傳空 polygon 時 `minAreaRect` 丟例外。僅實驗對照用。 | 已修正（2026-11-26 核對：空 polygon 改用 `rect`；四角依 orientation 輪轉） |
| D3 | [server/preprocess.py](../../ai/src/dietai/server/preprocess.py) | 前處理函式自己丟的 `ValueError`（如 `validate_image`）不在 `to_rpc_error` 對照表，會變成 `INTERNAL`。 | 已修正（2026-11-26 核對：`InvalidImageError` 對應 `INVALID_ARGUMENT`） |
| D4 | [configs.py:96](../../ai/src/dietai/devtools/configs.py#L96) `_field_in` | 以子字串比對欄位名，同時覆寫互為前綴的欄位（`a`、`a_max`）時錯誤可能歸到錯的欄位。 | 已修正（2026-11-26 核對：`_field_in` 以完整識別字比對） |
| D5 | [images.py:55](../../ai/src/dietai/devtools/images.py#L55) `decode_image` | 不限制像素數，極端壓縮影像（decompression bomb）解碼後可能很大；檔案大小已有 gRPC 32 MB 與 Go 端上限把關。 | 已修正（2026-11-26 核對：`MAX_DECODE_PIXELS` 與 `OPENCV_IO_MAX_IMAGE_PIXELS`） |
| D6 | [synthetic/datasets.py:88](../../ai/src/dietai/synthetic/datasets.py#L88) | 雜訊種子 `seed + i`，seed=0 與 seed=1 的兩份資料集雜訊序列部分重疊；需要統計獨立時才有影響。 | 修正：#96（逐項種子改為 `item_seed(seed, i)`；會改變合成資料集影像，`manifest.json` 記 `seed_scheme`） |
| D20 | [rpc.py:184](../../ai/src/dietai/server/rpc.py#L184)、[rpc.py:222](../../ai/src/dietai/server/rpc.py#L222) `stream` | 工作執行緒先 `put("done")`、之後才在 finally `it.close()`；事件迴圈收到 done 時執行緒可能仍存活，正常完成也會先記一筆「已取消（N 筆）」再記 OK。只影響日誌。 | 已修正（2026-11-26 核對：`ended` 旗標，正常結束只記 OK） |
| D21 | `research/experiments/e1_barcode/`：[make_synthetic.py:35](../../research/experiments/e1_barcode/make_synthetic.py#L35)、[analyze.py:53](../../research/experiments/e1_barcode/analyze.py#L53)、[run.py:70](../../research/experiments/e1_barcode/run.py#L70) | `--codes 0`、run.json 損壞或缺 `manifest` 鍵、`run_experiment` 丟 ValueError（欄名衝突、輸出資料夾非空）時印 traceback，而非 `p.error` 的中文訊息。 | 已修正（2026-11-26 核對：三個腳本的 ValueError／OSError 等交給 `p.error`） |

### Go

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| D7 | [stream.go:77](../../api/internal/workbench/stream.go#L77) `openStream` | 空串流時依賴 grpc-go 在 EOF 後再次 `Recv()` 仍回 `io.EOF`，`stream_test.go` 沒有涵蓋。建議補測試。 | 已修正（2026-11-26 核對：EOF 後不再 `Recv`，`TestOpenStreamEmptyDoesNotRecvAfterEOF`） |
| D8 | [handler.go:62](../../api/internal/workbench/handler.go#L62)、[stream.go](../../api/internal/workbench/stream.go)、handler.go:258 | SSE 或影像寫到一半失敗（使用者離開）時，200 標頭已送出又呼叫 `writeError`，產生 "superfluous response.WriteHeader" 日誌，JSON 接在已送出內容後；context 未取消時記成 500 錯誤日誌。 | 已修正（2026-11-26 核對：`trackingWriter`／`headerSent`，標頭已送出時只記日誌） |
| D9 | [errors.go:84](../../api/internal/workbench/errors.go#L84) | 未預期錯誤把 `err.Error()` 原樣回給前端；開發工具可接受，若路由上線需改。 | 維持：開發工具方便除錯；若路由上線再改成固定訊息加 request_id（Rick 決定） |
| D10 | Go 工作台 JSON 路由 | JSON 本文由產生的程式碼解碼，沒有 `http.MaxBytesReader`，只有 multipart 受 `MaxUploadBytes` 保護。 | 已修正（2026-11-26 核對：手寫包裝層以 `http.MaxBytesReader` 限制本文，超過回 413） |

### 前端

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| D11 | [FoodPage.tsx:196](../../workbench/src/pages/FoodPage.tsx#L196) | 盤緣步驟關閉時用 `plateTrial.shown`（沿用上次結果），沒比對 `imageId`；換圖後可能把舊影像的橢圓疊到新影像上，違反「影像與結果配對」。 | 已修正（2026-11-26 核對：比對 `imageId`（頁面改為 `pages/inspect/FoodTask.tsx`）） |
| D12 | [BarcodePage.tsx:271](../../workbench/src/pages/BarcodePage.tsx#L271) | 「只用原圖」讀數用 `baseline.shown`，同樣沒比對 `imageId`。 | 已修正（2026-11-26 核對：比對 `imageId`（`pages/inspect/BarcodeTask.tsx`）） |
| D13 | [BarcodePage.tsx:139](../../workbench/src/pages/BarcodePage.tsx#L139) | `attempts` 來自 `analysis.shown`，畫面用 `AnalysisFrame` 配對後的 `r`；換圖期間可能不同組，下拉選單 value 可能超出範圍。 | 已修正（2026-11-26 核對：`usePairedResult` 配對，選取值夾在範圍內） |
| D14 | [E1Page.tsx:185](../../workbench/src/pages/E1Page.tsx#L185) | 快速執行帶防抖後的資料夾，輸入後 400 ms 內按執行會用舊路徑。 | 已修正（2026-11-26 核對：快速執行帶輸入框目前的路徑（`pages/results/E1Results.tsx`）） |
| D15 | [E1Page.tsx:309](../../workbench/src/pages/E1Page.tsx#L309)、[E1Page.tsx:606](../../workbench/src/pages/E1Page.tsx#L606) | `progress.total` 為 0 時寬度 NaN；`arms` 為空時非空斷言 `!` 掩蓋 undefined。 | 已修正（2026-11-26 核對：`progressPercent`；已移除非空斷言） |
| D16 | [sse.ts:90](../../workbench/src/lib/sse.ts#L90)、[sse.ts:92](../../workbench/src/lib/sse.ts#L92) | 串流中途 `event: error` 一律當 500，React Query 會重試（連 `PATH_NOT_FOUND` 也重送）；data 非 JSON 時丟 SyntaxError 而非 `ApiError`。 | 已修正（2026-11-26 核對：非 JSON 丟 `ApiError`；`streamErrorStatus` 依代碼還原狀態） |
| D17 | [useLocalImage.ts:40](../../workbench/src/hooks/useLocalImage.ts#L40) | 讀檔失敗丟一般 `Error`，被 [queryClient.ts:45](../../workbench/src/queryClient.ts#L45) 重試一次。 | 已修正（2026-11-26 核對：讀檔失敗丟 422 `ApiError`，4xx 不重試） |
| D18 | [ImageViewer.tsx:141](../../workbench/src/components/ImageViewer.tsx#L141) | 只處理 `onPointerUp`，沒有 `onPointerCancel`；觸控被中斷後下次移動可能誤當拖曳。 | 已修正（2026-11-26 核對：已有 `onPointerCancel`） |
| D19 | [dev.mjs:50](../../workbench/scripts/dev.mjs#L50)、[dev.mjs:280](../../workbench/scripts/dev.mjs#L280) | `DATABASE_URL` 主機與埠寫死 `localhost:5432`，另起叢集時連錯資料庫；非 Windows 只對 `go run` 送 SIGTERM，子程序是否一起結束需在 Linux／macOS 實測。 | 部分修正：`DATABASE_URL` 改讀 `PGHOST`／`PGPORT`；非 Windows 停止時子程序是否留下仍待 Linux／macOS 實測，維持（Rick 決定） |

## E 輕微（風格、使用體驗）

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| E1 | [config.py](../../ai/src/dietai/preprocess/config.py) `bg_border_ratio` | 表單上限 0.3，`__post_init__` 允許到 < 0.5，兩者不一致 | 已修正（2026-11-26 核對：表單上限 0.495，與驗證一致） |
| E2 | [sweep.py:63](../../ai/src/dietai/devtools/sweep.py#L63) | `hi` 超出範圍時錯誤欄位也標為 `"lo"` | 已修正（2026-11-26 核對：只有 hi 超出時標 hi） |
| E3 | [evaluation/\_\_init\_\_.py](../../ai/src/dietai/evaluation/__init__.py) | `__all__` 中 `"first_rung"` 未依字母排序 | 已修正（2026-11-26 核對：`__all__` 已排序） |
| E4 | [handler.go:202](../../api/internal/workbench/handler.go#L202) | 註解「登入於階段 5 實作」已過時，登入已實作 | 已修正（2026-11-26 核對：過時註解已移除） |
| E5 | [handler.go:296](../../api/internal/workbench/handler.go#L296) | `name` 欄位 `LimitReader(part, 256)` 可能把 UTF-8 中文切在字元中間 | 已修正（2026-11-26 核對：`truncateUTF8` 去掉不完整的字元） |
| E6 | [QualityPage.tsx:86](../../workbench/src/pages/QualityPage.tsx#L86) | 原有一行過時、重複的 JSDoc，建議刪除 | 已修正（2026-11-26 核對：已無過時 JSDoc） |
| E7 | [ImageSourcePanel.tsx:108](../../workbench/src/components/ImageSourcePanel.tsx#L108) | 徽章顏色計入 seed、數量不計，只改 seed 時呈強調色卻顯示「0 項」 | 已不適用：徽章已移除，退化改由 `DegradationPicker` 管理，seed 不計入 |
| E8 | [LadderControls.tsx:143](../../workbench/src/components/LadderControls.tsx#L143)、74 行 | 倍率可全部取消成空陣列（後端是否接受未確認）；「還原順序與倍率」實際也還原採用格式 | 已修正（2026-11-26 核對：倍率、角度 `minSelected={1}`；還原按鈕文字與行為一致） |
| E9 | [ParamForm.tsx:86](../../workbench/src/components/ParamForm.tsx#L86)、[ParamForm.tsx:94](../../workbench/src/components/ParamForm.tsx#L94) | 同頁兩個 `ParamForm` 有同名欄位時 id 重複；說明提示的觸發元素是 SVG，鍵盤無法聚焦 | 已修正（2026-11-26 核對：欄位 id 加 `useId` 前綴；`InfoTip` 改為 `<button>`） |
| E10 | [overlays.tsx:97](../../workbench/src/components/overlays.tsx#L97) | `rotate()` 單位是度，規格 `Ellipse.angle` 未寫單位；建議在 proto 註明 | 修正：#97（proto 補 `Ellipse.angle` 單位註解，Rick 同意；前端與 Python 端已註明） |
| E11 | [SweepPage.tsx](../../workbench/src/pages/SweepPage.tsx) 207、333、400、586 行 | 範圍未檢查下限小於上限；條碼模式匯出入不含 `ZxingConfig`、`configError` 只給 Ladder 表單；`find(...)!` 欄位對不上會崩潰；成功階堆疊順序與 E1 頁不一致 | 已修正（2026-11-26 核對：範圍檢查、匯出入含 `ZxingConfig`、各表單 `configError`、依 `RUNG_ORDER` 排序） |
| E12 | [BatchPage.tsx:257](../../workbench/src/pages/BatchPage.tsx#L257)、275 行 | `JSON.stringify` 比參數受鍵順序影響，可能誤報「參數已修改」；讀取失敗的列仍有 pointer 樣式 | 已修正（2026-11-26 核對：`sameOverrides` 比較；只有讀取成功的列有 pointer（頁面改為 `pages/multi/FolderMode.tsx`）） |
| E13 | [BatchPage.tsx:88](../../workbench/src/pages/BatchPage.tsx#L88)、[ConfigIO.tsx:62](../../workbench/src/components/ConfigIO.tsx#L62)、ConfigIO.tsx:109 | `a.click()` 後立刻 `revokeObjectURL`，少數瀏覽器下載失敗；`setTimeout` 卸載時未清除 | 已修正（2026-11-26 核對：延遲 `REVOKE_DELAY_MS` 才 revoke；卸載時清計時器） |
| E14 | [primitives.tsx](../../workbench/src/components/ui/primitives.tsx) | Slider 的 `aria-label` 同時標在 Root 與 Thumb；`DraftNumberInput` 的 effect 依賴內聯 `format`，每次渲染都跑 | 已修正（2026-11-26 核對：`aria-label` 只標 Thumb；effect 依賴格式化字串） |
| E15 | E1 頁條碼數、批次頁最多張數輸入框；[FoodPage.tsx:118](../../workbench/src/pages/FoodPage.tsx#L118)；[E1Page.tsx:552](../../workbench/src/pages/E1Page.tsx#L552)、580 行 | onChange 即夾範圍，清空會立刻變 1；`find(...)!` 欄位缺少時崩潰；不在 `RUNG_ORDER` 的新階被略過；熱度圖欄未排序 | 已修正（2026-11-26 核對：`DraftNumberInput`＋`parseClampedInt`、`orderRungs`、`naturalSort`） |
| E16 | [rpc.py:140](../../ai/src/dietai/server/rpc.py#L140) | `_DONE = object()` 全 repo 未使用，是死碼。**已驗證**（grep）。 | 已修正（2026-11-26 核對：`_DONE` 已移除） |

## F 程式複查批次 1 追加（2026-11-25，`/code-review`）

範圍：`preprocess/` 的 `barcode.py`、`decoders.py`、`ops.py`、`types.py`、`invoice_qr.py`。與上方重複的項目只標註對應編號。

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| F1 | [invoice_qr.py](../../ai/src/dietai/preprocess/invoice_qr.py) | 累積到任兩個 QR 就停，背景 QR 會讓階梯在讀到右碼前停下 | 修正：#79（同時有非 `**` 與 `**` 的 QR 才停） |
| F2 | [invoice_qr.py](../../ai/src/dietai/preprocess/invoice_qr.py) | 同 B3（左右只依位置） | 修正：#79 |
| F3 | [barcode.py](../../ai/src/dietai/preprocess/barcode.py) `_rectified` | 偵測器回傳重合或共線的框時除以 0，整條階梯丟例外 | 修正：`fix/ai-preprocess-locate`（略過退化框） |
| F4 | [barcode.py](../../ai/src/dietai/preprocess/barcode.py) `_rectified` | `warpAffine` 不支援 `INTER_AREA`（會靜默改用雙線性），縮小寬裁切時沒有面積平均 | 維持：見下方實測 |
| F5 | [barcode.py](../../ai/src/dietai/preprocess/barcode.py) `_rectified` | 一律以長邊為條碼的寬；比寬還高的條碼轉正後條紋為水平 | 維持：見下方實測；dev 中沒有這類條碼 |
| F6 | [barcode.py](../../ai/src/dietai/preprocess/barcode.py) `_located` | 拼接時只有上下留白，一維條碼需要的左右安靜區沒有補 | 維持：見下方實測 |
| F7 | [barcode.py](../../ai/src/dietai/preprocess/barcode.py) `_LOCATE_GAP` | 留白寫死在模組常數，違反「參數一律放 config」 | 修正：`fix/ai-preprocess-locate`（`LadderConfig.locate_gap`，預設 20） |
| F8 | [barcode.py](../../ai/src/dietai/preprocess/barcode.py) `_pipeline` | 流程中有兩個 `rotate` 或 `multiscale` 時，`params` 只記最後一個值 | 修正：#81（multiscale、rotate 各限一步） |
| F9 | [barcode.py](../../ai/src/dietai/preprocess/barcode.py) `decode_with_ladder` | `hits` 沒有去除重複，同一條碼可能回傳兩次 | 修正：#81（依格式＋內容去重） |

**F4–F6 的實測（f_a01 dev 250 張，實驗組 `locate_on`，run 20261115-002314 的方法與順序）**：

| 版本 | 讀對 | 誤讀 | 讀不到 |
| --- | --- | --- | --- |
| main | 225 | 0 | 25 |
| F4＋F5＋F6 全部修正 | 225 | 2 | 23 |
| 全部修正，同一次嘗試讀出多個不同條碼時不採用 | 226 | 1 | 23 |

- 誤讀不是單一修正造成的（逐項還原後仍在）：解碼器在臨界的裁切上偶爾讀出前幾碼錯、剛好通過檢查碼的結果。main 本來就有（`raw` 4 次、`locate:1.15+clahe` 3 次），225/0 的順序是在同一批照片上選出、剛好避開；裁切像素一改，臨界照片就重新洗牌。
- 修正在理論上正確，但讀對持平、誤讀增加，因此暫不採用。有新的照片（非 f_a01）可驗證時再評估；屆時一併考慮「多重結果不採用」與 `min_agree`（見 B1）。

## G 程式複查批次 2 追加（2026-11-25，`/code-review`）

範圍：`preprocess/` 的 `label.py`、`quality.py`、`features.py`、`adaptive.py`。與上方重複的兩項：`label.py` 光斑比例用膨脹後遮罩（同 B4）、`quality.py` 小圖先放大再算模糊（同 B7），處理方式仍待討論，此處不另編號。

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| G1 | [adaptive.py](../../ai/src/dietai/preprocess/adaptive.py) `from_dict` | `start`、`fallback`、`methods` 寫成字串時被拆成逐字元（`"raw"` → `('r','a','w')`），載入不報錯、評估時比對不到任何方法。**已驗證**。 | 修正：#82 |
| G2 | [adaptive.py](../../ai/src/dietai/preprocess/adaptive.py) `from_dict` | 只有 `rules` 那段在 try 內；`max_attempts: null`、最外層是陣列時丟 TypeError／AttributeError，而非文件寫的 ValueError。**已驗證**。 | 修正：#82 |
| G3 | [adaptive.py](../../ai/src/dietai/preprocess/adaptive.py) `Rule` | 門檻不擋 NaN／inf；`json` 讀得進 `NaN`，規則永遠不成立且無提示 | 修正：#82 |
| G4 | [features.py](../../ai/src/dietai/preprocess/features.py) `measure_features` | 曝光三項在縮小影像上算，`check_quality` 在原解析度上算；細小反光被平均掉，兩邊數字不同。**已驗證**（每 8 列一條白線：舊版 0.0、應為 0.125）。 | 修正：#83（改在原解析度上算） |
| G5 | [features.py](../../ai/src/dietai/preprocess/features.py) 模組常數、[label.py](../../ai/src/dietai/preprocess/label.py) `_edges`、`_MIN_COLLINEAR_PX` | `IMPULSE_DIFF`、`BACKGROUND_*`、`GLARE_LEVEL`、`GLARE_MIN_AREA`、5×5 高斯核、3×3 膨脹核、共線容差寫死在程式內（同 C1 的性質） | 修正：features 的 5 個常數改為 `QualityConfig.feature_*`；label 的邊緣平滑核、膨脹核與共線下限改為 `LabelConfig.edge_blur_ksize`、`edge_dilate_ksize`、`hough_min_collinear_px`。預設值不變，24 組合成影像輸出逐項相同（Rick 決定） |
| G6 | [features.py](../../ai/src/dietai/preprocess/features.py) `QualityFeatures` | 沒有 `steps`、`warnings`，與其他前處理入口的回傳格式不一致，量測用的常數沒有紀錄 | 維持並註明：給自適應規則引用的數值向量，警告由 `check_quality` 負責；量測參數已在 `QualityConfig.feature_*`（Rick 決定） |

## H 程式複查批次 3 追加（2026-11-25，`/code-review`）

範圍：`preprocess/` 的 `food.py`、`config.py`。food.py 盤緣去重半徑寫死（同 B5、C1）已補註在 B5，不另編號。

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| H1 | [config.py](../../ai/src/dietai/preprocess/config.py) 各設定類別 `__post_init__` | 單邊檢查（`x <= 0`）擋不住 NaN／inf，`json.loads` 讀得進 `NaN`、`Infinity`；例如 `bg_distance=NaN` 時遮罩全空，只看到 `DISH_NOT_FOUND`。**已驗證**：照收的欄位 QualityConfig 1、LabelConfig 2、LadderConfig 6、FoodConfig 2。 | 修正：#85（`check_finite`） |
| H2 | [config.py](../../ai/src/dietai/preprocess/config.py) `FoodConfig` | `morph_px`、`bg_blur_ksize`、`plate_blur_ksize`、`plate_dilate_ksize` 沒有上限，`morph_px=1000000` 到 OpenCV 才記憶體不足。**已驗證**。 | 修正：#85（上限同表單 max） |
| H3 | [config.py](../../ai/src/dietai/preprocess/config.py) `FoodConfig` | 驗證與表單下限不一致：`plate_canny_high` 可為 0、`detect_short_side`／`vlm_max_side` 只要 > 0（同 E1 的性質） | 修正：#85 |
| H4 | [food.py](../../ai/src/dietai/preprocess/food.py) `detect_plate_ellipse` | 橢圓中心換回原圖沒做半像素修正（同 D1 的性質）。**已驗證**：4000×3000 合成場景盤心平均偏 (−1.46, −2.50) 像素。 | 修正：#86（修正後 (−0.09, −0.07)） |
| H5 | [food.py](../../ai/src/dietai/preprocess/food.py) `_detect_scale` | 只回傳短邊倍率，長邊經四捨五入後實際倍率略有不同 | 修正：#86（各軸實際倍率） |
| H6 | [food.py](../../ai/src/dietai/preprocess/food.py) `preprocess_food` | 盤緣步驟沒記 `detect_short_side`，只開盤緣時無從重現 | 修正：#86 |
| H7 | [config.py](../../ai/src/dietai/preprocess/config.py) `LabelConfig` | `glare_dilate_px`、`inpaint_radius`、`hough_max_gap` 等與核大小相關的欄位也沒有上限（同 H2 的性質，#85 未改） | 修正：`LabelConfig` 與核、影像大小有關的 8 個欄位加上限，同表單 max（Rick 決定） |

## I 程式複查批次 4 追加（2026-11-26，`/code-review`）

範圍：`evaluation/` 的 `barcode.py`、`invoice.py`、`label.py`、`stats.py`、`glmm.py`、`methods.py`。與上方重複的一項：`judge` 負樣本只看已確認結果（同 B2），不另編號。`stats.py` 未發現問題。

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| I1 | [methods.py](../../ai/src/dietai/evaluation/methods.py) `_hits`、[barcode.py](../../ai/src/dietai/evaluation/barcode.py) `is_ambiguous` | `decoded`／`formats` 以 `\|` 串接再拆開；QR、Code128 內容含 `\|` 時 `zip(strict=True)` 丟 ValueError，離線模擬與報告全部中斷，`is_ambiguous` 也會拿片段比真值 | 修正：#87（`join_values`／`split_values` 跳脫；一般條碼寫出結果不變） |
| I2 | [methods.py](../../ai/src/dietai/evaluation/methods.py) `methods_report_markdown` | `orders` 套到每一組；用到某組沒有的方法時丟 ValueError，整份報告失敗 | 修正：#88（該組略過並註記） |
| I3 | [methods.py](../../ai/src/dietai/evaluation/methods.py) `methods_report_markdown` | 某組變體全部 error 時 `greedy_ladder` 丟錯，整份報告失敗 | 修正：#88（該組註記） |
| I4 | [barcode.py](../../ai/src/dietai/evaluation/barcode.py) `load_arms` | `only` 重複（`--only a,a`）時同一組跑兩次，n 與答對數加倍；docstring 寫會報錯 | 修正：#88 |
| I5 | [invoice.py](../../ai/src/dietai/evaluation/invoice.py) `_attempt_row`／`_found` | 空內容的 QR 寫成 `decoded=""`；即時判 `false_positive`，離線判 `true_negative` | 修正：#87（個數以 `areas` 為準） |
| I6 | [invoice.py](../../ai/src/dietai/evaluation/invoice.py) `_attempt_row` | 面積四捨五入到 0.1，相近的左碼候選同值，離線挑出的配對可能與即時不同 | 修正：#87（完整精度） |
| I7 | [barcode.py](../../ai/src/dietai/evaluation/barcode.py) `compare_by_source`、invoice.py、glmm.py、label_run.py | 缺 `source_id` 時以 `id` 當集群，可能與其他列的 `source_id` 撞名而併群，影響 bootstrap、p 值與 GLMM | 修正：#89（`cluster_key`，退路為 `id:<id>`） |
| I8 | [label.py](../../ai/src/dietai/evaluation/label.py) `LabelTruth.from_dict` | `columns` 含空字串時，該營養欄被當成表頭對到第 1 欄 | 修正：#89（拒絕） |
| I9 | [label.py](../../ai/src/dietai/evaluation/label.py) `LabelTruth.from_dict` | `header`／`facts` 為 `null` 或串列時丟裸 TypeError，錯誤訊息沒有檔名 | 修正：#89（改丟 ValueError） |
| I10 | [barcode.py](../../ai/src/dietai/evaluation/barcode.py) `_natural` | 標籤值 `nan`／`inf` 當數字排序，NaN 比較恆為 False，分組順序不定 | 修正：#88（非有限值當文字） |

## J 程式複查批次 5 追加（2026-11-26，`/code-review`）

範圍：`evaluation/` 的 `splits.py`、`manifest.py`、`image_names.py`、`best_flow.py`、`adaptive.py`、`label_run.py`、`__init__.py`，與 `synthetic/` 全部。上方已列的 A2（`write_manifest`）、E3（`__all__` 排序）不另編號。模組一程式複查五批至此完成。

| # | 位置 | 問題 | 處理 |
| --- | --- | --- | --- |
| J1 | [variants.py](../../ai/src/dietai/synthetic/variants.py) `write_variant_dataset` | 資料夾名稱只換掉 `/`、`\`；原圖代碼為 `D:/photos/a.jpg`（沒有 id 欄時）會清理成 `D:_photos_a.jpg`，在 Windows 被當成 D 槽相對路徑，影像寫到 `out_dir` 外，路徑也失去 `splits/test`。**已驗證**。 | 修正：#91（只留文字、數字與 `_ . -`，並確認落在 `splits/<split>/` 下） |
| J2 | [variants.py](../../ai/src/dietai/synthetic/variants.py) `write_variant_dataset` | `f/001` 與 `f_001` 清理後同名，後寫的蓋掉先寫的影像，兩組真值指向同一批 PNG | 修正：#91（撞名時報錯） |
| J3 | [splits.py](../../ai/src/dietai/evaluation/splits.py) `select_sources` | 以 `csv.DictReader` 重讀來源檔，只擋 `split=test`、不擋路徑在 `splits/test` 的影像；欄名有空白時 KeyError（違反「讀 manifest 一律經 read_manifest」） | 修正：#92（由 `read_manifest` 結果寫出） |
| J4 | [adaptive.py](../../ai/src/dietai/evaluation/adaptive.py) `simulate_adaptive`、`adaptive_report_markdown` | 有一張讀檔失敗的影像就丟「沒有品質量測值」，整份自適應報告產不出來 | 修正：#93（記為 error） |
| J5 | [splits.py](../../ai/src/dietai/evaluation/splits.py) `apply_split` | `split_moves.csv` 存相對路徑，在別的目錄執行 `undo_split` 全部還原失敗 | 修正：#92（寫絕對路徑） |
| J6 | [best_flow.py](../../ai/src/dietai/evaluation/best_flow.py) `infer_truth` | 只接受 EAN-13 檢查碼，EAN-8 永遠進不了 `auto`；命名規則的 `valid_code` 接受 EAN-8 | 修正：#93（改用 `valid_code`，Rick 決定 EAN-8 也要） |
| J7 | [adaptive.py](../../ai/src/dietai/evaluation/adaptive.py) `measure_manifest` | 讀檔失敗的影像不回報進度，最後一張失敗時停在 n−1/n | 修正：#93 |
| J8 | [variants.py](../../ai/src/dietai/synthetic/variants.py) `write_variant_dataset` | `conditions` 名稱重複時寫出 id 重複的 manifest，讀不回來且資料夾已非空 | 修正：#91 |
