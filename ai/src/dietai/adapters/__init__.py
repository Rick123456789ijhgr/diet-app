"""外部世界的轉接器與介面定義。

核心邏輯只依賴本檔定義的 Protocol；具體實作（LiteLLM、PaddleOCR、psycopg…）
放在同目錄的其他模組，並在 server 組裝時注入。
"""

from typing import Protocol

import numpy as np


class OcrEngine(Protocol):
    def read(self, image: np.ndarray) -> list[tuple[str, tuple[int, int, int, int]]]:
        """回傳 (文字, 邊界框 x, y, w, h) 的清單。"""
        ...


class Cache(Protocol):
    def get(self, key: str) -> bytes | None: ...

    def set(self, key: str, value: bytes) -> None: ...
