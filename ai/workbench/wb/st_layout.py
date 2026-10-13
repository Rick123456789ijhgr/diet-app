"""頁面版面的共用元件，讓各頁的標題、工作區、卡片與空狀態一致。

工具頁的標準版面（``workspace``）：

    ┌ 頁首：標題｜Phase｜一句說明 ───────────── 右側選項 ┐
    ├ 控制面板（固定寬、可捲動）┬ 結果（可捲動） ──────────┤
    │ 分頁：影像／參數／匯出入  │ 狀態列、指標列、檢視切換   │

兩欄高度都固定在一個畫面內、各自捲動，調參數時結果一直在旁邊，不必捲動整頁。
"""

from __future__ import annotations

from typing import Any

import streamlit as st
from streamlit.delta_generator import DeltaGenerator

_CARD_SEQ = "_wb.card_seq"
PANEL_WIDTH = 360  # 控制面板寬度（px）；參數以兩欄排列


def reset_cards() -> None:
    """每次執行頁面前重設卡片編號（由 streamlit_app 呼叫）。"""
    st.session_state[_CARD_SEQ] = 0


def card(**kwargs: Any) -> DeltaGenerator:
    """白底圓角卡片（``st.container(border=True)``）。

    Streamlit 的外框容器沒有可供 CSS 辨識的屬性，因此每張卡片帶一個 ``wbcard-N`` 的 key，
    讓 ``wb/st_style.py`` 以 ``.st-key-wbcard-*`` 套用卡片外觀。容器的 key 不保存狀態，
    編號只需在同一次執行內唯一。
    """
    seq = st.session_state.get(_CARD_SEQ, 0) + 1
    st.session_state[_CARD_SEQ] = seq
    return st.container(border=True, key=f"wbcard-{seq}", **kwargs)


def page_header(
    title: str, description: str, icon: str, phase: int | None = None
) -> DeltaGenerator:
    """一行頁首：標題、Phase 標記、一句說明；回傳右側的空位，可放模式切換等選項。"""
    with st.container(
        key="wb-head", horizontal=True, vertical_alignment="center", gap="small", wrap=False
    ):
        st.title(title, anchor=False, icon=icon, width="content")
        if phase is not None:
            st.badge(f"Phase {phase}", color="violet")
        st.caption(description)
        slot = st.container(horizontal=True, width="content", horizontal_alignment="right")
    return slot


def workspace() -> tuple[DeltaGenerator, DeltaGenerator]:
    """左右兩欄的工作區：回傳（控制面板, 結果區）。兩欄高度固定為一個畫面、各自捲動。"""
    with st.container(horizontal=True, gap="medium", wrap=False):
        panel = st.container(key="wb-panel", width=PANEL_WIDTH)
        result = st.container(key="wb-result")
    return panel, result


def panel_tabs(*labels: str) -> list[DeltaGenerator]:
    """控制面板頂部的分頁（固定在面板頂端）。"""
    return list(st.tabs(list(labels)))


def section(title: str, icon: str | None = None) -> None:
    """區塊標題，例如「輸入影像」。"""
    st.subheader(title, anchor=False, icon=icon)


def status_line(ok: bool, text: str, detail: str, warn: bool = False) -> DeltaGenerator:
    """結果區頂端的狀態列：圖示＋結論、細節說明；回傳右側放 badge 的空位。"""
    if ok:
        mark = ":green[:material/check_circle:]"
    elif warn:
        mark = ":orange[:material/warning:]"
    else:
        mark = ":red[:material/cancel:]"
    with (
        card(),
        st.container(horizontal=True, vertical_alignment="center", gap="small", wrap=False),
    ):
        st.markdown(f"**{mark} {text}**", width="content")
        st.caption(detail)
        slot = st.container(horizontal=True, width="content", gap="small")
    return slot


def metric_row() -> DeltaGenerator:
    """一排等寬的指標卡。"""
    return st.container(horizontal=True, gap="small", wrap=False)


def empty_state(message: str, icon: str = ":material/info:") -> None:
    """尚未有資料時的提示（較 st.info 輕量）。"""
    with card(horizontal_alignment="center"):
        st.markdown(f"{icon}　{message}", text_alignment="center")
