"""工作台的暫存影像：上傳、合成、退化後的影像與診斷影像共用同一個 ID 空間。

存在記憶體中，依「最久未使用」淘汰；同時限制張數與總位元組（照片原檔解碼後很大，
一張 1200 萬像素的照片約 36 MB）。重啟即清空，前端遇到找不到 ID 時重新上傳。
可在多個執行緒中同時使用。
"""

from __future__ import annotations

import secrets
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from dietai.devtools.images import encode_jpeg
from dietai.preprocess.types import Image

DEFAULT_MAX_ITEMS = 256  # 主要由位元組上限控制；診斷影像與裁切多半很小
DEFAULT_MAX_BYTES = 1 << 30  # 1 GiB


class ImageNotFoundError(KeyError):
    """找不到暫存影像（ID 錯誤，或已被淘汰、服務重啟）。"""

    def __init__(self, image_id: str) -> None:
        super().__init__(image_id)
        self.image_id = image_id

    def __str__(self) -> str:
        return f"找不到暫存影像 {self.image_id}（可能已被淘汰或服務已重啟）"


@dataclass
class StoredImage:
    image_id: str
    image: Image
    description: str
    truth: dict[str, Any] | None = None
    # 編碼後的檔案：可預先給（例如送給 VLM 的 JPEG 原檔），否則第一次取用時才編碼
    _encoded: bytes | None = field(default=None, repr=False)
    _content_type: str = "image/jpeg"

    @property
    def width(self) -> int:
        return int(self.image.shape[1])

    @property
    def height(self) -> int:
        return int(self.image.shape[0])

    @property
    def nbytes(self) -> int:
        return int(self.image.nbytes)


class ImageStore:
    def __init__(
        self, max_items: int = DEFAULT_MAX_ITEMS, max_bytes: int = DEFAULT_MAX_BYTES
    ) -> None:
        if max_items < 1 or max_bytes < 1:
            raise ValueError("max_items 與 max_bytes 必須為正")
        self.max_items = max_items
        self.max_bytes = max_bytes
        self._items: OrderedDict[str, StoredImage] = OrderedDict()
        self._bytes = 0
        # (來源 ID, 參數鍵) → 衍生影像 ID；例如同一張圖以相同參數退化時直接重用
        self._derived: dict[tuple[str, str], str] = {}
        self._lock = threading.Lock()

    def put(
        self,
        image: Image,
        description: str,
        truth: dict[str, Any] | None = None,
        encoded: tuple[bytes, str] | None = None,
    ) -> StoredImage:
        """存入影像；``encoded`` 為（檔案位元組, content type），取用時原樣回傳。"""
        item = StoredImage(secrets.token_hex(8), image, description, truth)
        if encoded is not None:
            item._encoded, item._content_type = encoded
        with self._lock:
            self._items[item.image_id] = item
            self._bytes += item.nbytes
            self._evict()
        return item

    def get(self, image_id: str) -> StoredImage:
        with self._lock:
            item = self._items.get(image_id)
            if item is None:
                raise ImageNotFoundError(image_id)
            self._items.move_to_end(image_id)
            return item

    def derived(self, source_id: str, key: str) -> StoredImage | None:
        """取得先前以 ``put_derived`` 存入的衍生影像；不存在或已淘汰時回傳 ``None``。"""
        with self._lock:
            derived_id = self._derived.get((source_id, key))
            item = self._items.get(derived_id) if derived_id else None
            if item is None:
                return None
            self._items.move_to_end(item.image_id)
            return item

    def put_derived(
        self,
        source_id: str,
        key: str,
        image: Image,
        description: str,
        truth: dict[str, Any] | None = None,
        encoded: tuple[bytes, str] | None = None,
    ) -> StoredImage:
        item = self.put(image, description, truth, encoded)
        with self._lock:
            self._derived[(source_id, key)] = item.image_id
        return item

    def encoded(self, image_id: str) -> tuple[bytes, str]:
        """取得編碼後的影像與 content type（預設 JPEG）。"""
        item = self.get(image_id)
        if item._encoded is None:
            item._encoded = encode_jpeg(item.image)
        return item._encoded, item._content_type

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)

    @property
    def total_bytes(self) -> int:
        with self._lock:
            return self._bytes

    def _evict(self) -> None:
        # 至少保留最新的一張，即使它本身就超過位元組上限
        while len(self._items) > 1 and (
            len(self._items) > self.max_items or self._bytes > self.max_bytes
        ):
            _, old = self._items.popitem(last=False)
            self._bytes -= old.nbytes
        live = set(self._items)
        self._derived = {k: v for k, v in self._derived.items() if v in live and k[0] in live}
