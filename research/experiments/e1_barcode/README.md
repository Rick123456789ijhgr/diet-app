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
| `c0_all_methods` | 所有單一方法（含 otsu、clahe）＋多尺度＋疊加流程 C-01～C-05 | 關 | `run_methods.py` 的預設（每個方法都執行） |

消融組關閉 zxing-cpp 內建的旋轉／縮小／反色，才量得到階梯本身的貢獻（模組一 Phase 2 決議）。

## 輸出（`runs/<時間>_<label>/`，gitignore）

| 檔案 | 內容 |
| --- | --- |
| `run.json` | 實驗紀錄：時間、git commit 與是否有未提交變更、Python 與套件版本、manifest 路徑與 sha256、合成資料參數與種子、每個實驗組的完整設定（含預設值） |
| `results.csv` | 每張影像 × 每個實驗組一列：`outcome`、成功階（`success_rung`；`min_agree` > 1 時為湊滿票數的階）、救回階（`first_rung`，第一次解出採用內容的階）、嘗試次數、耗時、解出的文字、標籤欄 |
| `attempts.csv` | 每次階梯嘗試一列：階、參數、耗時、結果數、檢查碼錯誤數 |
| `summary.md`／`summary*.csv` | `analyze.py` 的彙整（`run.py` 結束時也會先寫一份 `summary.md`） |

`outcome` 的判定：`correct`（解出且等於真值）、`misread`（解出但不等於真值；階梯在誤讀時就停止）、
`missed`、`false_positive`（負樣本卻解出）、`true_negative`、`error`（讀檔或處理失敗，不計入成功率）。

統計：成功率 = correct ÷ 正樣本數，附 Wilson 95% 信賴區間；與基準組以同一批影像配對做 McNemar 精確檢定
（`失去／救回` 為基準對而本組錯／基準錯而本組對的張數）。
以上兩者以「張」為單位，同一原始樣本的變體不獨立，區間會窄得不真實（ADR 0005 第 4 點），只供探索。
`summary.md` 的「以原始樣本為單位」一節與 `summary_source.csv` 才是正式分析用的比較：

- 依 manifest 的 `source_id` 欄（同一產品的所有變體同一值）分集群；沒有此欄時每張影像各為一個原始樣本，報告會註明。
- 95% CI：集群 bootstrap（重抽原始樣本，連同其所有變體）；p 值：集群符號翻轉置換檢定。
- `--primary` 指定事先寫定的主要比較（設計 9.2 節：選定策略 vs A0），不做多重比較校正；其餘各組為探索性，以 Holm 校正。
- `--seed` 固定隨機種子（預設 0），結果可重現。

```bash
python analyze.py runs/<資料夾> --baseline a0_raw --primary z2_default_v2
```

紀錄方式採本地執行資料夾，不使用 MLflow／W&B，理由見 `docs/adr/0002-experiment-records.md`。
正式結論請把 `summary.md` 的關鍵表格與 `run.json` 的 commit、manifest sha256 抄到下方「結論」。

## 由真實照片產生變體（ADR 0005）

正式實驗的資料以真實照片為原圖，由程式產生參數已知的劣化變體（半合成）；真實拍攝的劣化照片另外收集、分開報告。

```bash
python make_variants.py --sources ../../data/e1/sources.csv --out ../../data/e1/variants
python make_variants.py --sources ... --out ... --conditions blur,motion,jpeg --max-side 1200
```

- 來源 manifest 格式同上，每列一張品質良好的原圖；`id` 即 `source_id`，**每張原圖都必須有 `split`**（以原始樣本為單位切分，變體跟著原圖走）。
- 每張原圖產生 `clean` 與 13 種單一條件 × 4 級（`dietai.synthetic.VARIANT_CONDITIONS`）：
  `blur`、`motion`（手震，方向由種子決定）、`noise`、`salt_pepper`、`downscale`、`dark`、`contrast`、`gradient`、`glare`、`rotate`（到 80°）、`perspective`（斜拍，方向由種子決定）、`curve`（圓柱曲面）、`jpeg`。
- 另有 3 種複合情境 × 4 級（`COMPOSITE_CONDITIONS`，設計 4.1 節第 3 點）：`dark+blur`、`rotate+perspective`、`curve+glare`。
  依序套用各成分，第 i 級為各成分的第 i 級，`level` 也以 `+` 連接（例如 `0.5+1`）；報告時與單一劣化分開。
  劣化過重的等級也保留，結果以「劣化程度 → 成功率」曲線呈現。
