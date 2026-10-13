from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from dietai.devtools.degradations import SWEEP_AXES, first_trigger, sweep_levels
from dietai.preprocess import LadderConfig, QualityConfig, Rung, ZxingConfig, check_quality
from dietai.preprocess.ops import resize_short_side
from dietai.preprocess.quality import QUALITY_WARNINGS
from dietai.preprocess.types import Image
from dietai.synthetic import ean13_codes, ean13_scene
from wb import ladder_eval, viz
from wb.st_config import config_editor, config_io
from wb.st_ladder import engine_control, ladder_controls, ladder_params, make_decoder
from wb.st_layout import card, empty_state, metric_row, page_header, panel_tabs, workspace
from wb.st_source import image_source
from wb.text import warning_label

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
VIEWS_BARCODE = {
    "rate": ":material/ssid_chart: 成功率",
    "rung": ":material/stairs: 成功階",
    "table": ":material/table_view: 明細",
}
VIEWS_QUALITY = {
    "chart": ":material/ssid_chart: 指標曲線",
    "table": ":material/table_view: 明細",
}

slot = page_header(
    "參數掃描",
    "一種退化由弱到強：品質檢查看指標在哪個等級越過門檻；條碼比較只用原圖與逐步升級的成功率。",
    ":material/ssid_chart:",
)
with slot:
    target = st.segmented_control(
        "評估對象",
        list(TARGETS),
        format_func=TARGETS.__getitem__,
        default="quality",
        key="sweep.target",
        label_visibility="collapsed",
    )


def _axis_controls() -> tuple[str, list[float]]:
    """退化種類、範圍與點數；回傳（退化代碼, 等級串列）。"""
    axis_key = st.selectbox(
        "退化種類",
        list(SWEEP_AXES),
        format_func=lambda k: SWEEP_AXES[k].label,
        key="sweep.axis",
    )
    axis = SWEEP_AXES[axis_key]
    lo, hi = st.slider(
        "範圍",
        axis.lo,
        axis.hi,
        (axis.default_lo, axis.default_hi),
        key=f"sweep.range.{axis_key}",
    )
    n = st.slider("點數", 3, 30, 9, key="sweep.n")
    return axis_key, sweep_levels(lo, hi, int(n))


def _view(views: dict[str, str], key: str) -> str:
    view = st.segmented_control(
        "檢視",
        list(views),
        format_func=views.__getitem__,
        default=next(iter(views)),
        key=key,
        label_visibility="collapsed",
        width="stretch",
    )
    return view or next(iter(views))


