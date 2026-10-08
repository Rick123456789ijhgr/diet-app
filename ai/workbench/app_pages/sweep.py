from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from dietai.preprocess import PreprocessWarning, QualityConfig, check_quality
from dietai.preprocess.ops import resize_short_side
from wb import viz
from wb.degradations import SWEEP_AXES, first_trigger, sweep_levels
from wb.st_config import config_sidebar
from wb.st_layout import empty_state, page_header, section
from wb.st_source import image_source
from wb.text import warning_label, zh_en

# 指標 → （對應門檻欄位, 門檻說明）
METRICS: dict[str, tuple[str | None, str]] = {
    "模糊分數": ("blur_min", "下限"),
    "過暗比例": ("dark_ratio_max", "上限"),
    "過亮比例": ("bright_ratio_max", "上限"),
    "平均亮度": (None, ""),
}

page_header(
    "參數掃描",
    "Sweep",
    "固定一張影像，讓一種退化由弱到強，找出指標在哪個等級越過門檻。",
    ":material/ssid_chart:",
)
cfg = config_sidebar(QualityConfig, "quality")

controls, results = st.columns([2, 3], gap="large")

with controls:
    with st.container(border=True):
        section("掃描設定", "Setup", ":material/tune:")
        axis_key = st.selectbox(
            "退化種類 · Degradation",
            list(SWEEP_AXES),
            format_func=lambda k: zh_en(SWEEP_AXES[k].label, SWEEP_AXES[k].label_en),
            key="sweep.axis",
        )
        axis = SWEEP_AXES[axis_key]
        lo, hi = st.slider(
            "範圍 · Range",
            axis.lo,
            axis.hi,
            (axis.default_lo, axis.default_hi),
            key=f"sweep.range.{axis_key}",
        )
        n = st.slider("點數 · Points", 3, 30, 9, key="sweep.n")
        metric = st.segmented_control(
            "圖表指標 · Metric",
            list(METRICS),
            default="模糊分數",
            key="sweep.metric",
            width="stretch",
        )
    with st.container(border=True):
        section("基準影像", "Base image", ":material/image:")
        source = image_source("sweep", allow_degradation=False)

with results:
    if cfg is None:
        empty_state("左側參數不合法，請修正後再試。", ":material/error:")
        st.stop()
    if source is None:
        empty_state("在左側選擇基準影像。", ":material/image:")
        st.stop()

    levels = sweep_levels(lo, hi, int(n))
    rows: list[dict[str, Any]] = []
    thumbs = []
    for level in levels:
        degraded = axis.fn(source.image, level)
        rows.append({"等級": round(level, 4), **viz.report_metrics(check_quality(degraded, cfg))})
        thumbs.append(resize_short_side(degraded, 160))
    df = pd.DataFrame(rows)

    cells = [cell for _ in range(2) for cell in st.columns(2, gap="small")]
    for cell, code in zip(cells, PreprocessWarning, strict=True):
        hit = first_trigger(levels, list(df["警告"]), code.value)
        cell.metric(
            warning_label(code),
            "未觸發" if hit is None else f"≥ {hit:.3g}",
            border=True,
            help=f"{axis.label}達到此等級時首次出現 {code.value}。",
        )

    with st.container(border=True):
        picks = sorted({0, len(levels) // 2, len(levels) - 1})
        for col, i in zip(st.columns(len(picks)), picks, strict=True):
            col.image(
                thumbs[i],
                caption=f"{axis.label} = {levels[i]:.3g}",
                channels="BGR",
                alt=f"{axis.label} {levels[i]:.3g} 的影像",
            )

        metric_name = metric or "模糊分數"
        line = (
            alt.Chart(df)
            .mark_line(point=True)
            .encode(
                x=alt.X("等級:Q", title=zh_en(axis.label, axis.label_en)),
                y=alt.Y(f"{metric_name}:Q", title=metric_name),
                tooltip=["等級", metric_name, "警告"],
            )
        )
        field, kind = METRICS[metric_name]
        chart: alt.Chart | alt.LayerChart = line
        if field is not None:
            rule = (
                alt.Chart(pd.DataFrame({"門檻": [getattr(cfg, field)]}))
                .mark_rule(strokeDash=[4, 4], color="#C2410C", strokeWidth=2)
                .encode(y="門檻:Q", tooltip=[alt.Tooltip("門檻:Q", title=f"{field}（{kind}）")])
            )
            chart = line + rule
        st.altair_chart(chart, alt=f"{metric_name}隨{axis.label}變化的折線圖", height=320)
        if field is not None:
            st.caption(f"虛線：目前的 `{field}`（{kind}）= {getattr(cfg, field):g}")

    with st.expander("各等級明細 · Details", icon=":material/table_view:"):
        st.dataframe(
            df,
            hide_index=True,
            alt="每個退化等級的品質檢查結果",
            column_config={"通過": st.column_config.CheckboxColumn("通過")},
        )
