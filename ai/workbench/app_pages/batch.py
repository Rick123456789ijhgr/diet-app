from dataclasses import asdict
from pathlib import Path
from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from dietai.preprocess import QualityConfig, check_quality
from dietai.preprocess.quality import QUALITY_WARNINGS
from wb import viz
from wb.images import SplitLockedError, list_images, load_image
from wb.st_config import config_editor, config_io
from wb.st_layout import card, empty_state, metric_row, page_header, panel_tabs, workspace
from wb.text import warning_label

DIST_METRICS: dict[str, str | None] = {
    "模糊分數": "blur_min",
    "過暗比例": "dark_ratio_max",
    "過亮比例": "bright_ratio_max",
    "平均亮度": None,
}

VIEWS = {
    "table": ":material/table_view: 每張結果",
    "dist": ":material/bar_chart: 分數分布",
    "warn": ":material/report: 警告次數",
}

page_header(
    "資料夾批次",
    "對資料夾內的照片批次執行品質檢查，看目前門檻下的通過率與分數分布；點選表格列可檢視單張。",
    ":material/photo_library:",
)


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


panel, results = workspace()
with panel:
    tab_folder, tab_cfg, tab_io = panel_tabs(
        ":material/folder_open: 資料夾", ":material/tune: 參數", ":material/swap_vert: 匯出入"
    )
    with tab_folder, st.form("batch.form", border=False):
        folder = st.text_input(
            "資料夾",
            placeholder=r"..\research\data\splits\dev",
            key="batch.folder",
            help="相對於 ai/ 或絕對路徑。splits/test 會被拒絕（測試集鎖定）。",
        )
        with st.container(horizontal=True, vertical_alignment="bottom"):
            limit = st.number_input("最多張數", 1, 5000, 500, key="batch.limit")
            recursive = st.toggle("包含子資料夾", key="batch.recursive")
        st.form_submit_button("執行", icon=":material/play_arrow:", type="primary", width="stretch")
    with tab_cfg:
        cfg = config_editor(QualityConfig, "quality")
    with tab_io:
        config_io(cfg, QualityConfig, "quality")

with results:
    if cfg is None:
        empty_state("參數不合法，請在左側「參數」修正後再試。", ":material/error:")
        st.stop()
    if not folder:
        empty_state("在左側「資料夾」輸入路徑後按「執行」。", ":material/folder_open:")
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
        empty_state("資料夾中沒有影像", ":material/image_not_supported:")
        st.stop()

    df = run_batch(
        tuple(str(p) for p in files), tuple(p.stat().st_mtime for p in files), asdict(cfg)
    )
    ok = df[df["錯誤"].isna()]

    with metric_row():
        st.metric("張數", len(df), border=True)
        st.metric("通過率", f"{ok['通過'].mean():.1%}" if len(ok) else "—", border=True)
        for code in QUALITY_WARNINGS:
            count = int(ok["警告"].str.contains(code.value).sum()) if len(ok) else 0
            st.metric(warning_label(code), count, border=True)
        if len(df) > len(ok):
            st.metric("讀取失敗", len(df) - len(ok), border=True)

    view = st.segmented_control(
        "檢視",
        list(VIEWS),
        format_func=VIEWS.__getitem__,
        default="table",
        key="batch.view",
        label_visibility="collapsed",
        width="stretch",
    )
    with card():
        if view == "dist" and len(ok):
            metric = st.segmented_control(
                "指標",
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
                    .mark_rule(strokeDash=[4, 4], color="#E11D48", strokeWidth=2)
                    .encode(x=f"{metric}:Q")
                )
            st.altair_chart(chart, alt=f"{metric}的分布與目前門檻", height=300)
        elif view == "warn" and len(ok):
            counts = pd.DataFrame(
                {
                    "警告": [warning_label(c) for c in QUALITY_WARNINGS],
                    "張數": [int(ok["警告"].str.contains(c.value).sum()) for c in QUALITY_WARNINGS],
                }
            )
            st.bar_chart(
                counts, x="警告", y="張數", horizontal=True, height=300, alt="各警告的張數"
            )
        else:
            with st.container(horizontal=True, vertical_alignment="center"):
                st.caption("點選一列即可在下方檢視該影像。")
                st.download_button(
                    "下載 CSV",
                    df.to_csv(index=False).encode("utf-8-sig"),
                    file_name="quality_batch.csv",
                    mime="text/csv",
                    icon=":material/download:",
                    type="tertiary",
                )
            selection = st.dataframe(
                df,
                hide_index=True,
                height=260,
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
            picked = selection.selection.rows
            if picked:
                row = df.iloc[picked[0]]
                st.markdown(f"**{row['檔案']}**")
                try:
                    img = load_image(str(row["路徑"]))
                except (OSError, ValueError) as exc:
                    st.error(str(exc), icon=":material/error:")
                    st.stop()
                a, b, c = st.columns(3)
                a.image(img, channels="BGR", caption="原圖", alt="選取的影像")
                b.image(
                    viz.laplacian_heatmap(img, cfg),
                    channels="BGR",
                    caption="邊緣響應",
                    alt="拉普拉斯響應熱度圖",
                )
                c.image(
                    viz.exposure_overlay(img, cfg),
                    channels="BGR",
                    caption="曝光遮罩",
                    alt="過暗與過亮像素遮罩",
                )
