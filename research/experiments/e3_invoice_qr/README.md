# E3 電子發票 QR（ADR 0005）

> 資料夾名稱與編號為暫定，待規劃書確認後再調整。

## 目的

量測影像前處理能否讓電子發票證明聯上**左、右兩個 QR** 讀得更完整、更正確，並在前處理實驗之前先選定解碼器
（階段零）。設計見 `docs/preprocess-experiment-design.md`（第 3.3、5.3、6.3、6.5、8.1 節）與
`docs/adr/0005-preprocess-experiment-design.md`。優先度最低（設計第十三章）：發票只用於冷啟動上傳與相簿匯入。

只比對 QR 的**原始位元組**；中文解碼與欄位解析由 Go 端負責，不在本實驗範圍。

## 快速開始

```bash
python make_synthetic.py                                         # 合成發票與劣化變體 → synthetic/（gitignore）
python run.py --manifest synthetic/variants/manifest.csv          # 預設 q0_raw、q1_all_methods
python run.py --manifest ... --only q0_raw,q2_raw_pyzbar --label stage0   # 階段零：解碼器對照
```

真實發票：先以 `../e1_barcode/make_variants.py` 由原圖產生劣化變體（`truth` 照抄），再交給 `run.py`。

## manifest 與真值

manifest 格式同 E1（`dietai.evaluation.manifest`）。`truth` 欄為左、右 QR 原始位元組的**小寫 hex，以 `|` 分隔**
（`dietai.evaluation.format_invoice_truth`）；空白為負樣本。右側 QR 常含 Big5 中文，不能以文字輸入。
真值可由清晰的原圖以 zxing-cpp 解出後人工確認，兩人獨立確認後再寫入。

## 判定（設計 3.3 節）

比照上線的 `locate_invoice_qrs`，只取面積最大的兩個 QR（排除背景中的其他 QR）再比對：

| 結果 | 條件 |
| --- | --- |
| `correct` | 兩個都讀到且位元組一致 |
| `partial` | 只讀到一個且一致 |
| `misread` | 任一內容不一致 |
| `missed` | 兩個都沒有 |
| `false_positive`／`true_negative` | 負樣本有／沒有讀到 QR |

左右不另判：兩個 QR 的內容不同，位元組一致即代表找對了。

## 實驗組（`configs/`，格式同 E1）

| 設定 | 內容 |
| --- | --- |
| `q0_raw` | 基準 A0：原圖送 zxing-cpp（內建嘗試維持預設） |
| `q1_all_methods` | 每個方法都執行：所有單一方法、多尺度、疊加流程 C-01～C-05（同 E1 `c0_all_methods`） |
| `q2_raw_pyzbar` | 階段零對照：pyzbar 只用原圖 |

設計 7.1 節的候選還有 OpenCV `QRCodeDetector`，尚未實作解碼器。

## 輸出（`runs/<時間>_<label>/`，gitignore）

| 檔案 | 內容 |
| --- | --- |
| `invoice_methods.csv` | 每張影像 × 實驗組 × 方法一列：判定、找到的 QR（hex）與面積、耗時 |
| `run.json` | 時間、git commit、套件版本、manifest 雜湊、各實驗組完整設定 |
| `summary.md` | 單一方法比較（整體與依各標籤）、各實驗組原順序的逐步升級（離線計算） |

逐步升級由結果表離線算出（`simulate_invoice_ladder`）：依序累積各方法找到的 QR，湊滿兩個即停止，
與上線的 `locate_invoice_qrs` 逐張一致（測試 `test_invoice.py` 驗證）。

## 合成資料冒煙結果（不是結論）

2026-11-03，4 張合成發票 × 7 種劣化 × 4 級＋未劣化（116 張正樣本）與 1 張負樣本：

| 方法 | 正確率 | 部分 | 誤讀 |
| --- | ---: | ---: | ---: |
| `q0_raw`（zxing-cpp 原圖） | 57.8% | 4.3% | 0.0% |
| `sharpen` | 64.7% | 4.3% | 0.0% |
| `pipeline@clahe+binarize` | 62.1% | 4.3% | 0.0% |
| `denoise` | 50.9% | 4.3% | 0.0% |
| `q1_all_methods` 逐步升級 | 64.7% | 4.3% | 0.0% |
| `q2_raw_pyzbar` | 0.0% | 4.3% | 57.8% |

**pyzbar 不適用於發票**：ZBar 把右側 QR 的 Big5 位元組當成 Latin-1 再轉成 UTF-8 回傳，原始位元組必然不符，
因此 zxing-cpp 讀得到的影像在 pyzbar 一律為誤讀。這是解碼器的編碼轉換，不是影像問題；
`PyzbarDecoder` 的說明已註明。階段零只需比較能保留原始位元組的解碼器。

## 結論

（以真實發票完成階段零與正式實驗後填寫）
