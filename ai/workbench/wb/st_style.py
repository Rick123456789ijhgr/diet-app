"""工作台的版面外觀：左側模組直欄、頂部頁面膠囊、灰色畫布上的白色卡片、一個畫面內的雙欄工作區。

顏色、字型、字級、圓角等主題值放在 ``.streamlit/config.toml``；這裡只補 config 做不到的版面效果：

- 左側直欄 ``wb-rail`` 固定在畫面左側（圖示在上、文字在下），頂部膠囊 ``wb-tabs``
- 目前所在的項目（key 為 ``wb-on-*``）以深色膠囊標示
- 畫布與卡片分層（主題只有一個 ``backgroundColor``，卡片與畫布同色）
- 工作區 ``wb-panel``／``wb-result`` 高度固定為一個畫面、各自捲動
- 指標卡、標題、元件間距等較緊湊的尺寸
- 載入中文字型 Noto Sans TC（config 的 ``font`` 只能指定一個字型來源，那裡放 Inter）

選擇器只用 Streamlit 公開的 ``data-testid`` 與 ``.st-key-*``（由 ``key=`` 產生）；
卡片以 ``wb.st_layout.card`` 建立。升級 Streamlit 後請以工作台目視確認兩種模式。
"""

from __future__ import annotations

import streamlit as st

from wb.st_theme import current_mode

# 畫布、卡片、深色膠囊（目前項目）等主題沒有的顏色；其餘沿用 config.toml。
_PALETTE = {
    "light": {
        "canvas": "#F1F3F7",
        "card": "#FFFFFF",
        "card_border": "#E7EAF0",
        "shadow": "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 14px -6px rgba(15, 23, 42, 0.08)",
        "ink": "#0F172A",
        "ink_text": "#FFFFFF",
        "muted": "#64748B",
        "hover": "#F3F4F8",
    },
    "dark": {
        "canvas": "#0B0D12",
        "card": "#151922",
        "card_border": "#232838",
        "shadow": "0 1px 2px rgba(0, 0, 0, 0.4)",
        "ink": "#E6E9F2",
        "ink_text": "#0B0D12",
        "muted": "#94A3B8",
        "hover": "#1E2330",
    },
}

_HERO = "linear-gradient(135deg, #4F46E5 0%, #6D3FE6 55%, #8B5CF6 100%)"
_FONT_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap"

# 版面尺寸（px）
_RAIL_W = 84  # 左側直欄寬
_GUTTER = 12  # 直欄與畫面邊緣的距離
_PANE_OFFSET = 128  # 工作區以外（頂部列、頁首、邊距）佔用的高度

