"""``PreprocessService``：正式前處理（Go → Python）。

影像型結果在開發模式存進暫存區、回傳 ``artifact_id``（同一張原圖以相同參數重跑時沿用，
避免暫存區被重複的結果占滿）；正式模式直接附上檔案（營養標示用無損 PNG，供之後 OCR）。
"""

from __future__ import annotations

from dietai.devtools.configs import config_from_override
from dietai.devtools.images import encode_png
from dietai.preprocess import (
    FoodConfig,
    InvoiceQrConfig,
    LabelConfig,
    LadderConfig,
    QualityConfig,
    VlmImage,
    ZxingConfig,
    ZxingDecoder,
    check_quality,
    decode_with_ladder,
    locate_invoice_qrs,
    preprocess_food,
    preprocess_label,
)
from dietai.server import convert
from dietai.server.images import ImageServicer
from dietai.server.rpc import unary
from dietai.v1 import preprocess_pb2, preprocess_pb2_grpc


class PreprocessServicer(ImageServicer, preprocess_pb2_grpc.PreprocessServiceServicer):
    """``PreprocessService`` 的實作：只做 proto ↔ domain 轉換，處理邏輯都在 ``dietai.preprocess``。

    每個 RPC 的步驟相同：設定 JSON 覆寫 → ``config_from_override`` 建構並驗證設定 →
    ``_image`` 取得輸入影像 → 呼叫前處理函式 → 轉成回應。``@unary`` 讓計算在執行緒中執行，
    並把例外轉成 gRPC 狀態（例如 ``ConfigError`` → ``INVALID_ARGUMENT``／``INVALID_CONFIG``、
    暫存區找不到影像 → ``NOT_FOUND``／``IMAGE_NOT_FOUND``，其他未預期的例外 → ``INTERNAL``）。
    """

    @unary
    def CheckQuality(
        self, request: preprocess_pb2.CheckQualityRequest
    ) -> preprocess_pb2.CheckQualityResponse:
        """共通品質檢查（模糊、曝光、解析度）。"""
        # config.json 只含與預設值不同的欄位；空字串表示全部用預設值
        cfg = config_from_override(QualityConfig, request.config.json)
        report = check_quality(self._image(request.image), cfg)
        return convert.quality_response(report)

    @unary
    def DecodeBarcode(
        self, request: preprocess_pb2.DecodeBarcodeRequest
    ) -> preprocess_pb2.DecodeBarcodeResponse:
        """條碼逐步升級解碼；階梯設定與 zxing 設定分成兩個覆寫欄位。"""
        ladder = config_from_override(LadderConfig, request.ladder.json)
        decoder = ZxingDecoder(config_from_override(ZxingConfig, request.zxing.json))
        result = decode_with_ladder(self._image(request.image), decoder, ladder)
        return convert.barcode_response(result)

    @unary
    def LocateInvoiceQr(
        self, request: preprocess_pb2.LocateInvoiceQrRequest
    ) -> preprocess_pb2.LocateInvoiceQrResponse:
        """電子發票雙 QR 定位。"""
        # proto 只帶 ladder 覆寫，這裡包成 InvoiceQrConfig（該類別目前只有 ladder 一個欄位）
        ladder = config_from_override(LadderConfig, request.ladder.json)
        decoder = ZxingDecoder(config_from_override(ZxingConfig, request.zxing.json))
        result = locate_invoice_qrs(self._image(request.image), decoder, InvoiceQrConfig(ladder))
        return convert.invoice_response(result)

    @unary
    def PreprocessLabel(
        self, request: preprocess_pb2.PreprocessLabelRequest
    ) -> preprocess_pb2.PreprocessLabelResponse:
        """營養標示前處理；輸出影像以無損 PNG 傳回（之後要做 OCR，不能有 JPEG 失真）。"""
        cfg = config_from_override(LabelConfig, request.config.json)
        result = preprocess_label(self._image(request.image), cfg)
        out = preprocess_pb2.PreprocessLabelResponse(
            image=self._output(
                request.image,
                # 暫存區去重複的鍵：功能前綴＋完整設定，同一張原圖以相同參數重跑時沿用
                f"label:{convert.config_key(cfg)}",
                result.image,
                "營養標示輸出",
                lambda: (encode_png(result.image), "image/png"),
            ),
            # proto3 的純量欄位沒有 None：未啟用定位或找不到時以空字串、
            # 未啟用光斑偵測時以 -1 表示（正常的比例介於 0 與 1）
            quad_method=result.quad_method or "",
            glare_ratio=result.glare.ratio if result.glare is not None else -1.0,
            warnings=[w.value for w in result.warnings],
            steps=convert.steps(result.steps),
        )
        # repeated 欄位無法在建構時傳 None，找到四角時才另外填入；空串列即「未找到」
        if result.quad is not None:
            out.quad.extend(preprocess_pb2.Point(x=float(x), y=float(y)) for x, y in result.quad)
        return out

    @unary
    def PreprocessFood(
        self, request: preprocess_pb2.PreprocessFoodRequest
    ) -> preprocess_pb2.PreprocessFoodResponse:
        """食物照片前處理；影像以實際要送給 VLM 的 JPEG 傳回（不重新編碼）。"""
        cfg = config_from_override(FoodConfig, request.config.json)
        result = preprocess_food(self._image(request.image), cfg)
        key = convert.config_key(cfg)

        def vlm(v: VlmImage, role: str, description: str) -> preprocess_pb2.VlmImage:
            """``food.VlmImage`` → proto ``VlmImage``；``role`` 區分整張與第幾道菜的暫存鍵。"""
            # 直接沿用 resize_for_vlm 產生的 JPEG 位元組，使 num_bytes 與實際送出的大小一致
            image = self._output(
                request.image,
                f"food:{role}:{key}",
                v.image,
                description,
                lambda: (v.jpeg, "image/jpeg"),
            )
            return preprocess_pb2.VlmImage(image=image, num_bytes=len(v.jpeg), scale=v.scale)

        out = preprocess_pb2.PreprocessFoodResponse(
            whole=vlm(result.whole, "whole", "VLM 輸入（整張）"),
            # proto 的 repeated 欄位無法區分 None 與空串列，另以 *_enabled 表示該段是否啟用，
            # 讓呼叫端分辨「未啟用」與「啟用但找不到」
            dishes_enabled=result.dishes is not None,
            dishes=[convert.box(b) for b in result.dishes or ()],
            crops=[
                vlm(c, f"crop{i}", f"VLM 輸入（第 {i + 1} 道菜）")
                for i, c in enumerate(result.crops)
            ],
            plates_enabled=result.plates is not None,
            plates=[convert.ellipse(e) for e in result.plates or ()],
            warnings=[w.value for w in result.warnings],
            steps=convert.steps(result.steps),
        )
        return out
