"""影像來源面板：合成影像、上傳、本機檔案，並可疊加模擬退化。"""

from __future__ import annotations

from dataclasses import dataclass

import streamlit as st

from dietai.preprocess.types import Image
from dietai.synthetic import label_scene
from wb import degradations
from wb.images import SplitLockedError, decode_image, load_image

SOURCES = {
    "synthetic": ":material/auto_awesome: 合成",
    "upload": ":material/upload_file: 上傳",
    "local": ":material/folder_open: 本機",
}

# (欄位, 中文, 英文, 最小, 最大, 預設, 步進, 格式)
_SLIDERS: dict[str, list[tuple[str, str, str, float, float, float, float, str]]] = {
    "幾何 · Geometry": [
        ("rotate_deg", "旋轉", "Rotate", -90.0, 90.0, 0.0, 1.0, "%.0f°"),
        ("scale", "縮小", "Scale", 0.05, 1.0, 1.0, 0.05, "×%.2f"),
    ],
    "光學 · Optics": [
        ("blur_sigma", "模糊 σ", "Blur", 0.0, 20.0, 0.0, 0.5, "%.1f"),
        ("noise_std", "雜訊", "Noise", 0.0, 80.0, 0.0, 1.0, "%.0f"),
    ],
    "光線 · Lighting": [
        ("gain", "亮度", "Gain", 0.0, 3.0, 1.0, 0.05, "×%.2f"),
        ("gradient", "梯度", "Gradient", 0.0, 1.0, 0.0, 0.05, "%.2f"),
        ("glare", "光斑", "Glare", 0.0, 0.6, 0.0, 0.02, "%.2f"),
    ],
}
_SHORT = {f: zh for group in _SLIDERS.values() for f, zh, *_ in group}


@dataclass(frozen=True)
class Source:
    image: Image
    description: str
    degradation: degradations.Degradation = degradations.Degradation()


@st.cache_data(max_entries=16, show_spinner=False)
def _synthetic(height: int, width: int, seed: int) -> Image:
    return label_scene(height, width, seed)


@st.cache_data(max_entries=8, show_spinner=False)
def _decode(data: bytes) -> Image:
    return decode_image(data)


def _pick_base(key: str) -> Source | None:
    kind = st.segmented_control(
        "影像來源 · Source",
        list(SOURCES),
        format_func=SOURCES.__getitem__,
        default="synthetic",
        key=f"{key}.kind",
        width="stretch",
    )
    if kind == "upload":
        uploaded = st.file_uploader(
            "選擇影像 · Choose image",
            type=["jpg", "jpeg", "png", "bmp", "webp"],
            key=f"{key}.upload",
            label_visibility="collapsed",
        )
        if uploaded is None:
            st.caption("拖曳或點選上傳 JPG／PNG。真實照片請勿使用 test split。")
            return None
        try:
            return Source(_decode(uploaded.getvalue()), uploaded.name)
        except ValueError as exc:
            st.error(str(exc), icon=":material/error:")
            return None
    if kind == "local":
        path = st.text_input(
            "影像路徑 · Image path",
            key=f"{key}.path",
            placeholder=r"..\research\data\splits\dev\0001.jpg",
            help="相對於 ai/ 或絕對路徑。不得讀取 splits/test（測試集鎖定）。",
        )
        if not path:
            st.caption("輸入開發用照片的路徑。")
            return None
        try:
            return Source(load_image(path), path)
        except SplitLockedError as exc:
            st.error(str(exc), icon=":material/lock:")
        except (OSError, ValueError) as exc:
            st.error(str(exc), icon=":material/error:")
        return None
    with st.container(horizontal=True):
        height = st.number_input("高 · H", 16, 4320, 1080, step=8, key=f"{key}.h")
        width = st.number_input("寬 · W", 16, 7680, 1920, step=8, key=f"{key}.w")
        seed = st.number_input("種子 · Seed", 0, 10_000, 0, key=f"{key}.seed")
    return Source(_synthetic(int(height), int(width), int(seed)), f"合成標示（種子 {int(seed)}）")


def _reset_degradations(key: str) -> None:
    for group in _SLIDERS.values():
        for field_name, *_, default, _step, _fmt in group:
            st.session_state[f"{key}.d.{field_name}"] = default


def _degradation_controls(key: str) -> degradations.Degradation:
    values: dict[str, float] = {}
    with st.expander("模擬退化 · Degradations", icon=":material/tune:", key=f"{key}.degrade"):
        st.caption("依序套用：旋轉 → 縮小 → 模糊 → 亮度 → 梯度 → 光斑 → 雜訊")
        for group, sliders in _SLIDERS.items():
            st.markdown(f"**{group}**")
            for field_name, zh, en, lo, hi, default, step, fmt in sliders:
                values[field_name] = st.slider(
                    f"{zh} · {en}",
                    lo,
                    hi,
                    default,
                    step,
                    format=fmt,
                    key=f"{key}.d.{field_name}",
                )
        with st.container(horizontal=True, vertical_alignment="bottom"):
            seed = st.number_input("隨機種子 · Seed", 0, 10_000, 0, key=f"{key}.d.seed")
            st.button(
                "全部歸零",
                icon=":material/restart_alt:",
                on_click=_reset_degradations,
                args=(key,),
                key=f"{key}.d.reset",
            )
    d = degradations.Degradation(seed=int(seed), **values)
    if d.active_count():
        chips = [
            f":blue-badge[{_SHORT[f]} {getattr(d, f):g}]"
            for f in _SHORT
            if getattr(d, f) != getattr(degradations.Degradation(), f)
        ]
        st.markdown("已套用 " + " ".join(chips))
    return d


def image_source(key: str, allow_degradation: bool = True) -> Source | None:
    """顯示來源面板，回傳（可能經退化的）影像；尚未選好時回傳 ``None``。"""
    base = _pick_base(key)
    if not allow_degradation:
        return base
    d = _degradation_controls(key)
    if base is None or d.is_identity():
        return base
    return Source(degradations.apply(base.image, d), base.description, d)
