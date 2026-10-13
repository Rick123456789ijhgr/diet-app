"""``PreprocessService``：正式前處理（Go → Python）。

階段 1 實作 ``CheckQuality``；其餘 RPC 由產生的基底類別回傳 ``UNIMPLEMENTED``。
"""

from __future__ import annotations

import grpc

from dietai.devtools.configs import config_from_override
from dietai.devtools.images import decode_image
from dietai.devtools.store import ImageStore
from dietai.preprocess import QualityConfig, check_quality
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
