import time
from dataclasses import replace
from itertools import islice

import streamlit as st

from dietai.devtools.images import encode_png
from dietai.preprocess import (
    InvoiceQrConfig,
    LadderConfig,
    Rung,
    decode_with_ladder,
    ladder_variants,
    locate_invoice_qrs,
)
from wb import viz
from wb.st_config import config_io
from wb.st_ladder import engine_control, ladder_controls, ladder_params, make_decoder
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
from wb.text import RUNG_TEXT, rung_label, warning_label

MODES = {
    "barcode": ":material/barcode: 商品條碼",
    "invoice": ":material/qr_code_2: 電子發票 QR",
}
VIEWS = {
    "hits": ":material/center_focus_strong: 偵測結果",
    "rung": ":material/layers: 各階影像",
    "steps": ":material/list_alt: 步驟",
}
RUNG_NAMES = {r.value: zh for r, (zh, _en, _icon) in RUNG_TEXT.items()}

slot = page_header(
    "條碼與發票 QR",
    "逐步升級：依序嘗試原圖、灰階、二值化、去雜訊、旋轉校正、多尺度、銳化，第一次成功即停止。",
    ":material/barcode_reader:",
    phase=2,
)
with slot:
    mode = st.segmented_control(
        "模式",
        list(MODES),
        format_func=MODES.__getitem__,
        default="barcode",
        key="barcode.mode",
        label_visibility="collapsed",
    )
mode = mode or "barcode"

panel, results = workspace()

with panel:
    tab_img, tab_cfg, tab_io = panel_tabs(
        ":material/image: 影像", ":material/stairs: 階梯參數", ":material/swap_vert: 匯出入"
    )
    with tab_img:
        source = image_source(mode, scene="ean13" if mode == "barcode" else "invoice")
    with tab_cfg:
        extra_keys = ladder_controls("barcode")
        engine = engine_control("barcode")
        cfg, zx_cfg = ladder_params(extra_keys)
    with tab_io:
        config_io(cfg, LadderConfig, "ladder", extra_keys)

with results:
    if cfg is None or zx_cfg is None:
        empty_state("參數不合法，請在左側「階梯參數」修正後再試。", ":material/error:")
        st.stop()
    if source is None:
        empty_state("在左側「影像」選擇影像來源。", ":material/image:")
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

        ok = result.success and result.success_rung is not None
        slot = status_line(
            ok,
            "解碼成功" if ok else "解碼失敗",
            f"{source.description}　·　{w}×{h} px　·　{elapsed_ms:.1f} ms"
            f"　·　只用原圖：{'成功' if baseline.success else '失敗'}",
        )
        with slot:
            if ok and result.success_rung is not None:
                st.badge(rung_label(result.success_rung), color="green")
            for code in result.warnings:
                st.badge(warning_label(code), color="red", icon=":material/report:")

        with metric_row():
            st.metric(
                "成功於",
                "—" if result.success_index is None else f"第 {result.success_index + 1} 次",
                border=True,
            )
            st.metric("嘗試次數", len(attempts), border=True)
            st.metric(
                "條碼內容",
                hits[0].text if hits else "—",
                border=True,
                help="檢查碼錯誤的 EAN-13 不算成功（可在左側「階梯參數 → 驗證」關閉）。",
            )
    else:
        inv = locate_invoice_qrs(img, decoder, InvoiceQrConfig(cfg))
        elapsed_ms = (time.perf_counter() - start) * 1000
        attempts = inv.attempts
        sides = [("左碼", "Left", inv.left), ("右碼", "Right", inv.right)]
        hits = [hit for *_, hit in sides if hit is not None]
        labels = ["L", "R"] if inv.complete else ["?"]

        slot = status_line(
            inv.complete,
            "找到左右兩碼" if inv.complete else "結果不完整",
            f"{source.description}　·　{w}×{h} px　·　{elapsed_ms:.1f} ms"
            f"　·　嘗試 {len(attempts)} 次",
            warn=True,
        )
        with slot:
            for code in inv.warnings:
                st.badge(warning_label(code), color="orange", icon=":material/report:")
        if engine == "pyzbar":
            st.warning(
                "pyzbar 會轉換 QR 的字元編碼，位元組可能與原始內容不同。", icon=":material/info:"
            )

        with metric_row():
            for zh, _en, hit in sides:
                st.metric(
                    zh,
                    "未找到" if hit is None else f"{len(hit.raw)} bytes",
                    border=True,
                    help=None
                    if hit is None
                    else f"中心 ({hit.center[0]:.0f}, {hit.center[1]:.0f})",
                )
            st.metric("嘗試次數", len(attempts), border=True)

    views = dict(VIEWS)
    if mode == "invoice":
        views["bytes"] = ":material/data_array: 位元組"
    view = st.segmented_control(
        "檢視",
        list(views),
        format_func=views.__getitem__,
        default="hits",
        key="barcode.view",
        label_visibility="collapsed",
        width="stretch",
    )
    with card():
        if view == "bytes" and mode == "invoice":
            for zh, _en, hit in sides:
                st.markdown(f"**{zh}**")
                if hit is None:
                    st.caption("未找到")
                    continue
                st.code(viz.hex_preview(hit.raw), language=None, wrap_lines=True)
                st.code(viz.ascii_preview(hit.raw), language=None, wrap_lines=True)
            st.caption("只顯示原始位元組；中文解碼與欄位解析由 Go 端負責。")
        elif view == "steps":
            st.dataframe(
                viz.attempt_rows(attempts, RUNG_NAMES), hide_index=True, alt="各階嘗試的結果與耗時"
            )
        elif view == "rung" and attempts:
            index = st.selectbox(
                "嘗試",
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
