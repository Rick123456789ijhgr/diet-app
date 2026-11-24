"""一次只讓一個執行緒呼叫 OCR 引擎。

gRPC 服務在執行緒池中處理請求；``PaddleEngine`` 只有一個子行程、以一問一答的管線溝通，
兩個請求同時寫入會讀到對方的回應。外面包這一層後即可安全地在多執行緒中共用。
"""

from __future__ import annotations

import threading

from dietai.label_parsing.ocr import OcrBox, OcrEngine
from dietai.preprocess.types import Image


class LockedOcr:
    """以互斥鎖序列化 ``engine`` 的呼叫；本身也符合 ``OcrEngine`` 介面。"""

    def __init__(self, engine: OcrEngine) -> None:
        self.engine = engine
        self.name = engine.name
        self._lock = threading.Lock()

    def __call__(self, img: Image) -> list[OcrBox]:
        with self._lock:
            return self.engine(img)
