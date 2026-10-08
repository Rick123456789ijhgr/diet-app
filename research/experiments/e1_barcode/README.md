# E1 條碼前處理消融（對應 RQ1）

## 目的

比較「無前處理」與逐步加入各項前處理時的條碼解碼成功率，依拍攝條件（距離、角度、光線、材質）分組呈現。

## 設定

`configs/` 中每個檔案是一組步驟組合，由少到多逐步加入：

| 設定 | 步驟 |
| --- | --- |
| step0 | （無） |
| step1 | gray |
| step2 | gray、adaptive_bin |
| step3 | gray、adaptive_bin、deskew |

## 結論

（實驗完成後填寫）
