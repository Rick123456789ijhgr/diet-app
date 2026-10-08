"""頁面版面的共用元件，讓各頁的標題、區塊與空狀態一致。"""

from __future__ import annotations

import streamlit as st


def page_header(zh: str, en: str, description: str, icon: str) -> None:
    """頁首：中文標題（含圖示）＋英文副標與一句用途說明。"""
    st.title(zh, anchor=False, icon=icon)
    st.caption(f"**{en}**　{description}")


def section(zh: str, en: str, icon: str | None = None) -> None:
    """區塊標題，例如「輸入影像 · Input」。"""
    st.subheader(f"{zh} · {en}", anchor=False, icon=icon)


def empty_state(message: str, icon: str = ":material/info:") -> None:
    """尚未有資料時的提示（較 st.info 輕量）。"""
    with st.container(border=True, horizontal_alignment="center"):
        st.markdown(f"{icon}　{message}", text_alignment="center")
