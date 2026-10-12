"""條碼逐步升級的共用元件：階梯順序、多尺度倍率、解碼器選擇與參數面板（Streamlit 元件）。"""

from __future__ import annotations

import streamlit as st

from dietai.preprocess import (
    CodeFormat,
    Decoder,
    LadderConfig,
    PyzbarDecoder,
    Rung,
    ZxingConfig,
    ZxingDecoder,
)
from wb.st_config import config_editor
from wb.text import rung_label

SCALE_OPTIONS = (0.25, 0.5, 0.75, 1.5, 2.0, 3.0, 4.0)
ENGINES = {"zxing": "zxing-cpp（預設）", "pyzbar": "pyzbar（對照）"}


def ladder_controls(key: str) -> dict[str, str]:
    """畫出階梯順序與多尺度倍率；回傳 ``extra_keys``，交給 ``ladder_params``。

    元件值存在 ``{key}.rungs``、``{key}.scales``、``{key}.formats``；
    匯入 JSON 或「還原」時由參數面板寫回。
    """
    keys = {
        "rungs": f"{key}.rungs",
        "scales": f"{key}.scales",
        "accept_formats": f"{key}.formats",
    }
    default = LadderConfig()
    st.session_state.setdefault(keys["rungs"], list(default.rungs))
    st.session_state.setdefault(keys["scales"], list(default.scales))
    st.session_state.setdefault(keys["accept_formats"], list(default.accept_formats))
    st.multiselect(
        "嘗試順序",
        list(Rung),
        format_func=rung_label,
        key=keys["rungs"],
        help="依選取順序嘗試；先清空再依序點選即可調整順序。最終順序由 E1 實驗決定。",
    )
    # 匯入的倍率可能不在預設選項中，併入選項以免多選元件出錯
    options = sorted({*SCALE_OPTIONS, *st.session_state[keys["scales"]]})
    st.multiselect(
        "多尺度倍率",
        options,
        format_func=lambda f: f"×{f:g}",
        key=keys["scales"],
        help="多尺度階依序嘗試的縮放倍率。",
    )
    st.multiselect(
        "採用格式",
        [f for f in CodeFormat if f is not CodeFormat.OTHER],
        key=keys["accept_formats"],
        placeholder="全部格式",
        help="空白為全部採用；其他格式的結果視為不採用（例如斜拍 EAN-13 被誤讀成 UPC-E）。"
        "電子發票模式不受此限制。",
    )
    return keys


def engine_control(key: str) -> str:
    """解碼器選擇（zxing／pyzbar）。"""
    engine = st.segmented_control(
        "解碼器",
        list(ENGINES),
        format_func=ENGINES.__getitem__,
        default="zxing",
        key=f"{key}.engine",
    )
    return engine or "zxing"


def ladder_params(extra_keys: dict[str, str]) -> tuple[LadderConfig | None, ZxingConfig | None]:
    """``LadderConfig`` 與 ``ZxingConfig`` 的參數面板（畫在目前的容器中）。各頁共用同一組設定。"""
    cfg = config_editor(LadderConfig, "ladder", extra_keys)
    st.space("small")
    zx_cfg = config_editor(ZxingConfig, "zxing")
    st.caption("ZxingConfig 只對 zxing-cpp 有效。E1 消融時可全部關閉，量測階梯本身的貢獻。")
    return cfg, zx_cfg


def make_decoder(engine: str, zx_cfg: ZxingConfig) -> Decoder | None:
    """建立解碼器；pyzbar 無法載入時顯示錯誤並回傳 ``None``。"""
    if engine != "pyzbar":
        return ZxingDecoder(zx_cfg)
    try:
        return PyzbarDecoder()
    except ImportError as exc:
        st.error(f"無法載入 pyzbar：{exc}", icon=":material/error:")
        return None
