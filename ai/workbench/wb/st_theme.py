"""淺色／深色模式切換開關。

Streamlit 沒有以程式切換主題的 API；它把使用者在設定選單選的主題存在瀏覽器
localStorage 的 ``stActiveTheme-<頁面路徑>-v2``。這個開關寫入同一個鍵後重新整理頁面，
因此與原生設定選單完全一致，顏色仍由 ``.streamlit/config.toml`` 的
``[theme.light]``／``[theme.dark]`` 決定，不注入任何 CSS 到 app。

注意：鍵名屬於 Streamlit 前端的內部實作（已鎖定 streamlit==1.65.0）；升級時請確認仍有效。
重新整理會開啟新的工作階段，畫面上的輸入會回到預設值（參數表單除外，見 st_config）。
"""

from __future__ import annotations

from collections.abc import Sequence

import streamlit as st

_STORAGE_PREFIX = "stActiveTheme-"
_STORAGE_SUFFIX = "-v2"

_HTML = """
<button class="toggle" type="button" aria-label="切換深色模式">
  <span class="track"><span class="thumb">
    <svg class="sun" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2"/>
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2
               M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>
    </svg>
    <svg class="moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>
    </svg>
  </span></span>
  <span class="label"></span>
</button>
"""

_CSS = """
.toggle {
  display: inline-flex; align-items: center; gap: 0.55rem;
  padding: 0.3rem 0.75rem 0.3rem 0.35rem;
  border: 1px solid var(--st-border-color);
  border-radius: 999px;
  background: var(--st-secondary-background-color);
  color: var(--st-text-color);
  font: inherit; font-size: 0.85rem; cursor: pointer;
  transition: border-color 0.15s ease;
}
.toggle:hover { border-color: var(--st-primary-color); }
.toggle:focus-visible { outline: 2px solid var(--st-primary-color); outline-offset: 2px; }
.track {
  position: relative; width: 2.6rem; height: 1.4rem; border-radius: 999px;
  background: var(--st-border-color); transition: background 0.2s ease;
}
.thumb {
  position: absolute; top: 0.15rem; left: 0.15rem; width: 1.1rem; height: 1.1rem;
  border-radius: 50%; background: var(--st-background-color);
  display: grid; place-items: center; transition: transform 0.2s ease;
}
.thumb svg {
  width: 0.8rem; height: 0.8rem; fill: none;
  stroke: var(--st-text-color); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
}
.thumb .moon { display: none; fill: var(--st-text-color); stroke: none; }
.toggle[data-mode="dark"] .track { background: var(--st-primary-color); }
.toggle[data-mode="dark"] .thumb { transform: translateX(1.2rem); }
.toggle[data-mode="dark"] .sun { display: none; }
.toggle[data-mode="dark"] .moon { display: block; }
"""

_JS = """
export default function (component) {
  const { data, parentElement } = component
  const btn = parentElement.querySelector(".toggle")
  if (!btn || !data) return
  const isDark = data.mode === "dark"
  btn.dataset.mode = isDark ? "dark" : "light"
  btn.setAttribute("aria-pressed", String(isDark))
  btn.title = data.hint
  parentElement.querySelector(".label").textContent = isDark ? data.darkLabel : data.lightLabel
  btn.onclick = () => {
    const next = JSON.stringify(isDark ? "Light" : "Dark")
    const keys = new Set(
      [...(data.paths || []), window.location.pathname].map(
        (p) => data.prefix + p + data.suffix
      )
    )
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(data.prefix) && k.endsWith(data.suffix)) keys.add(k)
    }
    keys.forEach((k) => window.localStorage.setItem(k, next))
    window.location.reload()
  }
}
"""


def current_mode() -> str:
    """目前的主題：``"light"`` 或 ``"dark"``（無法取得時視為淺色）。"""
    mode = st.context.theme.type
    return "dark" if mode == "dark" else "light"


def theme_toggle(page_paths: Sequence[str]) -> None:
    """顯示淺色／深色切換開關。``page_paths`` 為各頁面的網址路徑，例如 ``["/", "/quality"]``。"""
    # 每次執行時登記（內容相同即覆寫），避免執行環境重建後找不到元件
    toggle = st.components.v2.component("wb_theme_toggle", html=_HTML, css=_CSS, js=_JS)
    toggle(
        key="wb.theme_toggle",
        data={
            "mode": current_mode(),
            "paths": list(page_paths),
            "prefix": _STORAGE_PREFIX,
            "suffix": _STORAGE_SUFFIX,
            "lightLabel": "淺色 · Light",
            "darkLabel": "深色 · Dark",
            "hint": "切換淺色／深色模式（頁面會重新載入）",
        },
        width="content",
    )
