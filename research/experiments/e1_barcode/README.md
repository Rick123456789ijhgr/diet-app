# E1 條碼前處理消融（對應 RQ1）

## 目的

比較「無前處理」與逐步加入各項前處理時的條碼解碼成功率，依拍攝條件（距離、角度、光線、材質）分組呈現，
並找出「哪一個步驟救回了哪些影像」，作為決定逐步升級最終順序的依據（任務書第 10 節：由人依 E1 結果決定）。

## 快速開始

```bash
make e1-synthetic        # 根目錄：合成資料 → 執行所有實驗組 → 分組彙整
```

或分步執行（在 `ai/.venv` 環境中）：

```bash
python make_synthetic.py                                   # 合成資料 → synthetic/（gitignore）
python run.py --manifest synthetic/manifest.csv --label synthetic
python analyze.py                                          # 最新一次執行，依所有標籤欄分組
python analyze.py runs/<資料夾> --by lighting --baseline a0_raw
```

結果也可以在工作台「研究實驗 → E1 條碼消融」檢視（成功率、分組熱度圖、成功階、失敗影像）。

## manifest 格式

CSV（UTF-8），每列一張影像；格式定義見 `dietai.evaluation.manifest`。

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `image` | 是 | 影像路徑，相對路徑以 manifest 所在資料夾為準 |
| `truth` | 是 | 真值條碼；**空白表示負樣本**（影像中沒有條碼，用來量測誤報） |
| `split` | 否 | `train`／`dev`／`test`；`test` 預設排除，正式實驗加 `--include-test` |
| `id` | 否 | 影像代碼，省略時用 `image` |
| 其他欄位 | 否 | 拍攝條件標籤，例如 `distance`、`angle`、`lighting`、`material`，分析時依此分組 |

真實資料建議放在 `research/data/e1/`（DVC 管理），例如：

```csv
id,image,truth,split,distance,angle,lighting,material
p0001,images/p0001.jpg,4710088410108,dev,near,0,indoor,paper
p0002,images/p0002.jpg,4712345678901,test,far,30,backlit,foil
```

不要用 Excel 編輯 manifest：長數字會被轉成科學記號、前導 0 會遺失。

## 實驗組（`configs/`）

每個 JSON 檔是一個實驗組：`decoder`（`zxing`／`pyzbar`）、`zxing`（`ZxingConfig` 欄位）、
`ladder`（`LadderConfig` 欄位），省略的欄位用預設值。也接受工作台匯出的 `{"class": ..., "values": ...}`。
**改參數就新增檔案，不覆寫舊的**（research/CLAUDE.md）。
每個檔案都必須明寫 `ladder.rungs` 與 `ladder.accept_formats`（測試會檢查），程式預設改變時舊實驗組的意義才不會跟著變。
`a0`～`a6`、`z0`、`z1`、`p*` 都釘在 Phase 2 的階梯順序、不限格式。

| 設定 | 階梯 | zxing-cpp 內建嘗試 | 用途 |
| --- | --- | --- | --- |
| `a0_raw` | raw | 關 | 消融基準 |
| `a1_gray` | ＋gray | 關 | 逐步加入 |
| `a2_binarize` | ＋binarize | 關 | 逐步加入 |
| `a3_sharpen` | ＋sharpen | 關 | 逐步加入 |
| `a4_denoise` | ＋denoise | 關 | 逐步加入 |
| `a5_deskew` | ＋deskew | 關 | 逐步加入 |
| `a6_full` | ＋multiscale（完整階梯） | 關 | 逐步加入 |
| `z0_raw_zxing_default` | raw | 開 | 對照：不做前處理的上線情境 |
| `z1_full_zxing_default` | 完整階梯 | 開 | 對照：目前的上線預設 |
| `p0_raw_pyzbar` | raw | — | 解碼器對照 |
| `p1_full_pyzbar` | 完整階梯 | — | 解碼器對照 |
| `m0_sharpen_last` | 完整階梯，sharpen 移到最後 | 關 | 誤讀對策 |
| `m1_agree2` | 完整階梯，`min_agree=2`（兩次嘗試一致才採用） | 關 | 誤讀對策 |
| `m2_agree2_zxing_default` | 同 z1，加 `min_agree=2` | 開 | 誤讀對策 |
| `m3_retail_formats` | 完整階梯，`accept_formats` 只收 EAN-13／EAN-8／UPC-A | 關 | 誤讀對策 |
| `m4_retail_sharpen_last` | m3＋sharpen 移到最後 | 關 | 誤讀對策 |
| `m5_retail_zxing_default` | 同 z1，加格式限制 | 開 | 誤讀對策 |
| `z2_default_v2` | sharpen 最後＋只收零售格式 | 開 | 目前的程式預設（2026-10-12 起） |

