"""飲食 APP 開發工作台（Diet app workbench）。

執行：在 ``ai/`` 下 ``streamlit run workbench/streamlit_app.py``（或 ``make workbench``、
雙擊根目錄 ``啟動工作台.bat``）。工作台只呼叫 ``dietai`` 套件，不複製處理邏輯。

版面：左側直欄切換研究模組，頂部膠囊切換模組內的頁面（各 Phase 與輔助工具）。
新增頁面或模組請改 ``wb/nav.py`` 的註冊表，導覽與總覽頁會自動更新。
"""

from pathlib import Path

import streamlit as st

from wb.st_layout import reset_cards
from wb.st_nav import pages, rail, topbar
from wb.st_style import apply_style

ASSETS = Path(__file__).parent / "assets"

st.set_page_config(
    page_title="開發工作台",
    page_icon=str(ASSETS / "icon.svg"),
    layout="wide",
    initial_sidebar_state="collapsed",
)
apply_style()

page = st.navigation(pages(), position="hidden")
rail(page.url_path)
topbar(page.url_path)

reset_cards()
page.run()
