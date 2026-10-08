from dataclasses import asdict
from pathlib import Path
from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from dietai.preprocess import PreprocessWarning, QualityConfig, check_quality
from wb import viz
from wb.images import SplitLockedError, list_images, load_image
from wb.st_config import config_sidebar
from wb.st_layout import empty_state, page_header, section
from wb.text import warning_label

DIST_METRICS: dict[str, str | None] = {
    "模糊分數": "blur_min",
    "過暗比例": "dark_ratio_max",
    "過亮比例": "bright_ratio_max",
    "平均亮度": None,
}

page_header(
    "資料夾批次",
    "Batch",
    "對資料夾內的照片批次執行品質檢查，看目前門檻下的通過率與分數分布；點選表格列可檢視單張。",
    ":material/photo_library:",
)
cfg = config_sidebar(QualityConfig, "quality")


@st.cache_data(max_entries=8, show_spinner="計算中…")
def run_batch(
    paths: tuple[str, ...], mtimes: tuple[float, ...], cfg_values: dict[str, Any]
) -> pd.DataFrame:
    """對每張影像執行品質檢查。``mtimes`` 只用於讓檔案變動時快取失效。"""
    batch_cfg = QualityConfig(**cfg_values)
    rows: list[dict[str, Any]] = []
    for p in paths:
        try:
            img = load_image(p)
        except (OSError, ValueError) as exc:
            rows.append({"檔案": Path(p).name, "路徑": p, "錯誤": str(exc)})
            continue
        report = check_quality(img, batch_cfg)
        rows.append(
            {
                "檔案": Path(p).name,
                "路徑": p,
                "短邊": min(img.shape[:2]),
                **viz.report_metrics(report),
                "錯誤": None,
            }
        )
    return pd.DataFrame(rows)


with (
    st.container(border=True),
    st.form("batch.form", border=False),
    st.container(horizontal=True, vertical_alignment="bottom"),
):
    folder = st.text_input(
        "資料夾 · Folder",
        placeholder=r"..\research\data\splits\dev",
        key="batch.folder",
        help="相對於 ai/ 或絕對路徑。splits/test 會被拒絕（測試集鎖定）。",
        width=520,
    )
    limit = st.number_input("最多張數 · Limit", 1, 5000, 500, key="batch.limit", width=150)
    recursive = st.toggle("包含子資料夾 · Recursive", key="batch.recursive")
    st.form_submit_button("執行 · Run", icon=":material/play_arrow:", type="primary")

if cfg is None:
    empty_state("左側參數不合法，請修正後再試。", ":material/error:")
    st.stop()
if not folder:
    empty_state("輸入資料夾路徑後按「執行」。", ":material/folder_open:")
    st.stop()
try:
    files = list_images(folder, recursive=recursive, limit=int(limit))
except SplitLockedError as exc:
    st.error(str(exc), icon=":material/lock:")
    st.stop()
except OSError as exc:
    st.error(str(exc), icon=":material/error:")
    st.stop()
if not files:
    empty_state("資料夾中沒有影像 · No images found", ":material/image_not_supported:")
    st.stop()

df = run_batch(tuple(str(p) for p in files), tuple(p.stat().st_mtime for p in files), asdict(cfg))
ok = df[df["錯誤"].isna()]

with st.container(horizontal=True, gap="small"):
    st.metric("張數 · Images", len(df), border=True)
    st.metric("通過率 · Pass rate", f"{ok['通過'].mean():.1%}" if len(ok) else "—", border=True)
    for code in PreprocessWarning:
        count = int(ok["警告"].str.contains(code.value).sum()) if len(ok) else 0
        st.metric(warning_label(code), count, border=True)
    if len(df) > len(ok):
        st.metric("讀取失敗 · Errors", len(df) - len(ok), border=True)

if len(ok):
    dist, warn = st.columns([3, 2], gap="medium")
    with dist, st.container(border=True):
        section("分數分布", "Distribution", ":material/bar_chart:")
        metric = st.segmented_control(
            "指標 · Metric",
            list(DIST_METRICS),
            default="模糊分數",
            key="batch.metric",
            label_visibility="collapsed",
        )
        metric = metric or "模糊分數"
        hist = (
            alt.Chart(ok)
            .mark_bar()
            .encode(
                x=alt.X(f"{metric}:Q", bin=alt.Bin(maxbins=40), title=metric),
                y=alt.Y("count():Q", title="張數"),
            )
        )
        chart: alt.Chart | alt.LayerChart = hist
        if (field := DIST_METRICS[metric]) is not None:
            chart = hist + (
                alt.Chart(pd.DataFrame({metric: [getattr(cfg, field)]}))
                .mark_rule(strokeDash=[4, 4], color="#C2410C", strokeWidth=2)
                .encode(x=f"{metric}:Q")
            )
        st.altair_chart(chart, alt=f"{metric}的分布與目前門檻", height=260)
    with warn, st.container(border=True):
        section("警告次數", "Warnings", ":material/report:")
        counts = pd.DataFrame(
            {
                "警告": [warning_label(c) for c in PreprocessWarning],
                "張數": [int(ok["警告"].str.contains(c.value).sum()) for c in PreprocessWarning],
            }
        )
        st.bar_chart(counts, x="警告", y="張數", horizontal=True, height=260, alt="各警告的張數")

section("每張結果", "Results", ":material/table_view:")
st.caption("點選一列即可在下方檢視該影像。")
selection = st.dataframe(
    df,
    hide_index=True,
    key="batch.table",
    on_select="rerun",
    selection_mode="single-row",
    column_order=[c for c in df.columns if c != "路徑"],
    column_config={
        "通過": st.column_config.CheckboxColumn("通過"),
        "解析度通過": st.column_config.CheckboxColumn("解析度"),
        "模糊分數": st.column_config.NumberColumn("模糊分數", format="%.0f"),
        "過暗比例": st.column_config.NumberColumn("過暗比例", format="percent"),
        "過亮比例": st.column_config.NumberColumn("過亮比例", format="percent"),
    },
    alt="每張影像的品質檢查結果",
)
st.download_button(
    "下載 CSV",
    df.to_csv(index=False).encode("utf-8-sig"),
    file_name="quality_batch.csv",
    mime="text/csv",
    icon=":material/download:",
    type="tertiary",
)

picked = selection.selection.rows
if picked:
    row = df.iloc[picked[0]]
    with st.container(border=True):
        section(str(row["檔案"]), "Detail", ":material/image_search:")
        try:
            img = load_image(str(row["路徑"]))
        except (OSError, ValueError) as exc:
            st.error(str(exc), icon=":material/error:")
            st.stop()
        a, b, c = st.columns(3)
        a.image(img, channels="BGR", caption="原圖 · Original", alt="選取的影像")
        b.image(
            viz.laplacian_heatmap(img, cfg),
            channels="BGR",
            caption="邊緣響應 · Laplacian",
            alt="拉普拉斯響應熱度圖",
        )
        c.image(
            viz.exposure_overlay(img, cfg),
            channels="BGR",
            caption="曝光遮罩 · Exposure",
            alt="過暗與過亮像素遮罩",
        )
