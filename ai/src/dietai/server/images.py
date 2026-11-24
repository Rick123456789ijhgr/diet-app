"""各 servicer 共用的影像輸入輸出：``ImageInput`` → 影像、影像 → ``ImageOutput``。"""

from __future__ import annotations

from collections.abc import Callable

import grpc

from dietai.devtools.images import decode_image
from dietai.devtools.store import ImageStore
from dietai.preprocess.types import Image
from dietai.server.rpc import RpcError
from dietai.v1 import preprocess_pb2


class ImageServicer:
    """持有開發模式的暫存區（可為 ``None``），提供 ``_image`` 與 ``_output``。"""

    def __init__(self, store: ImageStore | None = None) -> None:
        # 開發模式才有暫存區；沒有時只接受直接附上的影像
        self._store = store

    def _image(self, source: preprocess_pb2.ImageInput) -> Image:
        """由 ``ImageInput`` 取得影像：直接附上的檔案，或（僅開發模式）暫存區的 ``image_id``。

        錯誤一律轉成帶代碼的 ``RpcError``，讓 Go 端可依 ``ErrorInfo.reason`` 判斷。
        """
        # oneof source：encoded（正式與開發模式皆可）或 image_id（只有開發模式）
        kind = source.WhichOneof("source")
        if kind == "encoded":
            # 無法解碼或格式不支援屬於呼叫端的輸入錯誤，不是伺服器內部錯誤
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
            # 找不到時 get 丟 ImageNotFoundError，由 @unary 轉成 NOT_FOUND／IMAGE_NOT_FOUND
            return self._store.get(source.image_id).image
        # oneof 兩者皆未設定；最後一個參數為欄位名稱，放進 ErrorInfo.metadata["field"]
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
        # 輸入是直接附上的檔案（或非開發模式）時，結果也直接附上；只用編碼結果，不用 MIME 型別
        if self._store is None or source.WhichOneof("source") != "image_id":
            return preprocess_pb2.ImageOutput(encoded=encode()[0], width=w, height=h)
        # 開發模式：先查同一張原圖、同一個鍵是否已存過，沒有才存；encode 交給暫存區延後呼叫
        item = self._store.derived(source.image_id, key)
        if item is None:
            item = self._store.put_derived(source.image_id, key, img, description, encode=encode)
        return preprocess_pb2.ImageOutput(artifact_id=item.image_id, width=w, height=h)