- 原圖先縮到長邊 1600 px（`--max-side`），等級才對不同手機的照片有一致意義。變體一律存 PNG（無損）。
- 輸出 `splits/<split>/<source_id>/<條件>_<等級>.png`、`manifest.csv`（標籤欄 `source_id`、`condition`、`level`、`seed`，再接原圖的標籤）與 `manifest.json`（產生參數、來源 manifest 的 sha256、劣化程式的雜湊）。
- 種子由整體 `--seed` 與 `source_id` 決定，與原圖順序無關：之後加入新原圖不會改變既有變體。
- 測試集原圖的變體寫在 `splits/test/` 下，預設不產生；正式實驗前才加 `--include-test`。
- `source_id`、`seed` 不會出現在「依標籤分組」的表格中；`source_id` 是以原始樣本為單位統計時的集群。
- 合成資料（`make_synthetic.py`）也帶 `source_id`（條碼代碼），可以先用來演練整套流程。

## 每個方法都執行（ADR 0005）

`run.py` 的階梯在第一次有結果時就停止，只看得出「依這個順序加入時」每一步的貢獻。
`run_methods.py` 改為每張影像執行實驗組 `ladder.rungs` 中的**所有方法、不提早停止**，輸出「變體 × 方法」結果表；
各方法都從原圖獨立處理，因此任何「方法子集＋順序」的逐步升級都能由結果表離線算出，再以貪婪法選擇步驟與順序
（設計見 `docs/preprocess-experiment-design.md` 6.3、6.5 節）。

```bash
python run_methods.py --manifest synthetic/manifest.csv                     # 預設 a6_full（所有階、關閉 zxing-cpp 內建嘗試）
python run_methods.py --manifest ... --only a6_full,p1_full_pyzbar --label stage0   # 階段零：同時比較引擎
python analyze_methods.py                                                   # 最新一次結果，預設準則
python analyze_methods.py runs/<資料夾> --min-gain 2 --max-new-wrong 0 --max-mean-ms 20
python analyze_methods.py runs/<資料夾> --order frozen=raw,multiscale@2,deskew   # 評估指定順序
python analyze_methods.py runs/<資料夾> --glmm condition                          # 加上混合效果邏輯迴歸
```

- 方法代碼為階的代碼；多尺度的每個倍率各算一個方法（`multiscale@2`、`multiscale@0.5`），每條疊加流程也各算一個方法（`pipeline@denoise+binarize`）。
- 每個方法以「只含這一階」的設定分別執行，耗時互不影響；單一方法丟出例外只有該方法記為 `error`。
- 離線算出的逐步升級與 `decode_with_ladder` 實際執行的判定完全相同（含 `min_agree`，有測試比對）；
  耗時為已嘗試方法的總和，每個方法都含轉灰階，因此比上線時略高。
- 單一方法的判定同 `run.py`；略過的方法（`deskew` 角度小於門檻）不送解碼、判為未讀到，單獨的成功率應以逐步升級解讀。
- 結果放在同一個 `runs/` 下（只有 `methods.csv`，沒有 `results.csv`）；`analyze.py` 與工作台的 E1 頁不會列出這種執行。
- `--glmm 標籤欄,…`：每個實驗組加一張混合效果邏輯迴歸表（設計 9.1 節輔助方法；`dietai.evaluation.glmm`）。
  固定效果為方法（基準 `raw`）與指定的標籤欄（`condition` 以 `clean` 為基準），原始樣本 `source_id` 為隨機截距；
  以自適應 Gauss–Hermite 最大概似估計（同 R `glmer` 的 `nAGQ > 1`），報告勝算比、95% 信賴區間與 Wald p 值。
  某分組全對或全錯（完全分離）時係數不可信，表後會標出；只有一個原始樣本時無法擬合。

| 檔案 | 內容 |
| --- | --- |
| `methods.csv` | 每張影像 × 實驗組 × 方法一列：`method`、`rung`、`params`、`outcome`、解出的文字與格式、`rejected`、`skipped`、`elapsed_ms`（`preprocess_ms` ＋ `decode_ms`）、標籤欄 |
| `run.json` | 同 `run.py`，另有 `mode: "methods"` 與各實驗組的方法代碼 |
| `summary.md` | 引擎比較（多個實驗組時）、單一方法比較（相對 `raw` 的失去／救回）、貪婪選擇各步、逐步升級的離線比較 |
| `methods_<實驗組>.csv`／`greedy_<實驗組>.csv` | `analyze_methods.py` 寫出的單一方法比較與貪婪選擇各步 |

