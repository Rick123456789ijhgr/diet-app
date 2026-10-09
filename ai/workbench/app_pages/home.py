import streamlit as st

from wb.configs import calibration_rows
from wb.st_layout import page_header, section

page_header(
    "開發工作台",
    "Workbench",
    "用合成影像或開發用照片測試各模組、調整參數、執行測試。數字全部來自 dietai。",
    ":material/biotech:",
)

TOOLS = [
    (
        "app_pages/quality.py",
        ":material/image_search:",
        "品質檢查",
        "Quality check",
        "單張影像：模擬退化、看分數與警告、檢視拉普拉斯響應與曝光遮罩。",
    ),
    (
        "app_pages/barcode.py",
        ":material/barcode_reader:",
        "條碼",
        "Barcode",
        "逐步升級解碼商品條碼與電子發票雙 QR，逐階檢視影像與耗時。",
    ),
    (
        "app_pages/sweep.py",
        ":material/ssid_chart:",
        "參數掃描",
        "Sweep",
        "讓一種退化由弱到強，找出指標越過門檻的位置。",
    ),
    (
        "app_pages/batch.py",
        ":material/photo_library:",
        "資料夾批次",
        "Batch",
        "整個資料夾的通過率與分數分布，點選列即可檢視單張。",
    ),
    (
        "app_pages/dev_checks.py",
        ":material/fact_check:",
        "測試與檢查",
        "Checks",
        "修改程式後在這裡跑 pytest、ruff、mypy。",
    ),
]

section("快速開始", "Quick start", ":material/rocket_launch:")
for col, (path, icon, zh, en, desc) in zip(st.columns(len(TOOLS)), TOOLS, strict=True):
    with col, st.container(border=True, height=210):
        st.markdown(f"#### {icon} {zh}")
        st.caption(f"**{en}**　{desc}")
        st.space("stretch")
        if st.button("開啟 · Open", key=f"home.open.{path}", icon=":material/arrow_forward:"):
            st.switch_page(path)

left, right = st.columns([3, 2], gap="large")
with left:
    section("模組進度", "Module status", ":material/timeline:")
    with st.container(border=True):
        for phase, name, status, color in [
            ("Phase 1", "共通品質檢查 · Quality check", "完成", "green"),
            ("Phase 2", "條碼與電子發票 QR · Barcode & invoice QR", "完成", "green"),
            ("Phase 3", "營養標示 · Nutrition label", "未開始", "gray"),
            ("Phase 4", "食物照片 · Food photo", "未開始", "gray"),
            ("Phase 5", "E1 實驗骨架 · E1 experiment", "未開始", "gray"),
        ]:
            with st.container(horizontal=True, vertical_alignment="center"):
                st.badge(status, color=color, width=72)  # type: ignore[arg-type]
                st.markdown(f"**{phase}**　{name}")
        st.caption("模組一 影像前處理 · 對照 docs/tasks/m1-preprocess.md")

with right:
    section("使用規則", "Ground rules", ":material/gavel:")
    with st.container(border=True):
        st.markdown(
            ":material/lock: **測試集鎖定**　拒絕讀取 `splits/test`；調門檻只用 train／dev。\n\n"
            ":material/science: **門檻待校準**　這裡調出的數值僅供觀察，"
            "改預設值請匯出 JSON、附校準依據後在 PR 修改 `config.py`。\n\n"
            ":material/calculate: **數字由程式決定**　分數全部來自 `dietai` 的確定性程式。"
        )

rows = calibration_rows()
with st.expander(f"待校準門檻 · Thresholds to calibrate（{len(rows)}）", icon=":material/science:"):
    st.caption("由各設定類別中標記 `calibrate=True` 的欄位自動列出。")
    st.dataframe(rows, hide_index=True, alt="所有待校準的設定欄位與預設值")
