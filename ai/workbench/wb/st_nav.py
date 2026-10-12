"""左側模組直欄與頂部頁面膠囊（Streamlit 元件）。資料來自 ``wb.nav``。

外觀在 ``wb/st_style.py``：``wb-rail`` 固定在畫面左側，``wb-top`` 是頁面頂部的膠囊列；
目前所在的項目以 ``wb-on-*`` 的 key 標示。
"""

from __future__ import annotations

from pathlib import Path

import streamlit as st
from streamlit.delta_generator import DeltaGenerator
from streamlit.navigation.page import StreamlitPage

from wb.nav import CHECKS, HOME, MODULES, Tool, all_tools, module_of
from wb.st_theme import theme_toggle

ICON = Path(__file__).resolve().parents[1] / "assets" / "icon.svg"


def pages() -> list[StreamlitPage]:
    """所有頁面的 ``st.Page``，交給 ``st.navigation``。"""
    return [
        st.Page(t.path, title=t.title, icon=t.icon, default=True)
        if t is HOME
        else st.Page(t.path, title=t.title, icon=t.icon, url_path=t.url_path)
        for t in all_tools()
    ]


def _item(key: str, active: bool) -> DeltaGenerator:
    return st.container(key=f"wb-{'on' if active else 'off'}-{key}", width="content")


def rail(current: str) -> None:
    """左側直欄：總覽、模組一到五、測試、深淺色。尚未實作的模組顯示為停用。"""
    module = module_of(current)
    with st.container(key="wb-rail", horizontal_alignment="center"):
        st.image(str(ICON), width=40, alt="")
        st.space(4)
        with _item("home", current == HOME.url_path):
            st.page_link(HOME.path, label=HOME.title, icon=HOME.icon, help="各模組進度與快速入口")
        for m in MODULES:
            with _item(m.key, m is module):
                st.page_link(
                    m.tools[0].path if m.ready else HOME.path,
                    label=m.short,
                    icon=m.icon,
                    help=m.title if m.ready else f"{m.title}（規劃中）",
                    disabled=not m.ready,
                )
        st.space("stretch")
        with _item("checks", current == CHECKS.url_path):
            st.page_link(CHECKS.path, label=CHECKS.title, icon=CHECKS.icon, help=CHECKS.desc)
        theme_toggle([f"/{t.url_path}" for t in all_tools()])


def _tab(tool: Tool, active: bool) -> None:
    with _item(f"tab-{tool.url_path}", active):
        st.page_link(tool.path, label=tool.title, icon=tool.icon, help=tool.desc)


def topbar(current: str) -> None:
    """頂部列：目前模組名稱與其頁面膠囊（各 Phase 在前、輔助工具在後）。"""
    module = module_of(current)
    with st.container(key="wb-top", horizontal=True, vertical_alignment="center", gap="small"):
        if module is None:
            st.markdown("**開發工作台**")
        else:
            st.markdown(f"**{module.short}**　{module.name}")
            phases = [t for t in module.tools if t.phase is not None]
            others = [t for t in module.tools if t.phase is None]
            with st.container(key="wb-tabs", horizontal=True, gap=None, width="content"):
                for t in phases:
                    _tab(t, t.url_path == current)
                if others:
                    st.html('<span class="wb-sep"></span>', width="content")
                for t in others:
                    _tab(t, t.url_path == current)