### 疊加流程（設計 6.4 節）

疊加流程是逐步升級中的一階 `pipeline`：同一張灰階影像依序做多個處理後送解碼一次，仍由原圖開始、與其他階互相獨立，
因此可以和單一方法一起放進結果表、離線計算與貪婪選擇。流程寫在實驗組的 `ladder.pipelines`（用到 `pipeline` 時必須明寫）：

```json
"pipelines": [["denoise", "binarize"], ["clahe", "binarize"], ["deskew", "denoise", "binarize"]]
```

- 可用步驟：`binarize`（自適應）、`otsu`、`clahe`、`sharpen`、`denoise`（中值）、`deskew`；每條至少兩步、不重複。各步驟沿用 `LadderConfig` 中同名的參數。
- `deskew` 在流程中依「目前的影像」估計角度，小於門檻時這一步不旋轉，其餘步驟照常；解出的四角一律回推到原圖。
- `summary.md` 的「疊加流程 vs 所含最佳單一步驟（H3）」比較每條流程與它所含步驟單獨執行的最佳者；差異為負表示方法互相干擾。
- 預設流程為設計表 6.4 的 C-01～C-05；C-06（透視校正）、C-07（光斑修補）屬於營養標示，待營養標示實驗再加。

貪婪法（`dietai.evaluation.greedy_ladder`）：從 `raw`（A0）開始，每一步在尚未加入的方法中，選擇救回最多
「目前仍未讀到的正樣本」、且新增的誤讀＋負樣本誤報不超過 `--max-new-wrong` 的方法加到最後；
救回數相同時選平均耗時較低者。救回數低於 `--min-gain`，或剩下的方法都會增加誤讀或超過 `--max-mean-ms` 時停止。
**選擇只在 dev 上進行**：結果含測試集時 `greedy_ladder` 拒絕執行，報告只評估 `--order` 指定的順序（規則 7）。
正式實驗前，`--min-gain`、`--max-new-wrong`、`--max-mean-ms` 的數值要寫進下方「結論」並不再修改（ADR 0005 第 7 點）。

`summary.md` 的信賴區間與 McNemar 仍以變體為單位，只供探索；以原始樣本為單位的分析見 ADR 0005 後續工作 2。

## 規則式自適應策略（設計 6.7 節、ADR 0005 後續 6）

先試原圖；失敗才量測品質，依規則決定接下來嘗試哪些方法、依什麼順序，再接固定的候補，最多 `max_attempts` 次。
策略只決定順序、不另外執行處理，因此由「每個方法都執行」的結果表加上每張影像的品質量測值就能離線算出。
不訓練模型（規則 5）；門檻只依 dev 調整（規則 7）。

```bash
python adaptive.py                                             # 最新一次 run_methods.py 的結果、預設策略
python adaptive.py runs/<資料夾> --tune                          # 在 dev 上調整門檻
python adaptive.py runs/<資料夾> --gate "blur<100" --gate "contrast<60"   # 評估品質檢查門檻
python adaptive.py runs/<資料夾> --policy configs/adaptive/r1_xxx.json --order greedy=raw,…   # 凍結後評估
```

品質量測值（`dietai.preprocess.features`，全部在縮到短邊 480 的灰階上量測，量測耗時計入策略耗時）：

| 量測值 | 意義 |
| --- | --- |
| `blur` | 拉普拉斯變異數（越小越模糊） |
| `brightness`、`dark_ratio`、`bright_ratio` | 灰階平均、過暗／過亮比例 |
| `contrast` | 灰階第 95 與第 5 百分位數差 |
| `noise`、`impulse_ratio` | 與 3×3 中值濾波的平均差、差異超過 64 的像素比例（椒鹽） |
| `illumination` | 大範圍模糊後背景亮度的變異係數（光線不均） |
| `skew` | 估計傾斜角的絕對值（度） |
| `short_side` | 原圖短邊（像素） |
| `glare_ratio` | 面積夠大的近飽和（≥250）區域比例 |

