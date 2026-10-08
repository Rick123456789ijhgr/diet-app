"""飲食 APP 開發工作台（Diet app workbench）。

執行：在 ``ai/`` 下 ``streamlit run workbench/streamlit_app.py``（或 ``make workbench``、
雙擊根目錄 ``啟動工作台.bat``）。工作台只呼叫 ``dietai`` 套件，不複製處理邏輯；
新增模組時在下方 ``PAGES`` 加入頁面。
"""

from pathlib import Path

import streamlit as st

from wb.st_theme import theme_toggle

ASSETS = Path(__file__).parent / "assets"

st.set_page_config(
    page_title="開發工作台 · Workbench",
    page_icon=str(ASSETS / "icon.svg"),
    layout="wide",
)
st.logo(str(ASSETS / "logo.svg"), icon_image=str(ASSETS / "icon.svg"), size="large")

PAGES = {
    "": [
        st.Page("app_pages/home.py", title="總覽", icon=":material/home:", default=True),
    ],
    "模組一 影像前處理": [
        st.Page(
            "app_pages/quality.py",
            title="品質檢查 · Quality",
            icon=":material/image_search:",
            url_path="quality",
        ),
        st.Page(
            "app_pages/sweep.py",
            title="參數掃描 · Sweep",
            icon=":material/ssid_chart:",
            url_path="sweep",
        ),
        st.Page(
            "app_pages/batch.py",
            title="資料夾批次 · Batch",
            icon=":material/photo_library:",
            url_path="batch",
        ),
    ],
    "開發工具": [
        st.Page(
            "app_pages/dev_checks.py",
            title="測試與檢查 · Checks",
            icon=":material/fact_check:",
            url_path="checks",
        ),
    ],
}

page = st.navigation(PAGES, position="top")

with st.container(horizontal=True, vertical_alignment="center", key="wb-topbar"):
    st.caption("飲食 APP 研究系統 · 僅限本機開發使用")
    st.space("stretch")
    theme_toggle([f"/{p.url_path}" for group in PAGES.values() for p in group])

page.run()
