import time

import altair as alt
import pandas as pd
import streamlit as st

from dietai.preprocess import QualityConfig, check_quality
from wb import viz
from wb.images import encode_png
from wb.st_config import config_sidebar
from wb.st_layout import empty_state, page_header, section
from wb.st_source import image_source
from wb.text import warning_label

page_header(
    "品質檢查",
    "Quality check",
    "選一張影像、疊加模擬退化，觀察模糊、曝光、解析度三項檢查的結果。左側欄調整門檻。",
    ":material/image_search:",
)
cfg = config_sidebar(QualityConfig, "quality")

inputs, results = st.columns([2, 3], gap="large")

with inputs, st.container(border=True):
    section("輸入影像", "Input", ":material/input:")
    source = image_source("quality")

with results:
    if cfg is None:
        empty_state("左側參數不合法，請修正後再試。", ":material/error:")
        st.stop()
    if source is None:
        empty_state("在左側選擇影像來源。", ":material/image:")
        st.stop()

    img = source.image
    start = time.perf_counter()
    report = check_quality(img, cfg)
    elapsed_ms = (time.perf_counter() - start) * 1000
    h, w = img.shape[:2]

    with st.container(border=True):
        with st.container(horizontal=True, vertical_alignment="center"):
            if report.passed:
                st.markdown("#### :green[:material/check_circle:] 通過品質檢查 · Passed")
            else:
                st.markdown("#### :red[:material/cancel:] 未通過 · Not passed")
            st.space("stretch")
            for code in report.warnings:
                st.badge(warning_label(code), color="red", icon=":material/report:")
        st.caption(
            f"{source.description}　·　{w}×{h} px　·　平均亮度 {report.exposure.mean:.0f}"
            f"　·　檢查耗時 {elapsed_ms:.1f} ms"
        )

    short = min(h, w)
    top_left, top_right = st.columns(2, gap="small")
    bottom_left, bottom_right = st.columns(2, gap="small")
    top_left.metric(
        "模糊分數 · Blur",
        f"{report.blur_score:,.0f}",
        delta=f"{report.blur_score - cfg.blur_min:+,.0f} 相對下限 {cfg.blur_min:g}",
        border=True,
        help=f"拉普拉斯變異數（縮放到短邊 {cfg.blur_short_side} px）；越低越模糊。",
    )
    top_right.metric(
        "短邊 · Short side",
        f"{short} px",
        delta=f"{short - cfg.min_short_side:+d} 相對下限 {cfg.min_short_side}",
        border=True,
    )
    bottom_left.metric(
        "過暗比例 · Dark",
        f"{report.exposure.dark_ratio:.1%}",
        delta=f"{report.exposure.dark_ratio - cfg.dark_ratio_max:+.1%} 相對上限",
        delta_color="inverse",
        border=True,
        help=f"灰階 < {cfg.dark_level} 的像素比例；上限 {cfg.dark_ratio_max:.0%}。",
    )
    bottom_right.metric(
        "過亮比例 · Bright",
        f"{report.exposure.bright_ratio:.1%}",
        delta=f"{report.exposure.bright_ratio - cfg.bright_ratio_max:+.1%} 相對上限",
        delta_color="inverse",
        border=True,
        help=f"灰階 > {cfg.bright_level} 的像素比例；上限 {cfg.bright_ratio_max:.0%}。",
    )

    view = st.segmented_control(
        "檢視 · View",
        ["original", "laplacian", "exposure", "histogram"],
        format_func={
            "original": ":material/image: 原圖",
            "laplacian": ":material/blur_on: 邊緣響應",
            "exposure": ":material/exposure: 曝光遮罩",
            "histogram": ":material/bar_chart: 直方圖",
        }.__getitem__,
        default="original",
        key="quality.view",
        label_visibility="collapsed",
        width="stretch",
    )
    with st.container(border=True):
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
                    x=alt.X("灰階:Q", scale=alt.Scale(domain=[0, 255]), title="灰階 · Gray level"),
                    y=alt.Y("像素數:Q", title="像素數 · Pixels"),
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
            st.altair_chart(bars + rules, alt="灰階直方圖與過暗、過亮門檻", height=320)
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

    with st.expander("步驟紀錄 · Steps", icon=":material/list_alt:"):
        st.dataframe(viz.steps_rows(report), hide_index=True, alt="品質檢查各步驟的耗時與參數")
