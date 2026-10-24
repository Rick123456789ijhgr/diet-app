"""工作台的暫存影像：上傳、合成、退化後的影像與診斷影像共用同一個 ID 空間。

存在記憶體中，依「最久未使用」淘汰；同時限制張數與總位元組（照片原檔解碼後很大，
一張 1200 萬像素的照片約 36 MB）。重啟即清空，前端遇到找不到 ID 時重新上傳。
可在多個執行緒中同時使用。
"""

from __future__ import annotations

import secrets
import threading
from collections import OrderedDict
from collections.abc import Callable
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
    """一張暫存影像與附帶資訊。

    ``truth`` 為合成影像的真值（回傳給前端比對）；``meta`` 只在服務內部使用。
    編碼結果在第一次取用時才產生並快取，之後計入 ``nbytes``。
    """

    image_id: str
    image: Image
    description: str
    truth: dict[str, Any] | None = None
    # 不對外回傳的附註，例如診斷檢視的參數
    meta: dict[str, Any] | None = None
    # 編碼後的檔案：第一次取用時才產生（預設 JPEG；可指定編碼方式，例如 VLM 的 JPEG 原檔）
    _encode: Callable[[], tuple[bytes, str]] | None = field(default=None, repr=False)
    _encoded: bytes | None = field(default=None, repr=False)
    _content_type: str = "image/jpeg"

    @property
    def width(self) -> int:
        """影像寬度（像素）。"""
        return int(self.image.shape[1])

    @property
    def height(self) -> int:
        """影像高度（像素）。"""
        return int(self.image.shape[0])

    @property
    def nbytes(self) -> int:
        """占用的記憶體：解碼後的陣列加上已編碼的檔案。"""
        return int(self.image.nbytes) + len(self._encoded or b"")


class ImageStore:
    """記憶體中的 LRU 暫存區。

    ``_items`` 為 ``OrderedDict``：尾端是最近使用的影像，``get``／``derived`` 取用時移到尾端，
    淘汰時從頭端開始。``_lock`` 保護 ``_items``、``_bytes``、``_derived`` 三者的一致性；
    耗時的編碼在鎖外進行（見 ``encoded``）。
    """

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
        encode: Callable[[], tuple[bytes, str]] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> StoredImage:
        """存入影像；``encode`` 回傳（檔案位元組, content type），第一次取用時才呼叫。

        ID 為 ``secrets`` 產生的 16 位十六進位亂數（64 位元），碰撞機率可忽略。
        存入後立即檢查上限，可能淘汰其他影像（但不會淘汰剛存入的這一張）。
        """
        item = StoredImage(secrets.token_hex(8), image, description, truth, meta, encode)
        with self._lock:
            self._items[item.image_id] = item
            self._bytes += item.nbytes
            self._evict()
        return item

    def get(self, image_id: str) -> StoredImage:
        """取得影像並標記為最近使用；不存在時丟 ``ImageNotFoundError``（``IMAGE_NOT_FOUND``）。"""
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
        encode: Callable[[], tuple[bytes, str]] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> StoredImage:
        """存入衍生影像，並登記「(來源 ID, 參數鍵) → 衍生影像 ID」供 ``derived`` 重用。

        存入與登記分兩次取鎖；兩個執行緒同時算同一張衍生影像時會各存一份、後登記者覆蓋，
        只是多占一份空間，結果不會錯。
        """
        item = self.put(image, description, truth, encode, meta)
        with self._lock:
            self._derived[(source_id, key)] = item.image_id
        return item

    def encoded(self, image_id: str) -> tuple[bytes, str]:
        """取得編碼後的影像與 content type（預設 JPEG）。

        編碼在鎖外進行（大圖編碼可能耗時），不阻塞其他請求；完成後再取鎖寫回並計入位元組。
        若編碼期間影像已被淘汰（不在 ``_items`` 中），仍回傳結果但不計入總量。
        """
        item = self.get(image_id)
        if item._encoded is None:
            if item._encode is not None:
                encoded, content_type = item._encode()
            else:
                encoded, content_type = encode_jpeg(item.image), "image/jpeg"
            with self._lock:
                if item._encoded is None:  # 其他執行緒可能已編好
                    item._encoded, item._content_type = encoded, content_type
                    if item.image_id in self._items:
                        self._bytes += len(encoded)
                        self._evict()
        return item._encoded, item._content_type

    def __len__(self) -> int:
        """目前暫存的張數。"""
        with self._lock:
            return len(self._items)

    @property
    def total_bytes(self) -> int:
        """目前計入的總位元組數（解碼後的陣列加上已編碼的檔案）。"""
        with self._lock:
            return self._bytes

    def _evict(self) -> None:
        """從最久未使用端淘汰，直到張數與位元組都符合上限；呼叫端須已持有 ``_lock``。

        淘汰後一併清掉失效的衍生對應：衍生影像已被淘汰，或來源 ID 已不在暫存區。
        注意來源鍵若不是暫存影像 ID（例如 ``server/workbench.py`` 條碼掃描縮圖的
        ``barcode-sweep:...``），對應會在下一次呼叫本函式時被清掉。
        """
        # 至少保留最新的一張，即使它本身就超過位元組上限
        while len(self._items) > 1 and (
            len(self._items) > self.max_items or self._bytes > self.max_bytes
        ):
            _, old = self._items.popitem(last=False)
            self._bytes -= old.nbytes
        live = set(self._items)
        self._derived = {k: v for k, v in self._derived.items() if v in live and k[0] in live}
