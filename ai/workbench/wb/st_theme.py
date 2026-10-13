"""淺色／深色模式切換（左側欄底部的太陽／月亮）。

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

_SUN = (
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/>'
    '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6'
    'M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>'
)
_MOON = (
    '<svg viewBox="0 0 24 24" aria-hidden="true">'
    '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
)

# 上下排列的太陽／月亮，目前模式以白底圓鈕標示（左側欄使用）
_HTML = f"""
<div class="switch" role="group" aria-label="淺色／深色模式">
  <button class="opt" type="button" data-mode="light" aria-label="淺色">{_SUN}</button>
  <button class="opt" type="button" data-mode="dark" aria-label="深色">{_MOON}</button>
</div>
"""

_CSS = """
.switch {
  display: flex; flex-direction: column; gap: 4px; padding: 4px;
  border-radius: 999px; background: var(--st-secondary-background-color);
}
.opt {
  width: 34px; height: 34px; border: none; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer;
  background: transparent; color: var(--st-text-color); opacity: 0.55;
  transition: background 0.15s ease, opacity 0.15s ease;
}
.opt:hover { opacity: 1; }
.opt:focus-visible { outline: 2px solid var(--st-primary-color); outline-offset: 1px; }
.opt[aria-pressed="true"] {
  background: var(--st-background-color); opacity: 1; cursor: default;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.15);
}
.opt svg {
  width: 17px; height: 17px; fill: none; stroke: currentColor;
  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
}
.opt[data-mode="dark"] svg { fill: currentColor; stroke: none; }
"""

_JS = """
export default function (component) {
  const { data, parentElement } = component
  if (!data) return
  for (const btn of parentElement.querySelectorAll(".opt")) {
    const active = btn.dataset.mode === data.mode
    btn.setAttribute("aria-pressed", String(active))
    btn.title = active ? data.labels[btn.dataset.mode] : data.hint
    btn.onclick = () => {
      if (active) return
      const next = JSON.stringify(btn.dataset.mode === "dark" ? "Dark" : "Light")
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
            "labels": {"light": "淺色模式", "dark": "深色模式"},
            "hint": "切換淺色／深色模式（頁面會重新載入）",
        },
        width="content",
    )
