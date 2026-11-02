"""外部世界的轉接器與介面定義。

核心邏輯只依賴介面（``typing.Protocol``）；具體實作（Tesseract、PaddleOCR、LiteLLM、psycopg…）
放在子模組，並在 server 或實驗腳本組裝時注入。OCR 的介面定義在 ``dietai.label_parsing.ocr``
（核心邏輯使用），這裡轉出，實作在 ``dietai.adapters.ocr``。
"""

from typing import Protocol

from dietai.label_parsing.ocr import OcrBox, OcrEngine


class Cache(Protocol):
    """位元組的鍵值快取；外部模型（OCR、VLM）的呼叫一律經過快取（ai/CLAUDE.md）。"""

    def get(self, key: str) -> bytes | None: ...

    def set(self, key: str, value: bytes) -> None: ...


__all__ = ["Cache", "OcrBox", "OcrEngine"]
