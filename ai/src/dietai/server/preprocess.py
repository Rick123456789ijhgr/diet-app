"""``PreprocessService``：正式前處理（Go → Python）。

影像型結果在開發模式存進暫存區、回傳 ``artifact_id``（同一張原圖以相同參數重跑時沿用，
避免暫存區被重複的結果占滿）；正式模式直接附上檔案（營養標示用無損 PNG，供之後 OCR）。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import grpc

from dietai.devtools.configs import config_from_override
from dietai.devtools.images import decode_image, encode_png
from dietai.devtools.store import ImageStore
from dietai.preprocess import (
    FoodConfig,
    InvoiceQrConfig,
    LabelConfig,
    LadderConfig,
    QualityConfig,
    ZxingConfig,
    ZxingDecoder,
    check_quality,
    decode_with_ladder,
    locate_invoice_qrs,
    preprocess_food,
    preprocess_label,
)
from dietai.preprocess.types import Image
from dietai.server import convert
from dietai.server.rpc import RpcError, unary
from dietai.v1 import preprocess_pb2, preprocess_pb2_grpc


class PreprocessServicer(preprocess_pb2_grpc.PreprocessServiceServicer):
    def __init__(self, store: ImageStore | None = None) -> None:
        # 開發模式才有暫存區；沒有時只接受直接附上的影像
        self._store = store

    @unary
    def CheckQuality(
        self, request: preprocess_pb2.CheckQualityRequest
    ) -> preprocess_pb2.CheckQualityResponse:
        cfg = config_from_override(QualityConfig, request.config.json)
        report = check_quality(self._image(request.image), cfg)
        return convert.quality_response(report)

    @unary
    def DecodeBarcode(
        self, request: preprocess_pb2.DecodeBarcodeRequest
    ) -> preprocess_pb2.DecodeBarcodeResponse:
        ladder = config_from_override(LadderConfig, request.ladder.json)
        decoder = ZxingDecoder(config_from_override(ZxingConfig, request.zxing.json))
        result = decode_with_ladder(self._image(request.image), decoder, ladder)
        return convert.barcode_response(result)

    @unary
    def LocateInvoiceQr(
        self, request: preprocess_pb2.LocateInvoiceQrRequest
    ) -> preprocess_pb2.LocateInvoiceQrResponse:
        ladder = config_from_override(LadderConfig, request.ladder.json)
        decoder = ZxingDecoder(config_from_override(ZxingConfig, request.zxing.json))
        result = locate_invoice_qrs(self._image(request.image), decoder, InvoiceQrConfig(ladder))
        return convert.invoice_response(result)

    @unary
    def PreprocessLabel(
        self, request: preprocess_pb2.PreprocessLabelRequest
    ) -> preprocess_pb2.PreprocessLabelResponse:
        cfg = config_from_override(LabelConfig, request.config.json)
        result = preprocess_label(self._image(request.image), cfg)
        out = preprocess_pb2.PreprocessLabelResponse(
            image=self._output(
                request.image,
                f"label:{convert.config_key(cfg)}",
                result.image,
                "營養標示輸出",
                lambda: (encode_png(result.image), "image/png"),
            ),
            quad_method=result.quad_method or "",
            glare_ratio=result.glare.ratio if result.glare is not None else -1.0,
            warnings=[w.value for w in result.warnings],
            steps=convert.steps(result.steps),
        )
        if result.quad is not None:
            out.quad.extend(preprocess_pb2.Point(x=float(x), y=float(y)) for x, y in result.quad)
        return out

    @unary
    def PreprocessFood(
        self, request: preprocess_pb2.PreprocessFoodRequest
    ) -> preprocess_pb2.PreprocessFoodResponse:
        cfg = config_from_override(FoodConfig, request.config.json)
        result = preprocess_food(self._image(request.image), cfg)
        key = convert.config_key(cfg)

        def vlm(v: Any, role: str, description: str) -> preprocess_pb2.VlmImage:
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

    def _image(self, source: preprocess_pb2.ImageInput) -> Image:
        kind = source.WhichOneof("source")
        if kind == "encoded":
            try:
                return decode_image(source.encoded)
            except ValueError as exc:
                raise RpcError(
                    grpc.StatusCode.INVALID_ARGUMENT, "IMAGE_DECODE_FAILED", str(exc)
                ) from exc
        if kind == "image_id":
            if self._store is None:
                raise RpcError(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    "DEV_TOOLS_DISABLED",
                    "image_id 只在開發模式（WORKBENCH_DEV_TOOLS=1）可用",
                )
            return self._store.get(source.image_id).image
        raise RpcError(grpc.StatusCode.INVALID_ARGUMENT, "IMAGE_REQUIRED", "缺少影像", "image")

    def _output(
        self,
        source: preprocess_pb2.ImageInput,
        key: str,
        img: Image,
        description: str,
        encode: Callable[[], tuple[bytes, str]],
    ) -> preprocess_pb2.ImageOutput:
        """影像型結果：開發模式存進暫存區（同一張原圖、同一組參數只存一次，取用時才編碼），
        否則直接附上編碼後的檔案。"""
        h, w = img.shape[:2]
        if self._store is None or source.WhichOneof("source") != "image_id":
            return preprocess_pb2.ImageOutput(encoded=encode()[0], width=w, height=h)
        item = self._store.derived(source.image_id, key)
        if item is None:
            item = self._store.put_derived(source.image_id, key, img, description, encode=encode)
        return preprocess_pb2.ImageOutput(artifact_id=item.image_id, width=w, height=h)
