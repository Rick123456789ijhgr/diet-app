"""``LabelService``：營養標示讀取（Go → Python，模組二）。

只做 proto ↔ domain 轉換，流程都在 ``dietai.label_parsing.read_label``。OCR 引擎由呼叫端
（``__main__``）在服務啟動時建立並注入；建立失敗時服務仍照常啟動，只有本 RPC 回傳
``FAILED_PRECONDITION``／``OCR_UNAVAILABLE``，不影響前處理等其他服務。
"""

from __future__ import annotations

import grpc

from dietai.devtools.configs import config_from_override
from dietai.devtools.images import encode_png
from dietai.devtools.store import ImageStore
from dietai.label_parsing.config import LabelReadConfig
from dietai.label_parsing.ocr import OcrEngine
from dietai.label_parsing.reader import read_label
from dietai.server import convert
from dietai.server.images import ImageServicer
from dietai.server.rpc import RpcError, unary
from dietai.v1 import label_pb2, label_pb2_grpc


class LabelServicer(ImageServicer, label_pb2_grpc.LabelServiceServicer):
    """``LabelService`` 的實作。

    ``ocr`` 須可在多執行緒中共用（正式為 ``LockedOcr(CachedOcr(...))``）；為 ``None`` 時
    ``ParseLabel`` 一律回傳 ``OCR_UNAVAILABLE``，``ocr_error`` 為給呼叫端看的原因。
    """

    def __init__(
        self,
        ocr: OcrEngine | None,
        store: ImageStore | None = None,
        ocr_error: str = "OCR 引擎未設定",
    ) -> None:
        super().__init__(store)
        self._ocr = ocr
        self._ocr_error = ocr_error

    @unary
    def ParseLabel(self, request: label_pb2.ParseLabelRequest) -> label_pb2.ParseLabelResponse:
        """讀取一張營養標示照片；結果只是候選值，數值以十進位字串傳回。"""
        # 設定先驗證：設定錯誤比引擎無法使用更該先讓呼叫端知道
        cfg = config_from_override(LabelReadConfig, request.config.json)
        if self._ocr is None:
            raise RpcError(grpc.StatusCode.FAILED_PRECONDITION, "OCR_UNAVAILABLE", self._ocr_error)
        reading = read_label(self._image(request.image), self._ocr, cfg)
        image = self._output(
            request.image,
            # 暫存區去重複的鍵：功能前綴＋引擎＋完整設定
            f"label_read:{self._ocr.name}:{convert.config_key(cfg)}",
            reading.image,
            "營養標示讀取（OCR 輸入）",
            lambda: (encode_png(reading.image), "image/png"),
        )
        return convert.label_response(reading, image)
