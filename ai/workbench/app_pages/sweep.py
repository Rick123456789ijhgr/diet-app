from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from dietai.preprocess import LadderConfig, QualityConfig, Rung, ZxingConfig, check_quality
from dietai.preprocess.ops import resize_short_side
from dietai.preprocess.quality import QUALITY_WARNINGS
from dietai.synthetic import ean13_codes, ean13_scene
from wb import ladder_eval, viz
from wb.degradations import SWEEP_AXES, first_trigger, sweep_levels
from wb.st_config import config_sidebar
from wb.st_ladder import engine_control, ladder_controls, ladder_sidebar, make_decoder
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
TARGETS = {
    "quality": ":material/image_search: 品質檢查",
    "barcode": ":material/barcode_reader: 條碼解碼",
}

page_header(
    "參數掃描",
    "Sweep",
    "讓一種退化由弱到強：品質檢查看指標在哪個等級越過門檻；"
    "條碼解碼比較「只用原圖」與逐步升級的成功率。",
    ":material/ssid_chart:",
)
target = st.segmented_control(
    "評估對象 · Target",
    list(TARGETS),
    format_func=TARGETS.__getitem__,
    default="quality",
    key="sweep.target",
    label_visibility="collapsed",
)


def _axis_controls() -> tuple[str, list[float]]:
    """退化種類、範圍與點數；回傳（退化代碼, 等級串列）。"""
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
    return axis_key, sweep_levels(lo, hi, int(n))


@st.cache_data(max_entries=8, show_spinner=False)
def _barcode_sweep(
    axis_key: str,
    levels: tuple[float, ...],
    n_samples: int,
    module_px: int,
    seed: int,
    engine: str,
    cfg: LadderConfig,
    zx_cfg: ZxingConfig,
) -> list[dict[str, Any]]:
    decoder = make_decoder(engine, zx_cfg)
    if decoder is None:
        return []
    samples = [ean13_scene(code, module_px) for code in ean13_codes(n_samples, seed)]
    return ladder_eval.ladder_sweep(samples, SWEEP_AXES[axis_key].fn, levels, decoder, cfg)


