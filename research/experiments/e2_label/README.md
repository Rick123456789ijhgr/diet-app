# E2 營養標示 OCR（ADR 0005）

> 資料夾名稱與編號為暫定，待規劃書確認後再調整。

## 目的

量測影像前處理（定位、透視校正、光斑修補、對比增強等）能否讓營養標示的**欄位數值**讀得更準，
並在前處理實驗之前先選定 OCR 引擎（階段零）。設計見 `docs/preprocess-experiment-design.md`
（第 3.3、5.4、7.1、8.2 節）與 `docs/adr/0005-preprocess-experiment-design.md`。

數字一律由 `dietai.label_parsing.fields` 從 OCR 文字以規則取出（根目錄規則 1），不使用 LLM。

## 快速開始

```bash
python make_synthetic.py                                    # 合成英文營養標示 → synthetic/（gitignore）
python run.py --manifest synthetic/manifest.csv             # 預設引擎 tesseract（chi_tra+eng），所有前處理方法
python run.py --manifest ... --engines tesseract,paddle,paddle:mobile --only l0_raw --label stage0   # 階段零
```

引擎描述：`tesseract[:語言[:psm]]`（例如 `tesseract:chi_tra+eng:6`）、`paddle[:server|mobile]`（PP-OCRv5，預設 server）。

## 環境

| 引擎 | 安裝 | 狀態 |
| --- | --- | --- |
| Tesseract 5.4（chi_tra） | `winget install UB-Mannheim.TesseractOCR`；`pip install -e "ai[ocr]"`（pytesseract）；語言包見下 | 可用 |
| PaddleOCR 3.7（PP-OCRv5） | `make setup-paddle`（獨立環境 `ai/.venv-paddle`，版本見 `ai/requirements-paddle.txt`）；首次執行自動下載模型到 `~/.paddlex/official_models` | 可用 |

PaddleOCR 的依賴 paddlex 釘死 `opencv-contrib-python==4.10.0.84`，會取代 `vision` 的 OpenCV 4.12（E1 結果依賴它），
因此裝在獨立環境。`run.py` 仍在 `ai/.venv` 執行：前處理用專案的 OpenCV 完成，影像以無損 PNG 傳給
`ai/.venv-paddle` 中的工作行程（`dietai/adapters/ocr/paddle_worker.py`）只做偵測與辨識，結果照常經快取。
另一個位置的 python 可用環境變數 `DIETAI_PADDLE_PYTHON` 指定。引擎名稱含 paddleocr、paddle、OpenCV 版本與
偵測、辨識模型檔的 sha256，換了任何一項就是不同的引擎。PaddleOCR 自己的方向分類與彎曲校正關閉，由本專案前處理負責。

Tesseract 語言包不進 git。放在不含空白的資料夾（例如 `%LOCALAPPDATA%\dietai\tessdata`），以 `--tessdata` 或環境變數
`DIETAI_TESSDATA` 指定。目前使用 `tessdata_best` 4.1.0 的 `chi_tra.traineddata`
（sha256 `1aa60488574cafa69486d919284f079ca9b68fcc7f6ad8dc1ff1b318dfd97028`），
`eng`、`osd` 取自安裝程式。各語言包的雜湊會寫進引擎名稱與 `run.json`，換了語言包就是不同的引擎。

## manifest 與真值

manifest 格式同 E1（`dietai.evaluation.manifest`），`truth` 欄為**真值 JSON 的路徑**（相對於 manifest），空白為負樣本。
真值格式見 `dietai.evaluation.label`：

```json
{
  "columns": ["per_serving", "per_100g"],
  "header": {"serving_size": "30 公克", "servings": "6 份"},
  "facts": {"energy": ["152 大卡", "507 大卡"], "protein": ["2.1 公克", "7.0 公克"]},
  "quad": [[120, 80], [940, 95], [930, 1310], [110, 1290]],
  "text": "營養標示\n每一份量30公克\n..."
}
```

- 數值照標示上的寫法輸入，比對時統一正規化（全形轉半形、去空白、大卡→kcal、公克→g、毫克→mg；`2.10` = `2.1`）。
- 欄位：`serving_size`、`servings`、`energy`、`protein`、`fat`、`saturated_fat`、`trans_fat`、`carbohydrate`、`sugar`、`sodium`。
- `quad`（原圖座標，左上起順時針）與 `text`（全文）可省略，省略時不計算定位誤差與 CER。
- 兩人獨立標記後比對，不一致處由第三人裁定；不要用 Excel 編輯。

## 前處理方法（`configs/`）

| 設定 | 內容 |
| --- | --- |
| `l0_raw` | 原圖；階段零只用這一組 |
| `l1_rectify` | 單一方法：定位＋透視校正 |
| `l2_default` | 程式預設：定位＋校正 → 光斑修補 → CLAHE |
| `l3_glare` | 單一方法：光斑修補（整張原圖） |
| `l4_denoise` | 單一方法：中值濾波去噪 |
| `l5_clahe` | 單一方法：CLAHE |
| `l6_adaptive` | 單一方法：自適應二值化 |
| `l7_otsu` | 單一方法：Otsu 二值化 |
| `l8_c06` | 疊加 C-06：定位＋校正 → CLAHE → 自適應二值化 |
| `l9_c07` | 疊加 C-07：光斑修補 → CLAHE（不定位） |

