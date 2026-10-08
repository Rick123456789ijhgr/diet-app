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

## 頁面

上方導覽列分為「模組一 影像前處理」與「開發工具」兩組；右上角為淺色／深色切換開關。

| 頁面 | 用途 |
| --- | --- |
| 總覽 | 快速開始卡片、模組進度、使用規則、待校準門檻（由 `param(calibrate=True)` 自動列出） |
| 品質檢查 · Quality | 左欄選影像並疊加模擬退化，右欄依序顯示判定、四項指標、檢視（原圖／邊緣響應／曝光遮罩／直方圖）與步驟紀錄 |
| 參數掃描 · Sweep | 一種退化由弱到強；直接列出每種警告在哪個等級首次觸發，附縮圖與趨勢圖 |
| 資料夾批次 · Batch | 整個資料夾的通過率、分數分布、警告次數；點選表格列可檢視單張影像的遮罩 |
| 測試與檢查 · Checks | 執行 pytest（可選範圍、`-k`、slow）、ruff、mypy；保留最近 10 次結果 |

左側欄的參數面板在模組一各頁共用，依「模糊／曝光／解析度」分組，標示已修改的欄位數；
:orange[◆] 為待校準欄位，英文名稱與說明在 ⓘ 提示中。與預設值不同的欄位會同步到網址參數，
重新整理或把網址分享給組員都能重現同一組設定。

## 外觀

- 主題設定在 `.streamlit/config.toml`：`[theme]` 為共用字型與圓角，`[theme.light]`／`[theme.dark]` 為兩組配色。
  要調整顏色只改這個檔案，不要在頁面注入 CSS。
- 深色模式開關（`wb/st_theme.py`）寫入 Streamlit 原生的主題偏好後重新載入頁面，
  與右上角選單 ⋮ → Settings 的切換結果一致。它依賴 Streamlit 前端的 localStorage 鍵名，
  升級 Streamlit 時請在兩種模式下各開一次確認。
- 版面元件放在 `wb/st_layout.py`（頁首、區塊標題、空狀態），新頁面請沿用以保持一致。

## 規則

- **只呼叫 `dietai`**：工作台不得複製處理邏輯。視覺化需要的中間結果（如 `quality.laplacian_map`）應加到 `dietai` 成為公開函式並寫測試。
- **測試集鎖定**：`wb.images.guard_path` 會拒絕任何含 `splits/test` 的路徑，資料夾批次也會略過其中的檔案。
- **門檻不在這裡定案**：調出的數值請匯出 JSON，附上校準依據後在 PR 中修改 `config.py`。
- **中文為主、英文為輔**：標籤寫成「中文 · English」，用 `wb.text.zh_en()`。

## 結構

```
workbench/
├── streamlit_app.py     入口與導覽（新增頁面在這裡登記）
├── app_pages/           各頁面（直接寫成腳本，不包成函式）
├── wb/                  輔助模組
│   ├── images.py        影像讀寫、test split 防護（純邏輯）
│   ├── configs.py       設定匯出入、待校準清單、CONFIG_CLASSES（純邏輯）
│   ├── degradations.py  模擬退化與掃描軸，呼叫 dietai.synthetic（純邏輯）
│   ├── viz.py           視覺化，數值取自 dietai（純邏輯）
│   ├── checks.py        執行 pytest／ruff／mypy（純邏輯）
│   ├── text.py          中英文標籤與警告代碼文字
│   ├── st_config.py     依 ParamInfo 自動產生分組參數面板、網址同步（Streamlit 元件）
│   ├── st_source.py     影像來源選擇＋模擬退化（Streamlit 元件）
│   ├── st_layout.py     頁首、區塊標題、空狀態（Streamlit 元件）
│   └── st_theme.py      淺色／深色切換開關（自訂元件 CCv2）
├── assets/              logo 與圖示
└── .streamlit/config.toml  主題（淺色／深色）與伺服器設定
```

純邏輯模組的測試在 `ai/tests/workbench/test_wb.py`，介面冒煙測試（`AppTest`，不開瀏覽器）在 `test_app.py`。

## 新模組加頁面（例：Phase 2 條碼）

1. 在 `dietai/preprocess/config.py` 以 `param()` 宣告 `LadderConfig` 欄位，並加入 `wb/configs.py` 的 `CONFIG_CLASSES`。
2. 新增 `app_pages/barcode.py`：`page_header(...)`、`config_sidebar(LadderConfig, "ladder")`，左欄 `image_source("barcode")`、右欄呼叫 `decode_with_ladder` 並顯示結果。欄位以 `param(group=...)` 分組，新分組在 `wb/text.py` 的 `GROUP_TEXT` 加上名稱與圖示。
3. 在 `streamlit_app.py` 的「模組一 影像前處理」區段登記頁面；更新 `app_pages/home.py` 的模組進度。
4. 在 `tests/workbench/test_app.py` 加一個冒煙測試。
