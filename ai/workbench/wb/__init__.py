"""工作台的輔助模組。

不含 ``st_`` 前綴的模組為純邏輯，不 import streamlit，可直接以 pytest 測試；
``st_`` 開頭的模組是可重用的 Streamlit 介面元件。
處理邏輯一律呼叫 ``dietai``，這裡只做輸入輸出、視覺化與介面。
"""