每個檔案：`{"name", "description", "label": LabelConfig 欄位或 null}`。改參數就新增檔案，不覆寫舊的。
`preprocess_label` 的段落順序固定為「定位＋校正 → 光斑 → 去噪 → 對比 → 二值化」，疊加流程以開關組合表示；
單一方法的設定把其他段落明確關閉，不依賴預設值。去噪與二值化在程式預設中關閉。

營養標示沒有「讀到就停」（OCR 一定有輸出），因此不做逐步升級；每張影像本來就執行所有方法（設計 6.3），
結果表即可比較單一方法、疊加流程與基準。

## 輸出（`runs/<時間>_<label>/`，gitignore）

| 檔案 | 內容 |
| --- | --- |
| `label_results.csv` | 每張影像 × 方法 × 引擎一列：欄位正確格數、整張全對、CER、定位誤差與是否成功、讀到的欄位與文字行、答錯的格、耗時 |
| `run.json` | 時間、git commit、套件版本、manifest 雜湊、各引擎完整名稱（版本、語言包雜湊）、各方法完整設定 |
| `summary.md` | 依方法 × 引擎（與各標籤）彙整 |

指標（設計 8.2 節）：**欄位完全正確率**（主要）、整張全對比例、定位成功率與平均定位誤差（平均角距 ÷ 對角線，門檻暫定 2%）、CER。
「原始樣本平均」先在原始樣本內平均再平均（設計 9.1 節）。

## 合成資料冒煙結果（不是結論）

2026-11-02，6 張合成英文標示（透視強度 0.15），Tesseract 5.4：

| 方法 | 引擎 | 欄位正確率 | CER | 定位成功 |
| --- | --- | ---: | ---: | ---: |
| `l0_raw` | chi_tra+eng | 0.0% | 0.906 | — |
| `l0_raw` | eng | 0.0% | 0.799 | — |
| `l1_rectify`／預設 | chi_tra+eng | 8.3% | 0.697 | 100% |
| `l1_rectify`／預設 | eng | 18.3% | 0.228 | 100% |

Tesseract 的版面分析只讀到左欄的欄位名稱、漏掉右對齊的數值欄；`g` 常被讀成 `9`（`3.2g` → `3.29`）。

同一批 6 張，三個引擎對照（`--engines tesseract:eng,paddle:mobile,paddle`）：

| 方法 | 引擎 | 欄位正確率 | 整張全對 | CER | 每張 OCR 時間 |
| --- | --- | ---: | ---: | ---: | ---: |
| `l0_raw` | tesseract:eng | 0.0% | 0.0% | 0.799 | 0.2 秒 |
| `l0_raw` | paddle:mobile | 46.7% | 16.7% | 0.157 | 1.6 秒 |
| `l0_raw` | paddle（server） | 46.7% | 0.0% | 0.162 | 199 秒 |
| `l1_rectify` | tesseract:eng | 20.0% | 0.0% | 0.292 | 0.2 秒 |
| `l1_rectify` | paddle:mobile | 98.3% | 83.3% | 0.001 | 1.1 秒 |
| `l1_rectify` | paddle（server） | 96.7% | 66.7% | 0.003 | 126 秒 |
| `l2_default` | tesseract:eng | 18.3% | 0.0% | 0.228 | 0.2 秒 |
| `l2_default` | paddle:mobile | 96.7% | 66.7% | 0.003 | 1.0 秒 |
| `l2_default` | paddle（server） | 93.3% | 33.3% | 0.005 | 122 秒 |

PaddleOCR 讀得到右對齊的數值欄；定位＋校正對兩個引擎都是主要的提升。server 模型在本機 CPU 上每張需 2–3 分鐘
（原因未查），真實照片的階段零須先處理速度（縮圖或只用 mobile）。合成標示是英文、字型單一，不能用來選引擎。

同一批 6 張，加入單一方法與疊加流程（2026-11-03，`--engines tesseract:eng,paddle:mobile`，只列 paddle:mobile）：

| 方法 | 欄位正確率 | 整張全對 | CER |
| --- | ---: | ---: | ---: |
| `l0_raw` | 46.7% | 16.7% | 0.157 |
| `l1_rectify` | 98.3% | 83.3% | 0.001 |
| `l2_default` | 96.7% | 66.7% | 0.003 |
| `l4_denoise` | 21.7% | 0.0% | 0.201 |
| `l5_clahe` | 48.3% | 16.7% | 0.155 |
| `l6_adaptive` | 48.3% | 0.0% | 0.152 |
| `l7_otsu` | 41.7% | 0.0% | 0.147 |
| `l8_c06` | 85.0% | 33.3% | 0.011 |

合成標示沒有光斑，`l3_glare` 的輸出與原圖相同，`l9_c07` 與 `l5_clahe` 相同（快取命中）。合成影像乾淨、字型小，
中值濾波把小字抹糊；二值化讓 PaddleOCR 的整張全對下降。這些只說明流程可執行，方向要以真實照片確認。

## 結論

（以真實照片完成階段零與正式實驗後填寫）