if target == "barcode":
    controls, results = st.columns([2, 3], gap="large")
    with controls:
        with st.container(border=True):
            section("掃描設定", "Setup", ":material/tune:")
            axis_key, levels = _axis_controls()
        with st.container(border=True):
            section("樣本", "Samples", ":material/barcode:")
            st.caption("合成 EAN-13，每個樣本的條碼內容不同；成功率為成功樣本數除以樣本數。")
            with st.container(horizontal=True):
                n_samples = st.number_input("樣本數 · N", 1, 30, 5, key="sweep.samples")
                module_px = st.number_input("模組寬 · Module px", 1, 12, 4, key="sweep.module")
                seed = st.number_input("種子 · Seed", 0, 10_000, 0, key="sweep.seed")
        with st.container(border=True):
            section("階梯", "Ladder", ":material/stairs:")
            extra_keys = ladder_controls("sweep")
            engine = engine_control("sweep")
    ladder_cfg, zx_cfg = ladder_sidebar(extra_keys)

    with results:
        if ladder_cfg is None or zx_cfg is None:
            empty_state("左側參數不合法，請修正後再試。", ":material/error:")
            st.stop()
        axis = SWEEP_AXES[axis_key]
        with st.spinner(f"解碼中：{len(levels)} 個等級 × {int(n_samples)} 個樣本 × 2 種方法"):
            sweep_rows = _barcode_sweep(
                axis_key,
                tuple(levels),
                int(n_samples),
                int(module_px),
                int(seed),
                engine,
                ladder_cfg,
                zx_cfg,
            )
        if not sweep_rows:
            st.stop()

        raw_rate = ladder_eval.overall(sweep_rows, ladder_eval.RAW)
        full_rate = ladder_eval.overall(sweep_rows, ladder_eval.LADDER)
        raw_fail = ladder_eval.first_failure(sweep_rows, ladder_eval.RAW)
        full_fail = ladder_eval.first_failure(sweep_rows, ladder_eval.LADDER)
        c1, c2, c3 = st.columns(3, gap="small")
        c1.metric(
            "只用原圖 · Raw only",
            f"{raw_rate:.0%}",
            delta="全部成功" if raw_fail is None else f"首次失敗於 {raw_fail:.3g}",
            delta_color="off",
            border=True,
            help="所有等級與樣本的整體成功率；首次失敗為成功率首次低於 100% 的等級。",
        )
        c2.metric(
            "逐步升級 · Ladder",
            f"{full_rate:.0%}",
            delta="全部成功" if full_fail is None else f"首次失敗於 {full_fail:.3g}",
            delta_color="off",
            border=True,
        )
        c3.metric(
            "提升 · Gain",
            f"{full_rate - raw_rate:+.0%}",
            border=True,
            help="逐步升級減只用原圖的整體成功率。",
        )

        with st.container(border=True):
            sample = ean13_scene(ean13_codes(1, int(seed))[0], int(module_px))
            picks = sorted({0, len(levels) // 2, len(levels) - 1})
            for col, i in zip(st.columns(len(picks)), picks, strict=True):
                col.image(
                    resize_short_side(axis.fn(sample, levels[i]), 160),
                    caption=f"{axis.label} = {levels[i]:.3g}",
                    channels="BGR",
                    alt=f"{axis.label} {levels[i]:.3g} 的條碼樣本",
                )
            x = alt.X("等級:Q", title=zh_en(axis.label, axis.label_en))
            rates = (
                alt.Chart(pd.DataFrame(ladder_eval.success_rates(sweep_rows)))
                .mark_line(point=True)
                .encode(
                    x=x,
                    y=alt.Y(
                        "成功率:Q",
                        title="成功率 · Success rate",
                        axis=alt.Axis(format="%"),
                        scale=alt.Scale(domain=[0, 1]),
                    ),
                    color=alt.Color("方法:N", title=None),
                    strokeDash=alt.StrokeDash("方法:N", legend=None),
                    tooltip=["等級", "方法", alt.Tooltip("成功率:Q", format=".0%")],
                )
            )
            st.altair_chart(rates, alt=f"兩種方法的成功率隨{axis.label}變化", height=280)
            counts = ladder_eval.rung_counts(sweep_rows)
            if counts:
                st.caption("逐步升級成功於哪一階 · Successful rung")
                bars = (
                    alt.Chart(pd.DataFrame(counts))
                    .mark_bar()
                    .encode(
                        x=x,
                        y=alt.Y("次數:Q", title="樣本數 · Samples"),
                        color=alt.Color("階:N", title=None, sort=[r.value for r in Rung]),
                        tooltip=["等級", "階", "次數"],
                    )
                )
                st.altair_chart(bars, alt="各等級中逐步升級成功於哪一階的樣本數", height=220)

        with st.expander("各等級明細 · Details", icon=":material/table_view:"):
            st.dataframe(pd.DataFrame(sweep_rows), hide_index=True, alt="每個等級與樣本的解碼結果")
    st.stop()

cfg = config_sidebar(QualityConfig, "quality")

controls, results = st.columns([2, 3], gap="large")

with controls:
    with st.container(border=True):
        section("掃描設定", "Setup", ":material/tune:")
        axis_key, levels = _axis_controls()
        axis = SWEEP_AXES[axis_key]
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

    rows: list[dict[str, Any]] = []
    thumbs = []
    for level in levels:
        degraded = axis.fn(source.image, level)
        rows.append({"等級": round(level, 4), **viz.report_metrics(check_quality(degraded, cfg))})
        thumbs.append(resize_short_side(degraded, 160))
    df = pd.DataFrame(rows)

    cells = [cell for _ in range(2) for cell in st.columns(2, gap="small")]
    for cell, code in zip(cells, QUALITY_WARNINGS, strict=True):
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
