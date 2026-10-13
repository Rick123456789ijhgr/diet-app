# 開發工作台（Workbench）

以視覺化介面測試各模組、調整參數、執行測試。只在本機使用（綁定 `localhost`）。

## 啟動

三種方式擇一：

- **雙擊**根目錄的 `啟動工作台.bat`（Windows）。首次執行會自動建立 `ai/.venv` 並安裝套件；已在執行時只開啟瀏覽器；關閉黑色視窗即停止。
- 根目錄執行 `make setup`（只需一次）後 `make workbench`。
- 手動：

  ```bash
  cd ai
  pip install -e ".[dev,vision,workbench]"
  streamlit run workbench/streamlit_app.py --server.headless false
  ```

瀏覽器會開啟 <http://localhost:8501>。修改 `dietai` 或工作台程式後存檔，頁面會自動重新載入。

## 版面

```
┌────┬──────────────────────────────────────────────────────────┐
│ 總覽 │ 模組一 影像前處理 ( 品質檢查 | 條碼 | … | 參數掃描 | 批次 )   │ ← 頂部膠囊：目前模組的頁面
│模組一│ 標題 Phase N 一句說明                         [頁面選項] │
│模組二│ ┌ 控制面板（可捲動）─┐ ┌ 結果（可捲動）─────────────────┐ │
│ …  │ │ 影像｜參數｜匯出入 │ │ 狀態列 → 指標列 → 檢視切換與影像 │ │
│ 測試 │ └──────────────┘ └──────────────────────────┘ │
│ ☀/☾ │                                                          │
└────┴──────────────────────────────────────────────────────────┘
  ↑ 左側直欄：研究模組（尚未實作的模組顯示為停用）
```

- **左側直欄**切換研究模組；**頂部膠囊**切換模組內的頁面（各 Phase 在前、輔助工具在後）。
- 工具頁的**控制面板**與**結果**並排、高度固定在一個畫面內並各自捲動：調參數時結果一直在旁邊，不必捲動整頁。
  參數在面板的「參數」分頁，以兩欄排列；匯入／匯出在「匯出入」分頁。
- 結果區的次要資訊（步驟紀錄、明細表）放在檢視切換中，而不是堆在影像下方。
- 頁面與模組的註冊表在 `wb/nav.py`：新頁面在對應模組的 `tools` 加一筆；新模組開始實作時填入 `tools` 與 `phases`，
  左側直欄、頂部膠囊、總覽頁都會自動更新。

## 頁面

| 頁面 | 用途 |
| --- | --- |
| 總覽 | 各模組的 Phase 進度與頁面入口、使用規則、待校準門檻（由 `param(calibrate=True)` 自動列出） |
| 品質檢查 | 左欄選影像並疊加模擬退化，右欄依序顯示判定、四項指標、檢視（原圖／邊緣響應／曝光遮罩／直方圖）與步驟紀錄 |
| 條碼 | 商品條碼／電子發票 QR 兩種模式；調整階梯順序與多尺度倍率、切換 zxing-cpp／pyzbar，顯示成功於哪一階、與「只用原圖」比較、各階送進解碼器的影像與耗時 |
| 營養標示 | 合成標示可調透視強度；顯示找到的四角與真實四角（含逐角誤差）、定位方法（輪廓法／直線法）、Canny 邊緣、光斑遮罩、處理後輸出與步驟紀錄 |
| 食物照片 | 合成餐桌可調盤數與俯拍傾斜；顯示切出的框與真實盤子比較、前景遮罩、盤緣橢圓、各道菜裁切、VLM 實際收到的 JPEG 與不同長邊的檔案大小試算 |
| 參數掃描 | 一種退化由弱到強。「品質檢查」列出每種警告在哪個等級首次觸發；「條碼解碼」以多個合成 EAN-13 比較只用原圖與逐步升級的成功率曲線，並統計成功於哪一階 |
| 資料夾批次 | 整個資料夾的通過率、分數分布、警告次數；點選表格列可檢視單張影像的遮罩 |
| E1 條碼消融 |（Phase 5）檢視 `research/experiments/e1_barcode/runs` 的結果：整體成功率與 95% CI、依拍攝條件的熱度圖、成功於哪一階、失敗影像與每階嘗試；可用合成資料快速執行 |
| 測試與檢查 | 執行 pytest（可選範圍、`-k`、slow）、ruff、mypy；保留最近 10 次結果 |

「參數」分頁依設定欄位的 `group` 分組（例如「模糊／曝光／解析度」），標示已修改的欄位數；
:orange[◆] 為待校準欄位，英文名稱與說明在 ⓘ 提示中。與預設值不同的欄位會同步到網址參數，
重新整理或把網址分享給組員都能重現同一組設定。

## 外觀

- 風格為科技簡約：灰色畫布上的白色圓角卡片、左側直欄與膠囊式頂部導覽，主色靛藍、輔色紫，不使用綠與橘
  （語意色：成功＝青、警告＝黃、錯誤＝玫瑰紅）。
- 主題設定在 `.streamlit/config.toml`：`[theme]` 為共用字型與圓角，`[theme.light]`／`[theme.dark]` 為兩組配色。
  要調整顏色先改這個檔案。
- config 做不到的版面效果（左側直欄、頂部膠囊、畫布與卡片分層、固定高度的工作區、緊湊的指標卡、中文字型）集中在 `wb/st_style.py`，
  頁面本身不注入 CSS。卡片一律用 `wb.st_layout.card()`，不要直接寫 `st.container(border=True)`。