def _thumbs(images: list[Image], levels: list[float], label: str) -> None:
    """最弱、中間、最強三個等級的縮圖。"""
    picks = sorted({0, len(levels) // 2, len(levels) - 1})
    with st.container(horizontal=True, horizontal_alignment="center", gap="medium"):
        for i in picks:
            st.image(
                images[i],
                caption=f"{label} = {levels[i]:.3g}",
                channels="BGR",
                width=150,
                alt=f"{label} {levels[i]:.3g} 的影像",
            )


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
    panel, results = workspace()
    with panel:
        tab_sweep, tab_cfg, tab_io = panel_tabs(
            ":material/tune: 掃描", ":material/stairs: 階梯參數", ":material/swap_vert: 匯出入"
        )
        with tab_sweep:
            axis_key, levels = _axis_controls()
            st.caption("樣本為合成 EAN-13，內容各不相同；成功率為成功樣本數除以樣本數。")
            with st.container(horizontal=True):
                n_samples = st.number_input("樣本數", 1, 30, 5, key="sweep.samples")
                module_px = st.number_input("模組寬", 1, 12, 4, key="sweep.module")
                seed = st.number_input("種子", 0, 10_000, 0, key="sweep.seed")
        with tab_cfg:
            extra_keys = ladder_controls("sweep")
            engine = engine_control("sweep")
            ladder_cfg, zx_cfg = ladder_params(extra_keys)
        with tab_io:
            config_io(ladder_cfg, LadderConfig, "ladder", extra_keys)

    with results:
        if ladder_cfg is None or zx_cfg is None:
            empty_state("參數不合法，請在左側「階梯參數」修正後再試。", ":material/error:")
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
        with metric_row():
            st.metric(
                "只用原圖",
                f"{raw_rate:.0%}",
                delta="全部成功" if raw_fail is None else f"首次失敗於 {raw_fail:.3g}",
                delta_color="off",
                border=True,
                help="所有等級與樣本的整體成功率；首次失敗為成功率首次低於 100% 的等級。",
            )
            st.metric(
                "逐步升級",
                f"{full_rate:.0%}",
                delta="全部成功" if full_fail is None else f"首次失敗於 {full_fail:.3g}",
                delta_color="off",
                border=True,
            )
            st.metric(
                "提升",
                f"{full_rate - raw_rate:+.0%}",
                border=True,
                help="逐步升級減只用原圖的整體成功率。",
            )

        view = _view(VIEWS_BARCODE, "sweep.view.barcode")
        x = alt.X("等級:Q", title=axis.label)
        with card():
            if view == "table":
                st.dataframe(
                    pd.DataFrame(sweep_rows), hide_index=True, alt="每個等級與樣本的解碼結果"
                )
            elif view == "rung":
                counts = ladder_eval.rung_counts(sweep_rows)
                if not counts:
                    st.caption("逐步升級沒有任何成功的樣本。")
                else:
                    bars = (
                        alt.Chart(pd.DataFrame(counts))
                        .mark_bar()
                        .encode(
                            x=x,
                            y=alt.Y("次數:Q", title="樣本數"),
                            color=alt.Color("階:N", title=None, sort=[r.value for r in Rung]),
                            tooltip=["等級", "階", "次數"],
                        )
                    )
                    st.altair_chart(bars, alt="各等級中逐步升級成功於哪一階的樣本數", height=320)
            else:
                sample = ean13_scene(ean13_codes(1, int(seed))[0], int(module_px))
                _thumbs(
                    [resize_short_side(axis.fn(sample, lv), 160) for lv in levels],
                    levels,
                    axis.label,
                )
                rates = (
                    alt.Chart(pd.DataFrame(ladder_eval.success_rates(sweep_rows)))
                    .mark_line(point=True)
                    .encode(
                        x=x,
                        y=alt.Y(
                            "成功率:Q",
                            title="成功率",
                            axis=alt.Axis(format="%"),
                            scale=alt.Scale(domain=[0, 1]),
                        ),
                        color=alt.Color("方法:N", title=None),
                        strokeDash=alt.StrokeDash("方法:N", legend=None),
                        tooltip=["等級", "方法", alt.Tooltip("成功率:Q", format=".0%")],
                    )
                )
                st.altair_chart(rates, alt=f"兩種方法的成功率隨{axis.label}變化", height=260)
    st.stop()

panel, results = workspace()
with panel:
    tab_sweep, tab_img, tab_cfg, tab_io = panel_tabs(
        ":material/tune: 掃描",
        ":material/image: 影像",
        ":material/tune: 參數",
        ":material/swap_vert: 匯出入",
    )
    with tab_sweep:
        axis_key, levels = _axis_controls()
        axis = SWEEP_AXES[axis_key]
        metric = st.segmented_control(
            "圖表指標",
            list(METRICS),
            default="模糊分數",
            key="sweep.metric",
            width="stretch",
        )
    with tab_img:
        source = image_source("sweep", allow_degradation=False)
    with tab_cfg:
        cfg = config_editor(QualityConfig, "quality")
    with tab_io:
        config_io(cfg, QualityConfig, "quality")

with results:
    if cfg is None:
        empty_state("參數不合法，請在左側「參數」修正後再試。", ":material/error:")
        st.stop()
    if source is None:
        empty_state("在左側「影像」選擇基準影像。", ":material/image:")
        st.stop()

    rows: list[dict[str, Any]] = []
    thumbs = []
    for level in levels:
        degraded = axis.fn(source.image, level)
        rows.append({"等級": round(level, 4), **viz.report_metrics(check_quality(degraded, cfg))})
        thumbs.append(resize_short_side(degraded, 160))
    df = pd.DataFrame(rows)

    with metric_row():
        for code in QUALITY_WARNINGS:
            hit = first_trigger(levels, list(df["警告"]), code.value)
            st.metric(
                warning_label(code),
                "未觸發" if hit is None else f"≥ {hit:.3g}",
                border=True,
                help=f"{axis.label}達到此等級時首次出現 {code.value}。",
            )

    view = _view(VIEWS_QUALITY, "sweep.view.quality")
    with card():
        if view == "table":
            st.dataframe(
                df,
                hide_index=True,
                alt="每個退化等級的品質檢查結果",
                column_config={"通過": st.column_config.CheckboxColumn("通過")},
            )
        else:
            _thumbs(thumbs, levels, axis.label)
            metric_name = metric or "模糊分數"
            line = (
                alt.Chart(df)
                .mark_line(point=True)
                .encode(
                    x=alt.X("等級:Q", title=axis.label),
                    y=alt.Y(f"{metric_name}:Q", title=metric_name),
                    tooltip=["等級", metric_name, "警告"],
                )
            )
            field, kind = METRICS[metric_name]
            chart: alt.Chart | alt.LayerChart = line
            if field is not None:
                rule = (
                    alt.Chart(pd.DataFrame({"門檻": [getattr(cfg, field)]}))
                    .mark_rule(strokeDash=[4, 4], color="#E11D48", strokeWidth=2)
                    .encode(y="門檻:Q", tooltip=[alt.Tooltip("門檻:Q", title=f"{field}（{kind}）")])
                )
                chart = line + rule
            st.altair_chart(chart, alt=f"{metric_name}隨{axis.label}變化的折線圖", height=260)
            if field is not None:
                st.caption(f"虛線：目前的 `{field}`（{kind}）= {getattr(cfg, field):g}")
