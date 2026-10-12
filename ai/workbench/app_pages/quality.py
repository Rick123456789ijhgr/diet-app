import time

import altair as alt
import pandas as pd
import streamlit as st

from dietai.preprocess import QualityConfig, check_quality
from wb import viz
from wb.images import encode_png
from wb.st_config import config_editor, config_io
from wb.st_layout import (
    card,
    empty_state,
    metric_row,
    page_header,
    panel_tabs,
    status_line,
    workspace,
)
from wb.st_source import image_source
from wb.text import warning_label

VIEWS = {
    "original": ":material/image: 原圖",
    "laplacian": ":material/blur_on: 邊緣響應",
    "exposure": ":material/exposure: 曝光遮罩",
    "histogram": ":material/bar_chart: 直方圖",
    "steps": ":material/list_alt: 步驟",
}

page_header(
    "品質檢查",
    "疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。",
    ":material/image_search:",
    phase=1,
)
panel, results = workspace()

with panel:
    tab_img, tab_cfg, tab_io = panel_tabs(
        ":material/image: 影像", ":material/tune: 參數", ":material/swap_vert: 匯出入"
    )
    with tab_img:
        source = image_source("quality")
    with tab_cfg:
        cfg = config_editor(QualityConfig, "quality")
    with tab_io:
        config_io(cfg, QualityConfig, "quality")

with results:
    if cfg is None:
        empty_state("參數不合法，請在左側「參數」修正後再試。", ":material/error:")
        st.stop()
    if source is None:
        empty_state("在左側「影像」選擇影像來源。", ":material/image:")
        st.stop()

    img = source.image
    start = time.perf_counter()
    report = check_quality(img, cfg)
    elapsed_ms = (time.perf_counter() - start) * 1000
    h, w = img.shape[:2]

    slot = status_line(
        report.passed,
        "通過品質檢查" if report.passed else "未通過",
        f"{source.description}　·　{w}×{h} px　·　平均亮度 {report.exposure.mean:.0f}"
        f"　·　{elapsed_ms:.1f} ms",
    )
    with slot:
        for code in report.warnings:
            st.badge(warning_label(code), color="red", icon=":material/report:")

    short = min(h, w)
    with metric_row():
        st.metric(
            "模糊分數",
            f"{report.blur_score:,.0f}",
            delta=f"{report.blur_score - cfg.blur_min:+,.0f} 相對下限 {cfg.blur_min:g}",
            border=True,
            help=f"拉普拉斯變異數（縮放到短邊 {cfg.blur_short_side} px）；越低越模糊。",
        )
        st.metric(
            "短邊",
            f"{short} px",
            delta=f"{short - cfg.min_short_side:+d} 相對下限 {cfg.min_short_side}",
            border=True,
        )
        st.metric(
            "過暗比例",
            f"{report.exposure.dark_ratio:.1%}",
            delta=f"{report.exposure.dark_ratio - cfg.dark_ratio_max:+.1%} 相對上限",
            delta_color="inverse",
            border=True,
            help=f"灰階 < {cfg.dark_level} 的像素比例；上限 {cfg.dark_ratio_max:.0%}。",
        )
        st.metric(
            "過亮比例",
            f"{report.exposure.bright_ratio:.1%}",
            delta=f"{report.exposure.bright_ratio - cfg.bright_ratio_max:+.1%} 相對上限",
            delta_color="inverse",
            border=True,
            help=f"灰階 > {cfg.bright_level} 的像素比例；上限 {cfg.bright_ratio_max:.0%}。",
        )

    view = st.segmented_control(
        "檢視",
        list(VIEWS),
        format_func=VIEWS.__getitem__,
        default="original",
        key="quality.view",
        label_visibility="collapsed",
        width="stretch",
    )
    with card():
        if view == "laplacian":
            st.image(viz.laplacian_heatmap(img, cfg), channels="BGR", alt="拉普拉斯響應熱度圖")
            st.caption(
                f"縮放到短邊 {cfg.blur_short_side} px 後的拉普拉斯響應強度，越亮代表邊緣越銳利；"
                "模糊分數就是這張圖的變異數。"
            )
        elif view == "exposure":
            st.image(viz.exposure_overlay(img, cfg), channels="BGR", alt="過暗與過亮像素遮罩")
            st.caption(
                f":blue[■] 過暗（灰階 < {cfg.dark_level}）　"
                f":red[■] 過亮（灰階 > {cfg.bright_level}）"
            )
        elif view == "histogram":
            hist = pd.DataFrame(viz.gray_histogram(img))
            bars = (
                alt.Chart(hist)
                .mark_bar()
                .encode(
                    x=alt.X("灰階:Q", scale=alt.Scale(domain=[0, 255]), title="灰階"),
                    y=alt.Y("像素數:Q", title="像素數"),
                )
            )
            marks = pd.DataFrame(
                [
                    {"灰階": cfg.dark_level, "門檻": "過暗灰階"},
                    {"灰階": cfg.bright_level, "門檻": "過亮灰階"},
                ]
            )
            rules = (
                alt.Chart(marks)
                .mark_rule(strokeDash=[4, 4], strokeWidth=2)
                .encode(x="灰階:Q", color=alt.Color("門檻:N", title=None))
            )
            st.altair_chart(bars + rules, alt="灰階直方圖與過暗、過亮門檻", height=280)
        elif view == "steps":
            st.dataframe(viz.steps_rows(report), hide_index=True, alt="品質檢查各步驟的耗時與參數")
        else:
            st.image(img, channels="BGR", alt="輸入影像")
            st.download_button(
                "下載 PNG",
                encode_png(img),
                file_name="workbench_input.png",
                mime="image/png",
                icon=":material/download:",
                type="tertiary",
            )