消融組關閉 zxing-cpp 內建的旋轉／縮小／反色，才量得到階梯本身的貢獻（模組一 Phase 2 決議）。

## 輸出（`runs/<時間>_<label>/`，gitignore）

| 檔案 | 內容 |
| --- | --- |
| `run.json` | 實驗紀錄：時間、git commit 與是否有未提交變更、Python 與套件版本、manifest 路徑與 sha256、合成資料參數與種子、每個實驗組的完整設定（含預設值） |
| `results.csv` | 每張影像 × 每個實驗組一列：`outcome`、成功階、嘗試次數、耗時、解出的文字、標籤欄 |
| `attempts.csv` | 每次階梯嘗試一列：階、參數、耗時、結果數、檢查碼錯誤數 |
| `summary.md`／`summary*.csv` | `analyze.py` 的彙整（`run.py` 結束時也會先寫一份 `summary.md`） |

`outcome` 的判定：`correct`（解出且等於真值）、`misread`（解出但不等於真值；階梯在誤讀時就停止）、
`missed`、`false_positive`（負樣本卻解出）、`true_negative`、`error`（讀檔或處理失敗，不計入成功率）。

統計：成功率 = correct ÷ 正樣本數，附 Wilson 95% 信賴區間；與基準組以同一批影像配對做 McNemar 精確檢定
（`失去／救回` 為基準對而本組錯／基準錯而本組對的張數）。

紀錄方式採本地執行資料夾，不使用 MLflow／W&B，理由見 `docs/adr/0002-experiment-records.md`。
正式結論請把 `summary.md` 的關鍵表格與 `run.json` 的 commit、manifest sha256 抄到下方「結論」。

## 合成資料冒煙結果（不是結論）

2026-10-12，4 個條碼 × 16 種條件＋2 張負樣本，模組寬 3 px：消融組整體成功率由 `a0_raw` 37.5% 逐步升到
`a6_full` 87.5%；`a1_gray` 與 `a0_raw` 完全相同（zxing-cpp 內部本來就轉灰階）。
另觀察到一次**檢查碼正確的誤讀**：縮小到 0.35 倍的條碼經 `sharpen` 後解成另一個合法的 EAN-13，
所有含 sharpen 的實驗組都繼承了這個誤讀。真實照片中是否發生、頻率多高，是 E1 要回答的問題之一。

### 誤讀對策比較（8 個條碼，128 張正樣本；仍是合成資料）

| 實驗組 | 成功率 | 誤讀 | 耗時中位數 |
| --- | ---: | ---: | ---: |
| `a6_full`（目前預設階梯） | 84.4% | 6 | 9.5 ms |
| `m0_sharpen_last` | 85.2% | 5 | 9.6 ms |
| `m1_agree2` | 56.2% | 4 | 25.2 ms |
| `m3_retail_formats` | **87.5%** | **2** | 10.1 ms |
| `m4_retail_sharpen_last` | **88.3%** | **1** | 9.9 ms |

- 誤讀有兩類：① 斜拍 30°／45° 的 EAN-13 被斜向掃描線部分讀成**合法的 UPC-E**（連 `a0_raw` 與上線預設 `z1` 都會），
  `verify_ean13` 只檢查 EAN-13 所以擋不住；② `sharpen` 把縮小的條碼讀成另一個檢查碼正確的 EAN-13。
- **格式限制**（`accept_formats`）完全擋下第 ① 類且沒有代價：UPC-E 被拒後階梯繼續，`deskew` 解出正確的 EAN-13，成功率反而上升。
- **兩次一致**（`min_agree=2`）代價過高：raw 與 gray 對 zxing-cpp 幾乎是同一張圖，會「一致地」誤讀，擋不住第 ① 類；
  而旋轉、暗光、梯度只有單一階救得回，成功率掉 28 個百分點。
- 第 ② 類仍剩 1 次（該影像只有 sharpen 讀得出來）。
- 2026-10-12 決定：程式預設改為 `m4` 的設定（sharpen 最後＋只收零售格式），`min_agree` 維持 1；對應實驗組為
  `z2_default_v2`（合成資料 88.3%、誤讀 1，舊預設 `z1` 為 84.4%、誤讀 6）。真實照片結果出來後複核。

## 結論

（以真實照片完成正式實驗後填寫：資料版本〔DVC〕、run 資料夾、commit、manifest sha256、主要表格與決定的階梯順序）
