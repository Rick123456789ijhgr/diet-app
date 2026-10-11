import time
from dataclasses import replace

import numpy as np
import streamlit as st

from dietai.preprocess import LabelConfig, label_edges, preprocess_label
from wb import viz
from wb.images import encode_png
from wb.st_config import config_sidebar
from wb.st_layout import empty_state, page_header, section
from wb.st_source import image_source
from wb.text import warning_label

CORNERS = ("左上", "右上", "右下", "左下")
METHODS = {"contour": "輪廓法 · Contour", "hough": "直線法 · Hough"}
VIEWS = {
    "located": ":material/crop_free: 定位",
    "edges": ":material/border_style: 邊緣",
    "glare": ":material/flare: 光斑遮罩",
    "output": ":material/output: 輸出",
}

page_header(
    "營養標示",
    "Nutrition label",
    "定位表格框並透視校正，再處理反光與增強對比。左側欄可個別關閉每一段並調整門檻。",
    ":material/receipt_long:",
)
cfg = config_sidebar(LabelConfig, "label")

inputs, results = st.columns([2, 3], gap="large")

with inputs, st.container(border=True):
    section("輸入影像", "Input", ":material/input:")
    source = image_source("label", scene="nutrition")

with results:
    if cfg is None:
        empty_state("左側參數不合法，請修正後再試。", ":material/error:")
        st.stop()
    if source is None:
        empty_state("在左側選擇影像來源。", ":material/image:")
        st.stop()

    img = source.image
    start = time.perf_counter()
    result = preprocess_label(img, cfg)
    elapsed_ms = (time.perf_counter() - start) * 1000
    h, w = img.shape[:2]
    oh, ow = result.image.shape[:2]

    with st.container(border=True):
        with st.container(horizontal=True, vertical_alignment="center"):
            if not result.warnings:
                st.markdown("#### :green[:material/check_circle:] 處理完成 · Done")
            else:
                st.markdown("#### :orange[:material/warning:] 有警告 · Warnings")
            st.space("stretch")
            for code in result.warnings:
                st.badge(warning_label(code), color="orange", icon=":material/report:")
        st.caption(
            f"{source.description}　·　輸入 {w}×{h} px → 輸出 {ow}×{oh} px"
            f"　·　處理耗時 {elapsed_ms:.1f} ms"
        )

    errors = None
    if result.quad is not None and source.truth_quad is not None:
        errors = viz.quad_errors(result.quad, source.truth_quad)

    col_method, col_error, col_glare = st.columns(3, gap="small")
    if not cfg.enable_rectify:
        col_method.metric("定位方法 · Method", "未啟用", border=True)
    else:
        col_method.metric(
            "定位方法 · Method",
            METHODS[result.quad_method] if result.quad_method else "找不到",
            border=True,
            help="先找最大的凸四邊形輪廓；失敗時改用 HoughLinesP 求外側四條直線的交點。",
        )
    col_error.metric(
        "四角平均誤差 · Corner error",
        f"{np.mean(errors):.1f} px" if errors is not None else "—",
        border=True,
        help="與合成影像真實四角的平均距離（原圖像素）；任務書驗收為 < 10 px。"
        "上傳照片或套用退化後沒有真值。",
    )
    glare_ratio = result.glare.ratio if result.glare is not None else None
    col_glare.metric(
        "光斑比例 · Glare",
        f"{glare_ratio:.2%}" if glare_ratio is not None else "未啟用",
        delta=(
            f"{glare_ratio - cfg.glare_max_ratio:+.2%} 相對上限"
            if glare_ratio is not None
            else None
        ),
        delta_color="inverse",
        border=True,
        help=f"校正後影像中被判為光斑的面積比例；超過 {cfg.glare_max_ratio:.0%} 時不修補、"
        "改為警告重拍。",
    )

    view = st.segmented_control(
        "檢視 · View",
        list(VIEWS),
        format_func=VIEWS.__getitem__,
        default="located",
        key="label.view",
        label_visibility="collapsed",
        width="stretch",
    )
    with st.container(border=True):
        if view == "edges":
            st.image(label_edges(img, cfg), alt="定位用的 Canny 邊緣圖")
            st.caption(
                f"縮小到短邊 {cfg.detect_short_side} px 後的 Canny 邊緣"
                f"（門檻 {cfg.canny_low}／{cfg.canny_high}，已膨脹 3×3）；"
                "輪廓與直線都在這張圖上找。"
            )
        elif view == "glare":
            if result.glare is None:
                st.caption("光斑步驟未啟用。")
            else:
                # 遮罩是在校正後、修補前的影像上算的，疊回同一個版本
                before = replace(cfg, enable_glare=False, enable_contrast=False)
                base = preprocess_label(img, before).image
                st.image(viz.mask_overlay(base, result.glare.mask), channels="BGR", alt="光斑遮罩")
                st.caption(
                    f":red[■] 亮度 ≥ {cfg.glare_v_min} 且飽和度 ≤ {cfg.glare_s_max}，"
                    f"再擴張 {cfg.glare_dilate_px} px。"
                )
        elif view == "output":
            st.image(
                result.image,
                channels="BGR" if result.image.ndim == 3 else "RGB",
                alt="前處理後的營養標示",
            )
            st.download_button(
                "下載 PNG",
                encode_png(result.image),
                file_name="workbench_label.png",
                mime="image/png",
                icon=":material/download:",
                type="tertiary",
            )
        else:
            quads = []
            if source.truth_quad is not None:
                quads.append((source.truth_quad, viz.TRUTH_COLOR, "truth"))
            if result.quad is not None:
                quads.append((result.quad, viz.FOUND_COLOR, result.quad_method or ""))
            st.image(viz.draw_quads(img, quads), channels="BGR", alt="找到的表格四角")
            st.caption(":green[■] 找到的四角　:blue[■] 真實四角（合成影像）　實心大圓為左上角")
            if errors is not None:
                st.dataframe(
                    [
                        {"角": name, "誤差（px）": round(e, 2)}
                        for name, e in zip(CORNERS, errors, strict=True)
                    ],
                    hide_index=True,
                    alt="四角各自的誤差",
                )

    with st.expander("步驟紀錄 · Steps", icon=":material/list_alt:"):
        st.dataframe(viz.step_rows(result.steps), hide_index=True, alt="各步驟的耗時與參數")
