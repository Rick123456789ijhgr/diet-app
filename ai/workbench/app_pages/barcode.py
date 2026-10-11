import time
from dataclasses import replace
from itertools import islice

import streamlit as st

from dietai.preprocess import (
    InvoiceQrConfig,
    Rung,
    decode_with_ladder,
    ladder_variants,
    locate_invoice_qrs,
)
from wb import viz
from wb.images import encode_png
from wb.st_ladder import engine_control, ladder_controls, ladder_sidebar, make_decoder
from wb.st_layout import empty_state, page_header, section
from wb.st_source import image_source
from wb.text import RUNG_TEXT, rung_label, warning_label, zh_en

MODES = {
    "barcode": ":material/barcode: 商品條碼",
    "invoice": ":material/qr_code_2: 電子發票 QR",
}
RUNG_NAMES = {r.value: zh for r, (zh, _en, _icon) in RUNG_TEXT.items()}

page_header(
    "條碼與發票 QR",
    "Barcode & invoice QR",
    "逐步升級解碼：依序嘗試原圖、灰階、二值化、銳化、去雜訊、旋轉校正、多尺度，"
    "第一次成功即停止。左側欄調整各階參數。",
    ":material/barcode_reader:",
)

mode = st.segmented_control(
    "模式 · Mode",
    list(MODES),
    format_func=MODES.__getitem__,
    default="barcode",
    key="barcode.mode",
    label_visibility="collapsed",
)
mode = mode or "barcode"

inputs, results = st.columns([2, 3], gap="large")

with inputs:
    with st.container(border=True):
        section("輸入影像", "Input", ":material/input:")
        source = image_source(mode, scene="ean13" if mode == "barcode" else "invoice")

    with st.container(border=True):
        section("階梯", "Ladder", ":material/stairs:")
        extra_keys = ladder_controls("barcode")
        engine = engine_control("barcode")

cfg, zx_cfg = ladder_sidebar(extra_keys)

with results:
    if cfg is None or zx_cfg is None:
        empty_state("左側參數不合法，請修正後再試。", ":material/error:")
        st.stop()
    if source is None:
        empty_state("在左側選擇影像來源。", ":material/image:")
        st.stop()
    decoder = make_decoder(engine, zx_cfg)
    if decoder is None:
        st.stop()

    img = source.image
    h, w = img.shape[:2]
    start = time.perf_counter()

    if mode == "barcode":
        result = decode_with_ladder(img, decoder, cfg)
        elapsed_ms = (time.perf_counter() - start) * 1000
        baseline = decode_with_ladder(img, decoder, replace(cfg, rungs=(Rung.RAW,)))
        attempts = result.attempts
        hits = list(result.hits)
        labels = [h.text for h in hits]

        with st.container(border=True):
            with st.container(horizontal=True, vertical_alignment="center"):
                if result.success and result.success_rung is not None:
                    st.markdown("#### :green[:material/check_circle:] 解碼成功 · Decoded")
                    st.space("stretch")
                    st.badge(rung_label(result.success_rung), color="green")
                else:
                    st.markdown("#### :red[:material/cancel:] 解碼失敗 · Not decoded")
                    st.space("stretch")
                    for code in result.warnings:
                        st.badge(warning_label(code), color="red", icon=":material/report:")
            st.caption(
                f"{source.description}　·　{w}×{h} px　·　總耗時 {elapsed_ms:.1f} ms"
                f"　·　只用原圖：{'成功' if baseline.success else '失敗'}"
            )

        c1, c2, c3 = st.columns(3, gap="small")
        c1.metric(
            "成功於 · Rung",
            "—" if result.success_index is None else f"第 {result.success_index + 1} 次",
            border=True,
        )
        c2.metric("嘗試次數 · Attempts", len(attempts), border=True)
        c3.metric(
            "條碼內容 · Code",
            hits[0].text if hits else "—",
            border=True,
            help="檢查碼錯誤的 EAN-13 不算成功（可在左側欄「驗證」關閉）。",
        )
    else:
        inv = locate_invoice_qrs(img, decoder, InvoiceQrConfig(cfg))
        elapsed_ms = (time.perf_counter() - start) * 1000
        attempts = inv.attempts
        sides = [("左碼", "Left", inv.left), ("右碼", "Right", inv.right)]
        hits = [hit for *_, hit in sides if hit is not None]
        labels = ["L", "R"] if inv.complete else ["?"]

        with st.container(border=True):
            with st.container(horizontal=True, vertical_alignment="center"):
                if inv.complete:
                    st.markdown("#### :green[:material/check_circle:] 找到左右兩碼 · Found both")
                else:
                    st.markdown("#### :orange[:material/warning:] 結果不完整 · Incomplete")
                st.space("stretch")
                for code in inv.warnings:
                    st.badge(warning_label(code), color="orange", icon=":material/report:")
            st.caption(
                f"{source.description}　·　{w}×{h} px　·　總耗時 {elapsed_ms:.1f} ms"
                f"　·　嘗試 {len(attempts)} 次"
            )
        if engine == "pyzbar":
            st.warning(
                "pyzbar 會轉換 QR 的字元編碼，位元組可能與原始內容不同。", icon=":material/info:"
            )

        for col, (zh, en, hit) in zip(st.columns(2, gap="small"), sides, strict=True):
            with col, st.container(border=True):
                st.markdown(f"**{zh_en(zh, en)}**")
                if hit is None:
                    st.caption("未找到")
                    continue
                st.caption(
                    f"{len(hit.raw)} bytes　·　中心 ({hit.center[0]:.0f}, {hit.center[1]:.0f})"
                )
                st.code(viz.hex_preview(hit.raw), language=None, wrap_lines=True)
                st.code(viz.ascii_preview(hit.raw), language=None, wrap_lines=True)
        st.caption("只顯示原始位元組；中文解碼與欄位解析由 Go 端負責。")

    view = st.segmented_control(
        "檢視 · View",
        ["hits", "rung"],
        format_func={
            "hits": ":material/center_focus_strong: 偵測結果",
            "rung": ":material/layers: 各階影像",
        }.__getitem__,
        default="hits",
        key="barcode.view",
        label_visibility="collapsed",
        width="stretch",
    )
    with st.container(border=True):
        if view == "rung" and attempts:
            index = st.selectbox(
                "嘗試 · Attempt",
                range(len(attempts)),
                format_func=lambda i: f"#{i + 1} {rung_label(attempts[i].rung)}",
                index=len(attempts) - 1,
                key="barcode.attempt",
            )
            variant = next(islice(ladder_variants(img, cfg), index, None))
            if variant.image is None:
                st.caption(f"此階已略過（{variant.params}）。")
            else:
                st.image(variant.image, channels="BGR", alt="送進解碼器的影像版本")
                st.caption(
                    f"送進解碼器的影像：{variant.image.shape[1]}×{variant.image.shape[0]} px"
                    f"　·　參數 {dict(variant.params) or '無'}"
                )
        else:
            marked = viz.draw_hits(img, hits, labels)
            st.image(marked, channels="BGR", alt="原圖與偵測到的條碼四角")
            if hits:
                st.dataframe(viz.hit_rows(hits), hide_index=True, alt="解碼結果")
            st.download_button(
                "下載 PNG",
                encode_png(img),
                file_name="workbench_barcode.png",
                mime="image/png",
                icon=":material/download:",
                type="tertiary",
            )

    with st.expander("步驟紀錄 · Steps", icon=":material/list_alt:", expanded=True):
        st.dataframe(
            viz.attempt_rows(attempts, RUNG_NAMES), hide_index=True, alt="各階嘗試的結果與耗時"
        )