- 深色模式開關（`wb/st_theme.py`，左側直欄底部的太陽／月亮）寫入 Streamlit 原生的主題偏好後重新載入頁面，
  與右上角選單 ⋮ → Settings 的切換結果一致。它依賴 Streamlit 前端的 localStorage 鍵名，
  升級 Streamlit 時請在兩種模式下各開一次確認。
- 版面元件放在 `wb/st_layout.py`（`workspace` 雙欄工作區、`panel_tabs`、`page_header`、`status_line`、`metric_row`、`card`），新頁面請沿用以保持一致。

## 規則

- **只呼叫 `dietai`**：工作台不得複製處理邏輯。視覺化需要的中間結果（如 `quality.laplacian_map`）應加到 `dietai` 成為公開函式並寫測試。
- **測試集鎖定**：`wb.images.guard_path` 會拒絕任何含 `splits/test` 的路徑，資料夾批次也會略過其中的檔案。
- **門檻不在這裡定案**：調出的數值請匯出 JSON，附上校準依據後在 PR 中修改 `config.py`。
- **標籤只寫中文**：不寫成「中文 · English」；需要英文術語時放在 `help=` 提示中。

## 結構

```
workbench/
├── streamlit_app.py     入口：樣式、導覽、執行頁面（頁面登記在 wb/nav.py）
├── app_pages/           各頁面（直接寫成腳本，不包成函式）
├── wb/                  輔助模組
│   ├── images.py        影像讀寫、test split 防護（純邏輯）
│   ├── configs.py       設定匯出入、待校準清單、CONFIG_CLASSES（純邏輯）
│   ├── degradations.py  模擬退化與掃描軸，呼叫 dietai.synthetic（純邏輯）
│   ├── ladder_eval.py   條碼掃描：只用原圖 vs 逐步升級的成功率彙整（純邏輯）
│   ├── viz.py           視覺化，數值取自 dietai（純邏輯）
│   ├── checks.py        執行 pytest／ruff／mypy（純邏輯）
│   ├── text.py          介面標籤與警告代碼文字
│   ├── st_config.py     依 ParamInfo 自動產生分組參數面板（兩欄）、匯入匯出、網址同步
│   ├── st_source.py     影像來源選擇＋模擬退化（Streamlit 元件）
│   ├── st_ladder.py     階梯順序、倍率、解碼器選擇與參數（條碼頁與掃描頁共用）
│   ├── nav.py           模組與頁面註冊表（左側直欄、頂部膠囊、總覽頁的資料來源）
│   ├── st_nav.py        左側直欄與頂部膠囊（Streamlit 元件）
│   ├── st_layout.py     雙欄工作區、頁首、狀態列、指標列、卡片（Streamlit 元件）
│   ├── st_style.py      版面 CSS：直欄、膠囊、畫布與卡片、固定高度工作區
│   └── st_theme.py      淺色／深色切換開關（自訂元件 CCv2）
├── assets/              logo 與圖示
└── .streamlit/config.toml  主題（淺色／深色）與伺服器設定
```

純邏輯模組的測試在 `ai/tests/workbench/test_wb.py`，介面冒煙測試（`AppTest`，不開瀏覽器）在 `test_app.py`。

## 新增頁面或模組（例：模組一 Phase 3 營養標示，可參考 `app_pages/label.py`、`app_pages/food.py`）

1. 在 `dietai/.../config.py` 以 `param()` 宣告設定欄位，並加入 `wb/configs.py` 的 `CONFIG_CLASSES`。
   參數面板只處理 `param()` 的純量欄位；序列等欄位（如 `LadderConfig.rungs`）由頁面自行提供元件，
   以 `config_editor(cls, prefix, extra_keys={欄位: 元件鍵})` 登記；匯入 JSON 與「還原」會寫回這些元件
   （參考 `wb/st_ladder.py`）。欄位以 `param(group=...)` 分組，新分組在 `wb/text.py` 的 `GROUP_TEXT` 加上名稱與圖示。
2. 新增 `app_pages/<頁面>.py`，沿用標準版面：

   ```python
   page_header("營養標示", "一句說明", ":material/receipt_long:", phase=3)
   panel, results = workspace()
   with panel:
       tab_img, tab_cfg, tab_io = panel_tabs(
           ":material/image: 影像", ":material/tune: 參數", ":material/swap_vert: 匯出入"
       )
       with tab_img:
           source = image_source("label", scene="nutrition")
       with tab_cfg:
           cfg = config_editor(LabelConfig, "label")
       with tab_io:
           config_io(cfg, LabelConfig, "label")
   with results:
       ...  # status_line → metric_row → 檢視切換（含「步驟」）→ card() 內放影像
   ```

   需要新的合成場景時加到 `dietai.synthetic`，並在 `wb/st_source.py` 的 `Scene` 登記。
3. 在 `wb/nav.py` 對應模組的 `tools` 加一筆 `Tool(..., phase=N)`，完成時把 `phases` 中該 Phase 標為完成。
   新模組開始實作時填入它的 `tools`、`phases` 與 `task_doc`，左側直欄會自動啟用。
4. 在 `tests/workbench/test_app.py` 加冒煙測試；新的警告代碼在 `wb/text.py` 的 `WARNING_TEXT` 加上文字（`test_wb.py` 會檢查是否齊全）。