_CSS = """
@import url("{font_url}");

/* ── 畫布與 Streamlit 頂列 ── */
.stApp {{ background: {canvas}; }}
[data-testid="stHeader"] {{ background: transparent; pointer-events: none; height: 2.75rem; }}
[data-testid="stToolbar"] {{ pointer-events: auto; }}
[data-testid="stMainBlockContainer"] {{
  max-width: none;
  padding: 10px 56px 12px {main_left}px;
}}
.stMain [data-testid="stVerticalBlock"] {{ gap: 0.6rem; }}

/* ── 卡片 ── */
[class*="st-key-wbcard-"], [data-testid="stMetric"], .st-key-wb-panel,
[data-testid="stExpander"] > details {{
  background: {card};
  border: 1px solid {card_border} !important;
  border-radius: 16px !important;
  box-shadow: {shadow};
}}
[class*="st-key-wbcard-"] {{ padding: 0.8rem 1rem !important; }}

/* ── 指標卡 ── */
[data-testid="stMetric"] {{
  padding: 0.55rem 0.85rem !important; min-width: 0; min-height: 5.6rem;
}}
[data-testid="stMetricLabel"] p {{ font-size: 0.78rem; color: {muted}; }}
[data-testid="stMetricValue"] {{
  font-size: 1.35rem; font-weight: 600; line-height: 1.35;
  letter-spacing: -0.01em; font-variant-numeric: tabular-nums;
}}
[data-testid="stMetricValue"] > div {{
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}}
[data-testid="stMetricDelta"] {{ font-size: 0.75rem; }}
.st-key-wb-hero [data-testid="stMetric"] {{
  background: {hero}; border: none !important;
  box-shadow: 0 10px 24px -12px rgba(79, 70, 229, 0.7);
}}
.st-key-wb-hero [data-testid="stMetric"] * {{ color: #FFFFFF !important; }}

/* ── 左側模組直欄 ── */
.st-key-wb-rail {{
  position: fixed; z-index: 999991;
  top: {gutter}px; bottom: {gutter}px; left: {gutter}px; width: {rail_w}px;
  padding: 14px 6px; gap: 6px !important;
  background: {card}; border: 1px solid {card_border}; border-radius: 22px; box-shadow: {shadow};
  overflow-y: auto; scrollbar-width: none;
}}
.st-key-wb-rail [data-testid="stPageLink"] a {{
  flex-direction: column; gap: 3px; width: 68px; padding: 8px 2px 7px; margin: 0;
  border-radius: 14px; justify-content: center; text-align: center;
}}
.st-key-wb-rail [data-testid="stPageLink"] a p {{ font-size: 0.75rem; line-height: 1.2; }}
.st-key-wb-rail [data-testid="stPageLink"] [data-testid="stIconMaterial"] {{
  font-size: 1.35rem;
}}

/* ── 頂部列與頁面膠囊 ── */
.st-key-wb-top {{ min-height: 44px; }}
.st-key-wb-tabs {{
  background: {card}; border: 1px solid {card_border}; border-radius: 999px;
  padding: 3px; gap: 2px !important; box-shadow: {shadow}; align-items: center;
}}
.st-key-wb-tabs [data-testid="stPageLink"] a {{
  border-radius: 999px; padding: 5px 13px; margin: 0;
}}
.st-key-wb-tabs [data-testid="stPageLink"] a p {{ font-size: 0.85rem; }}
.st-key-wb-tabs .wb-sep {{
  display: block; width: 1px; height: 18px; margin: 0 4px; background: {card_border};
}}
[class*="st-key-wb-on-"] [data-testid="stPageLink"] a {{ background: {ink} !important; }}
[class*="st-key-wb-on-"] [data-testid="stPageLink"] a * {{ color: {ink_text} !important; }}
[class*="st-key-wb-off-"] [data-testid="stPageLink"] a:hover {{ background: {hover}; }}

/* ── 頁首（一行） ── */
.st-key-wb-head h1 {{ white-space: nowrap; padding: 0; }}
.st-key-wb-head [data-testid="stCaptionContainer"] {{
  min-width: 0; flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}}

/* ── 工作區：一個畫面高、各自捲動 ── */
.st-key-wb-panel, .st-key-wb-result {{
  height: calc(100vh - {pane_offset}px) !important; min-height: 420px;
  overflow-y: auto !important; overflow-x: hidden; scrollbar-width: thin;
  flex: 0 0 auto !important; flex-wrap: nowrap !important; justify-content: flex-start;
}}
.st-key-wb-panel {{ padding: 0 0.9rem 0.8rem !important; }}
.st-key-wb-result {{ padding-right: 4px; }}
.st-key-wb-panel [data-testid="stTabs"] [role="tablist"] {{
  position: sticky; top: 0; z-index: 3; background: {card}; padding-top: 0.4rem;
}}
.st-key-wb-panel h3 {{ font-size: 0.9rem; }}
[class*="st-key-wb-group-"] {{ padding-top: 0.5rem; border-top: 1px dashed {card_border}; }}
.st-key-wb-result [data-testid="stImage"] img {{
  max-height: calc(100vh - {image_offset}px); width: auto !important; max-width: 100%;
  object-fit: contain; margin: 0 auto; display: block;
}}
"""


def apply_style() -> None:
    """依目前的淺色／深色模式注入版面樣式；每次執行都要呼叫。"""
    colors = _PALETTE[current_mode()]
    css = _CSS.format(
        font_url=_FONT_URL,
        hero=_HERO,
        rail_w=_RAIL_W,
        gutter=_GUTTER,
        main_left=_RAIL_W + _GUTTER * 3,
        pane_offset=_PANE_OFFSET,
        image_offset=_PANE_OFFSET + 290,
        **colors,
    )
    st.html(f"<style>{css}</style>")
