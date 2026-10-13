from datetime import datetime

import streamlit as st

from dietai.devtools.configs import calibration_rows
from wb.nav import MODULES
from wb.st_layout import card, metric_row, page_header, section

hour = datetime.now().hour
greeting = "早安" if 5 <= hour < 11 else "午安" if 11 <= hour < 18 else "晚安"
page_header(
    f"{greeting}，歡迎回到開發工作台",
    "用合成影像或開發用照片測試各模組、調整參數、執行測試。數字全部來自 dietai。",
    ":material/space_dashboard:",
)

rows = calibration_rows()
phases = [p for m in MODULES for p in m.phases]
done = sum(p.done for p in phases)
active = [m for m in MODULES if m.ready]

with metric_row():
    with st.container(key="wb-hero"):
        st.metric(
            "Phase 完成",
            f"{done} / {len(phases)}",
            delta="、".join(m.short for m in active) or "尚未開始",
            delta_color="off",
            delta_arrow="off",
            border=True,
        )
    st.metric(
        "研究模組",
        f"{len(active)} / {len(MODULES)}",
        delta="已有工作台頁面",
        delta_color="off",
        delta_arrow="off",
        border=True,
    )
    st.metric(
        "待校準門檻",
        str(len(rows)),
        delta="只用 train／dev 校準",
        delta_color="off",
        delta_arrow="off",
        border=True,
    )
    st.metric(
        "測試集", "鎖定", delta="splits/test", delta_color="off", delta_arrow="off", border=True
    )

left, right = st.columns([2, 1], gap="medium")

with left, card():
    section("研究模組", ":material/view_module:")
    for m in MODULES:
        with st.container(horizontal=True, vertical_alignment="center", gap="small"):
            st.markdown(f"{m.icon} **{m.short}**　{m.name}", width="content")
            if m.ready:
                n_done = sum(p.done for p in m.phases)
                st.badge(
                    f"Phase {n_done} / {len(m.phases)}",
                    color="green" if n_done == len(m.phases) else "blue",
                )
            else:
                st.badge("規劃中", color="gray")
            st.caption(m.scope)
        if m.tools:
            with st.container(horizontal=True, gap="small"):
                for t in m.tools:
                    label = t.title if t.phase is None else f"P{t.phase} {t.title}"
                    st.page_link(t.path, label=label, icon=t.icon, help=t.desc)
        if m.task_doc:
            st.caption(f"任務書：`{m.task_doc}`")

with right, card():
    section("使用規則", ":material/gavel:")
    st.markdown(
        ":material/lock: **測試集鎖定**　拒絕讀取 `splits/test`；調門檻只用 train／dev。\n\n"
        ":material/science: **門檻待校準**　這裡調出的數值僅供觀察，"
        "改預設值請匯出 JSON、附校準依據後在 PR 修改 `config.py`。\n\n"
        ":material/calculate: **數字由程式決定**　分數全部來自 `dietai` 的確定性程式。"
    )
    with st.popover(f"待校準門檻（{len(rows)}）", icon=":material/science:", width="stretch"):
        st.caption("由各設定類別中標記 `calibrate=True` 的欄位自動列出。")
        st.dataframe(rows, hide_index=True, alt="所有待校準的設定欄位與預設值")
