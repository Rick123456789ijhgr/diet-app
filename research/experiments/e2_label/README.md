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
python run.py --manifest ... --engines tesseract,tesseract:eng --only l0_raw --label stage0   # 階段零
```

## 環境

| 引擎 | 安裝 | 狀態 |
| --- | --- | --- |
| Tesseract 5.4（chi_tra） | `winget install UB-Mannheim.TesseractOCR`；`pip install -e "ai[ocr]"`（pytesseract）；語言包見下 | 可用 |
| PaddleOCR | 其依賴 paddlex 釘死 `opencv-contrib-python==4.10.0.84`，會取代 `vision` 的 OpenCV 4.12（E1 結果依賴它） | **待決定安裝方式** |

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
| `l1_rectify` | 定位＋透視校正 |
| `l2_default` | 程式預設：定位＋校正 → 光斑修補 → CLAHE |

每個檔案：`{"name", "description", "label": LabelConfig 欄位或 null}`。改參數就新增檔案，不覆寫舊的。

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

## 結論

（以真實照片完成階段零與正式實驗後填寫）