策略檔（`configs/adaptive/`）：`rules` 為依序檢查的 `{feature, op, threshold, methods}`，條件成立就把 `methods` 加入；
之後接 `fallback`，去除重複後取前 `max_attempts` 個。`r0_default` 是設計 6.7 節規則範例的條碼版本，門檻只是起點。

- `--tune`：對每條規則，在 dev 量測值的 5%～95% 分位數與原門檻中，選「誤讀＋誤報不增加（或 `--max-wrong`）下正確最多，
  再來耗時最短」的門檻，做兩輪座標搜尋。結果寫到 `<執行資料夾>/policy_<名稱>_tuned.json`（含調整紀錄）；
  要沿用就複製到 `configs/adaptive/` 另取名稱，不覆寫舊檔。結果含測試集時拒絕。
- 比較基準：預設為同一份結果上貪婪選出的逐步升級（`greedy`）；含測試集時須以 `--order` 指定凍結的順序。
  H4 的判定看「以原始樣本為單位」一節的成功率差異與「耗時」一節的總耗時。
- `--gate`：品質檢查門檻（條件成立即判為品質不佳）對自適應策略結果的誤報（判不佳但讀對）與漏報（判良好但讀錯）。
  `feature_bins.csv` 列出各量測值分成四組時每個方法的成功率，用來找「成功率開始下滑」的範圍。

| 檔案 | 內容 |
| --- | --- |
| `features.csv` | 每張影像的品質量測值與量測耗時（第一次執行時寫入，`--remeasure` 重新量測） |
| `adaptive_<策略>.csv` | 每個變體一列，欄位同 `results.csv`，另有 `plan`（嘗試順序）與 `rules`（成立的規則） |
| `summary_adaptive_<策略>.md` | 規則成立比例、與基準的比較、耗時、以原始樣本為單位、嘗試順序分布、品質檢查門檻、門檻調整 |
| `feature_bins.csv` | 各量測值分組下每個方法的成功率 |
| `policy_<策略>_tuned.json` | `--tune` 調整後的策略與調整紀錄 |

工作台「模組一 → 自適應策略」（`make workbench`）可檢視同一份結果：列出 `runs/` 中「每個方法都執行」的資料夾，
對 `configs/adaptive/` 的每個策略與該執行內調整後的策略，顯示與貪婪逐步升級的比較、規則成立比例、嘗試順序分布、
依量測值分組的各方法成功率與各影像的結果。工作台只讀取，不量測也不調整；還沒有 `features.csv` 時會顯示要執行的指令。

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

### 自適應策略（2026-11-02；8 個條碼 × 16 種條件，兩組不同種子）

以 `c0_all_methods` 跑兩組合成資料：A 組（種子 1）調整門檻並貪婪選出逐步升級，B 組（種子 2）凍結兩者後評估。

| 資料 | 策略 | 成功率 | 誤讀 | 平均耗時 | 平均嘗試次數 |
| --- | --- | ---: | ---: | ---: | ---: |
| A（調整用） | `greedy`（raw → deskew+denoise+binarize → multiscale@2） | 86.7% | 2 | 14.0 ms | 1.88 |
| A（調整用） | `r0_default_tuned` | 86.7% | 2 | 15.9 ms | 2.05 |
| B（凍結） | `greedy` | 84.4% | 4 | 13.6 ms | 1.85 |
| B（凍結） | `r0_default_tuned` | 84.4% | 4 | 15.7 ms | 2.03 |
| B（凍結） | 所有 15 個方法依序 | 83.6% | 5 | 27.3 ms | 5.01 |

- 自適應策略與貪婪逐步升級的成功率相同，但平均耗時多約 2 ms，**H4「耗時較短」在合成資料上不成立**：
  合成影像只有 900×600，解碼一次只要數毫秒，品質量測（約 7 ms）本身就和解碼一樣貴；貪婪選出的三步已涵蓋大部分條件。
- 真實照片解析度高、單次解碼較慢，量測的相對成本會低很多，須以真實照片重做才能判斷 H4。
- 調整門檻時正確數不變，只有耗時下降（21.0 → 15.9 ms）；合成條件彼此分得很開，門檻在很寬的範圍內結果都一樣。

## 結論

（以真實照片完成正式實驗後填寫：資料版本〔DVC〕、run 資料夾、commit、manifest sha256、主要表格與決定的階梯順序）
