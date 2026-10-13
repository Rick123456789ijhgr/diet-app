import time

import streamlit as st

from dietai.devtools import views
from dietai.devtools.images import decode_image
from dietai.preprocess import FoodConfig, detect_plate_ellipse, dish_foreground, preprocess_food
from wb import viz
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

VLM_SIDES = (384, 512, 768, 1024, 1536, 2048)  # E2 事前試算的候選長邊（只供觀察）
VIEWS = {
    "boxes": ":material/crop: 裁切框",
    "mask": ":material/select_all: 前景遮罩",
    "plates": ":material/radio_button_unchecked: 盤緣",
    "crops": ":material/grid_view: 各道菜",
    "vlm": ":material/compress: VLM 輸入",
    "steps": ":material/list_alt: 步驟",
}

page_header(
    "食物照片",
    "切出各道菜、偵測盤緣，並把整張與各裁切縮放壓縮成送給 VLM 的大小。",
    ":material/restaurant:",
    phase=4,
)
panel, results = workspace()

with panel:
    tab_img, tab_cfg, tab_io = panel_tabs(
        ":material/image: 影像", ":material/tune: 參數", ":material/swap_vert: 匯出入"
    )
    with tab_img:
        source = image_source("food", scene="food")
    with tab_cfg:
        cfg = config_editor(FoodConfig, "food")
    with tab_io:
        config_io(cfg, FoodConfig, "food")

with results:
    if cfg is None:
        empty_state("參數不合法，請在左側「參數」修正後再試。", ":material/error:")
        st.stop()
    if source is None:
        empty_state("在左側「影像」選擇影像來源。", ":material/image:")
        st.stop()

    img = source.image
    start = time.perf_counter()
    result = preprocess_food(img, cfg)
    elapsed_ms = (time.perf_counter() - start) * 1000
    h, w = img.shape[:2]
    vh, vw = result.whole.image.shape[:2]
    truth = source.truth_plates

    slot = status_line(
        not result.warnings,
        "處理完成" if not result.warnings else "有警告",
        f"{source.description}　·　輸入 {w}×{h} px → VLM {vw}×{vh} px"
        f"　·　處理耗時 {elapsed_ms:.1f} ms",
        warn=True,
    )
    with slot:
        for code in result.warnings:
            st.badge(warning_label(code), color="orange", icon=":material/report:")

    metrics = metric_row()
    if result.dishes is None:
        metrics.metric("菜數", "未啟用", border=True)
    else:
        metrics.metric(
            "菜數",
            len(result.dishes),
            delta=f"{len(result.dishes) - len(truth):+d} 相對真值" if truth is not None else None,
            delta_color="off",
            border=True,
            help="切出的框數；合成影像會與真實盤數比較。相鄰或接觸的盤子會併成一個框。",
        )
    if result.plates is None:
        metrics.metric(
            "盤緣",
            "未啟用",
            border=True,
            help="在左側「參數 → 步驟開關」開啟盤緣橢圓（選做）。",
        )
    else:
        metrics.metric("盤緣", len(result.plates), border=True)
    total = result.whole.num_bytes + sum(c.num_bytes for c in result.crops)
    metrics.metric(
        "VLM 大小",
        f"{total / 1024:.0f} KB",
        border=True,
        help=f"整張與 {len(result.crops)} 張裁切的 JPEG 總大小"
        f"（長邊 ≤ {cfg.vlm_max_side} px、品質 {cfg.vlm_jpeg_quality}）。",
    )

    view = st.segmented_control(
        "檢視",
        list(VIEWS),
        format_func=VIEWS.__getitem__,
        default="boxes",
        key="food.view",
        label_visibility="collapsed",
        width="stretch",
    )
    with card():
        if view == "steps":
            st.dataframe(viz.step_rows(result.steps), hide_index=True, alt="各步驟的耗時與參數")
        elif view == "mask":
            mask = dish_foreground(img, cfg)
            st.image(views.mask_on_small(img, mask), channels="BGR", alt="切菜用的前景遮罩")
            st.caption(
                f":red[■] 與背景色（四周 {cfg.bg_border_ratio:.1%} 邊框的中位數）ΔE > "
                f"{cfg.bg_distance:g} 的前景，形態學半徑 {cfg.morph_px} px，"
                f"已縮小到短邊 {cfg.detect_short_side} px。"
            )
        elif view == "plates":
            # 盤緣步驟關閉時仍在這裡試算，方便調參；結果不影響輸出
            plates = result.plates if result.plates is not None else detect_plate_ellipse(img, cfg)
            ellipses = [(e, viz.TRUTH_COLOR) for e in truth or ()]
            ellipses += [(e, viz.FOUND_COLOR) for e in plates]
            st.image(viz.draw_ellipses(img, ellipses), channels="BGR", alt="盤緣橢圓")
            note = "" if cfg.enable_plate else "（步驟未啟用，此處僅試算）"
            st.caption(f":violet[■] 找到 {len(plates)} 個　:blue[■] 真實盤緣（合成影像）{note}")
            if plates:
                st.dataframe(
                    [
                        {
                            "中心": f"({e.cx:.0f}, {e.cy:.0f})",
                            "長軸（px）": round(e.major, 1),
                            "短軸（px）": round(e.minor, 1),
                            "短長比": round(e.minor / e.major, 2),
                            "角度（°）": round(e.angle, 1),
                        }
                        for e in plates
                    ],
                    hide_index=True,
                    alt="找到的盤緣橢圓",
                )
        elif view == "crops":
            if not result.crops:
                st.caption("沒有裁切：切菜未啟用或切不出任何框。VLM 只會收到整張影像。")
            else:
                cols = st.columns(3)
                for i, (box, crop) in enumerate(
                    zip(result.dishes or (), result.crops, strict=True)
                ):
                    with cols[i % 3]:
                        st.image(decode_image(crop.jpeg), channels="BGR", alt=f"第 {i + 1} 道菜")
                        st.caption(
                            f"#{i + 1}　({box.x}, {box.y}) {box.w}×{box.h}"
                            f"　·　{crop.num_bytes / 1024:.0f} KB"
                        )
        elif view == "vlm":
            st.image(decode_image(result.whole.jpeg), channels="BGR", alt="VLM 實際收到的整張影像")
            st.caption(
                f"解碼後的 JPEG：{vw}×{vh} px、{result.whole.num_bytes / 1024:.0f} KB"
                f"（縮放 ×{result.whole.scale:.3f}）。"
            )
            st.markdown("**尺寸試算**")
            st.dataframe(
                viz.vlm_size_rows(img, VLM_SIDES, cfg.vlm_jpeg_quality),
                hide_index=True,
                alt="不同長邊上限下的輸出尺寸與 JPEG 大小",
            )
            st.caption("最終尺寸由 E2 實驗依準確率決定；這裡只列出檔案大小的變化。")
        else:
            boxes = [(e.bbox(), viz.TRUTH_COLOR, "") for e in truth or ()]
            boxes += [(b, viz.FOUND_COLOR, f"#{i + 1}") for i, b in enumerate(result.dishes or ())]
            st.image(viz.draw_boxes(img, boxes), channels="BGR", alt="切出的各道菜")
            st.caption(":violet[■] 切出的框（已外擴）　:blue[■] 真實盤子的外接框（合成影像）")
