"""依設定 dataclass 的 ``ParamInfo`` 自動產生參數面板。

- 依 ``ParamInfo.group`` 分組收合，分組標題顯示已修改的欄位數。
- 數值跨頁保存（session state），且與預設值不同的欄位同步到網址參數，
  切換深色模式（重新整理）後仍保留，也可以直接分享網址重現設定。
- 只處理以 ``param()`` 宣告的純量欄位；序列等其他欄位（如 ``LadderConfig.rungs``）
  由頁面自行提供元件，以 ``extra_keys``（欄位名稱 → 元件的 session state 鍵）登記，
  建立設定時讀取其值，匯入 JSON 與「還原」時也會寫回這些元件。
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from typing import Any, TypeVar

import streamlit as st

from dietai.devtools.configs import (
    changed_fields,
    config_from_json,
    config_python,
    config_to_dict,
    config_to_json,
)
from dietai.preprocess.config import ParamInfo, param_info
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
    for name in param_info(type(default)):
        raw = st.query_params.get(_query_key(prefix, name))
        if raw is None:
            continue
        kind = type(getattr(default, name))
        try:
            values[name] = raw.lower() in ("1", "true") if kind is bool else kind(raw)
        except ValueError:
            continue
    return values


def _sync_query(prefix: str, cfg: Any) -> None:
    changed = set(changed_fields(cfg))
    for name in param_info(type(cfg)):
        key = _query_key(prefix, name)
        if name in changed:
            value = str(getattr(cfg, name))
            if st.query_params.get(key) != value:
                st.query_params[key] = value
        elif key in st.query_params:
            del st.query_params[key]


def _set_extras(extra_keys: Mapping[str, str], cfg: Any) -> None:
    """把設定中的非 ``param()`` 欄位寫回頁面元件（多選元件需要串列）。"""
    for name, key in extra_keys.items():
        value = getattr(cfg, name)
        st.session_state[key] = list(value) if isinstance(value, tuple) else value


def _reset(cls: type[Any], prefix: str, extra_keys: Mapping[str, str]) -> None:
    default = cls()
    _set_values(prefix, {name: getattr(default, name) for name in param_info(cls)})
    _set_extras(extra_keys, default)


def _extra_changed(default: Any, extra_keys: Mapping[str, str]) -> int:
    count = 0
    for name, key in extra_keys.items():
        value, base = st.session_state.get(key), getattr(default, name)
        if value is not None and (tuple(value) if isinstance(base, tuple) else value) != base:
            count += 1
    return count


def _on_import(
    cls: type[Any], prefix: str, uploader_key: str, extra_keys: Mapping[str, str]
) -> None:
    uploaded = st.session_state.get(uploader_key)
    if uploaded is None:
        return
    try:
        cfg = config_from_json(cls, uploaded.getvalue().decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError) as exc:
        st.session_state[f"{uploader_key}.error"] = str(exc)
        return
    st.session_state.pop(f"{uploader_key}.error", None)
    _set_values(prefix, {k: v for k, v in config_to_dict(cfg).items() if k in param_info(cls)})
    _set_extras(extra_keys, cfg)
    st.toast("已匯入設定", icon=":material/check_circle:")


def _field_widget(prefix: str, name: str, info: ParamInfo, default_value: Any) -> Any:
    key = _widget_key(prefix, name)
    # 面板較窄：標籤只放中文，英文名稱放在說明第一行
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


def config_editor(
    cls: type[C], prefix: str, extra_keys: Mapping[str, str] | None = None
) -> C | None:
    """顯示 ``cls`` 的參數面板，回傳建立好的設定；數值不合法時顯示錯誤並回傳 ``None``。

    ``extra_keys`` 為非 ``param()`` 欄位 → 頁面元件的 session state 鍵（例如階梯順序）。
    這些欄位不在面板中顯示，但會併入建立的設定、匯出內容與「已修改」計數；
    頁面須在呼叫本函式之前先畫出這些元件。
    """
    extra_keys = extra_keys or {}
    default = cls()
    infos = param_info(cls)
    store = _store(prefix)
    if not store:
        store.update(_from_query(prefix, default))
    for name in infos:
        st.session_state.setdefault(
            _widget_key(prefix, name), store.get(name, getattr(default, name))
        )

    groups: dict[str, list[str]] = defaultdict(list)
    for name, info in infos.items():
        groups[info.group].append(name)

    n_changed = sum(
        st.session_state[_widget_key(prefix, name)] != getattr(default, name) for name in infos
    ) + _extra_changed(default, extra_keys)
    with st.container(horizontal=True, vertical_alignment="center"):
        st.markdown(f"**{cls.__name__}**")
        if n_changed:
            st.badge(f"已修改 {n_changed}", color="orange")
        st.space("stretch")
        st.button(
            "還原",
            icon=":material/restart_alt:",
            type="tertiary",
            help="全部還原為預設值",
            on_click=_reset,
            args=(cls, prefix, extra_keys),
            key=f"cfg.{prefix}.reset",
            disabled=not n_changed,
        )

    values: dict[str, Any] = {}
    for group, names in groups.items():
        title, icon = group_label(group)
        changed_here = sum(
            st.session_state[_widget_key(prefix, n)] != getattr(default, n) for n in names
        )
        with st.container(key=f"wb-group-{prefix}-{group or 'other'}", gap="small"):
            head = f"{icon} **{title}**"
            if changed_here:
                head += f"　:orange-badge[已修改 {changed_here}]"
            st.markdown(head)
            # 逐列兩欄排列；開關類欄位放在最後，避免與數字欄位錯位
            ordered = sorted(names, key=lambda n: isinstance(getattr(default, n), bool))
            for i in range(0, len(ordered), 2):
                cols = st.columns(2, gap="small", vertical_alignment="bottom")
                for col, name in zip(cols, ordered[i : i + 2], strict=False):
                    with col:
                        values[name] = _field_widget(
                            prefix, name, infos[name], getattr(default, name)
                        )
    if any(info.calibrate for info in infos.values()):
        st.caption(":orange[◆] 待校準的門檻")

    store.update(values)
    extras = {n: st.session_state[k] for n, k in extra_keys.items() if k in st.session_state}
    try:
        cfg = cls(**values, **extras)
    except ValueError as exc:
        st.error(f"參數不合法：{exc}", icon=":material/error:")
        return None
    _sync_query(prefix, cfg)
    return cfg


def _export(cfg: Any, cls: type[Any], prefix: str) -> None:
    st.download_button(
        "下載 JSON",
        data=config_to_json(cfg),
        file_name=f"{cls.__name__}.json",
        mime="application/json",
        icon=":material/download:",
        key=f"cfg.{prefix}.download",
        width="stretch",
    )
    st.caption("與預設值不同的欄位（可貼進 PR）")
    st.code(config_python(cfg), language="python", wrap_lines=True)


def config_io(
    cfg: Any, cls: type[Any], prefix: str, extra_keys: Mapping[str, str] | None = None
) -> None:
    """匯出（JSON 下載、Python 程式碼）與匯入設定。``extra_keys`` 見 ``config_editor``。

    ``cfg`` 為 ``None``（參數不合法）時只提供匯入。
    """
    st.markdown(f"**{cls.__name__}**")
    if cfg is None:
        st.caption("參數不合法，修正後才能匯出。")
    else:
        _export(cfg, cls, prefix)
    uploader_key = f"cfg.{prefix}.import"
    st.file_uploader(
        "匯入 JSON",
        type=["json"],
        key=uploader_key,
        on_change=_on_import,
        args=(cls, prefix, uploader_key, extra_keys or {}),
    )
    if err := st.session_state.get(f"{uploader_key}.error"):
        st.error(f"匯入失敗：{err}", icon=":material/error:")
