"""依設定 dataclass 的 ``ParamInfo`` 自動產生參數面板。

- 依 ``ParamInfo.group`` 分組收合，分組標題顯示已修改的欄位數。
- 數值跨頁保存（session state），且與預設值不同的欄位同步到網址參數，
  切換深色模式（重新整理）後仍保留，也可以直接分享網址重現設定。
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import fields
from typing import Any, TypeVar

import streamlit as st

from dietai.preprocess.config import ParamInfo, param_info
from wb.configs import (
    changed_fields,
    config_from_json,
    config_python,
    config_to_dict,
    config_to_json,
)
from wb.text import group_label

C = TypeVar("C")


def _widget_key(prefix: str, name: str) -> str:
    return f"cfg.{prefix}.{name}"


def _query_key(prefix: str, name: str) -> str:
    return f"{prefix}.{name}"


def _store(prefix: str) -> dict[str, Any]:
    """跨頁保存的參數值。元件的 session state 在離開頁面時會被清除，這裡另外保存。"""
    store: dict[str, Any] = st.session_state.setdefault(f"cfgstore.{prefix}", {})
    return store


def _set_values(prefix: str, values: dict[str, Any]) -> None:
    _store(prefix).update(values)
    for name, value in values.items():
        st.session_state[_widget_key(prefix, name)] = value


def _from_query(prefix: str, default: Any) -> dict[str, Any]:
    """讀取網址參數中的設定值；格式錯誤的值略過。"""
    values: dict[str, Any] = {}
    for f in fields(default):
        raw = st.query_params.get(_query_key(prefix, f.name))
        if raw is None:
            continue
        kind = type(getattr(default, f.name))
        try:
            values[f.name] = raw.lower() in ("1", "true") if kind is bool else kind(raw)
        except ValueError:
            continue
    return values


def _sync_query(prefix: str, cfg: Any) -> None:
    changed = set(changed_fields(cfg))
    for f in fields(cfg):
        key = _query_key(prefix, f.name)
        if f.name in changed:
            value = str(getattr(cfg, f.name))
            if st.query_params.get(key) != value:
                st.query_params[key] = value
        elif key in st.query_params:
            del st.query_params[key]


def _on_import(cls: type[Any], prefix: str, uploader_key: str) -> None:
    uploaded = st.session_state.get(uploader_key)
    if uploaded is None:
        return
    try:
        cfg = config_from_json(cls, uploaded.getvalue().decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError) as exc:
        st.session_state[f"{uploader_key}.error"] = str(exc)
        return
    st.session_state.pop(f"{uploader_key}.error", None)
    _set_values(prefix, config_to_dict(cfg))
    st.toast("已匯入設定 · Config imported", icon=":material/check_circle:")


def _field_widget(prefix: str, name: str, info: ParamInfo, default_value: Any) -> Any:
    key = _widget_key(prefix, name)
    # 側欄較窄：標籤只放中文，英文名稱放在說明第一行
    label = info.label
    if info.calibrate:
        label += " :orange[◆]"
    help_text = f"**{info.label_en}**　`{name}`　預設 {default_value!r}\n\n{info.help}"
    if info.calibrate:
        help_text += "\n\n◆ 待校準：數值須以標記照片校準。"
    if isinstance(default_value, bool):
        return st.toggle(label, key=key, help=help_text)
    if isinstance(default_value, int):
        return int(
            st.number_input(
                label,
                min_value=None if info.min is None else int(info.min),
                max_value=None if info.max is None else int(info.max),
                step=int(info.step or 1),
                key=key,
                help=help_text,
            )
        )
    return float(
        st.number_input(
            label,
            min_value=info.min,
            max_value=info.max,
            step=info.step,
            key=key,
            help=help_text,
            format="%.4g",
        )
    )


def config_editor(cls: type[C], prefix: str) -> C | None:
    """顯示 ``cls`` 的參數面板，回傳建立好的設定；數值不合法時顯示錯誤並回傳 ``None``。"""
    default = cls()
    infos = param_info(cls)
    store = _store(prefix)
    if not store:
        store.update(_from_query(prefix, default))
    for f in fields(default):  # type: ignore[arg-type]
        st.session_state.setdefault(
            _widget_key(prefix, f.name), store.get(f.name, getattr(default, f.name))
        )

    groups: dict[str, list[str]] = defaultdict(list)
    for f in fields(default):  # type: ignore[arg-type]
        groups[infos[f.name].group if f.name in infos else ""].append(f.name)

    n_changed = sum(
        st.session_state[_widget_key(prefix, f.name)] != getattr(default, f.name)
        for f in fields(default)  # type: ignore[arg-type]
    )
    with st.container(horizontal=True, vertical_alignment="center"):
        st.markdown(f"**{cls.__name__}**")
        if n_changed:
            st.badge(f"已修改 {n_changed}", color="orange")
        st.space("stretch")
        st.button(
            "還原",
            icon=":material/restart_alt:",
            type="tertiary",
            help="全部還原為預設值 · Reset to defaults",
            on_click=_set_values,
            args=(prefix, config_to_dict(default)),
            key=f"cfg.{prefix}.reset",
            disabled=not n_changed,
        )

    values: dict[str, Any] = {}
    for group, names in groups.items():
        title, icon = group_label(group)
        changed_here = sum(
            st.session_state[_widget_key(prefix, n)] != getattr(default, n) for n in names
        )
        if changed_here:
            title += f"　:orange-badge[已修改 {changed_here}]"
        with st.expander(title, expanded=True, icon=icon, key=f"cfg.{prefix}.group.{group}"):
            for name in names:
                info = infos.get(name)
                if info is None:
                    values[name] = st.session_state[_widget_key(prefix, name)]
                    st.caption(f"{name} = {values[name]!r}")
                    continue
                values[name] = _field_widget(prefix, name, info, getattr(default, name))
    st.caption(":orange[◆] 待校準的門檻 · To be calibrated")

    store.update(values)
    try:
        cfg = cls(**values)
    except ValueError as exc:
        st.error(f"參數不合法：{exc}", icon=":material/error:")
        return None
    _sync_query(prefix, cfg)
    return cfg


def config_io(cfg: Any, cls: type[Any], prefix: str) -> None:
    """匯出（JSON 下載、Python 程式碼）與匯入設定。"""
    st.download_button(
        "下載 JSON · Download",
        data=config_to_json(cfg),
        file_name=f"{cls.__name__}.json",
        mime="application/json",
        icon=":material/download:",
        key=f"cfg.{prefix}.download",
        width="stretch",
    )
    st.caption("與預設值不同的欄位 · Changed fields")
    st.code(config_python(cfg), language="python", wrap_lines=True)
    uploader_key = f"cfg.{prefix}.import"
    st.file_uploader(
        "匯入 JSON · Import",
        type=["json"],
        key=uploader_key,
        on_change=_on_import,
        args=(cls, prefix, uploader_key),
    )
    if err := st.session_state.get(f"{uploader_key}.error"):
        st.error(f"匯入失敗：{err}", icon=":material/error:")


def config_sidebar(cls: type[C], prefix: str) -> C | None:
    """把參數面板與匯入匯出放進側欄；各頁面共用。"""
    with st.sidebar:
        st.subheader("參數 · Parameters", anchor=False, icon=":material/tune:")
        cfg = config_editor(cls, prefix)
        if cfg is not None:
            with st.expander("匯入／匯出 · Import / export", icon=":material/swap_vert:"):
                config_io(cfg, cls, prefix)
    return cfg
