"""開發工具共用的純邏輯（供工作台 gRPC 服務使用）。

設定結構與覆寫驗證、模擬退化、影像讀寫與測試集防護、診斷影像、暫存影像。
只在開發模式使用；不含任何介面框架或 gRPC 依賴。

各模組：
- ``configs``：設定覆寫的驗證（``config_from_override``）
- ``schema``：由 ``config.param()`` 宣告產生表單結構
- ``degradations``：模擬退化參數與參數掃描的維度
- ``images``：影像解碼／編碼與測試集鎖定（``guard_path``）
- ``store``：記憶體暫存影像（LRU）
- ``scenes``：合成影像與真值
- ``views``：診斷影像
- ``batch``：資料夾批次品質檢查
- ``sweep``、``ladder_eval``：參數掃描與條碼逐步升級的成功率
- ``e1``：E1 條碼消融的結果讀取與快速執行

gRPC 外殼在 ``server/workbench.py``；處理邏輯一律呼叫 ``preprocess``、``synthetic``、
``evaluation``，不在這裡複製。
"""
