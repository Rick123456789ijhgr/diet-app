"""OCR 結果快取：同一引擎（名稱含版本與設定）對同一張影像只辨識一次。"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict

import numpy as np

from dietai.adapters import Cache
from dietai.label_parsing.ocr import OcrBox, OcrEngine
from dietai.preprocess.types import Image

CACHE_VERSION = "ocr-v1"  # 快取內容格式改變時更新，舊的快取自動失效


def image_digest(img: Image) -> str:
    """影像內容的 sha256（含形狀與型別，同樣的像素排成不同形狀不會撞鍵）。"""
    arr = np.ascontiguousarray(img)
    h = hashlib.sha256(f"{arr.shape}|{arr.dtype}|".encode())
    h.update(arr.tobytes())
    return h.hexdigest()


class CachedOcr:
    """在 ``engine`` 外包一層快取，本身也符合 ``OcrEngine`` 介面。

    快取鍵為（格式版本, ``engine.name``, 影像雜湊）；``engine.name`` 須含引擎、版本、模型與設定，
    換了任何一項就是不同的鍵。``hits``／``misses`` 記錄命中次數，供實驗紀錄。
    """

    def __init__(self, engine: OcrEngine, cache: Cache) -> None:
        self.engine = engine
        self.cache = cache
        self.name = engine.name
        self.hits = 0
        self.misses = 0

    def __call__(self, img: Image) -> list[OcrBox]:
        key = f"{CACHE_VERSION}|{self.engine.name}|{image_digest(img)}"
        raw = self.cache.get(key)
        if raw is not None:
            self.hits += 1
            return [OcrBox(**b) for b in json.loads(raw.decode("utf-8"))]
        self.misses += 1
        boxes = self.engine(img)
        data = json.dumps([asdict(b) for b in boxes], ensure_ascii=False)
        self.cache.set(key, data.encode("utf-8"))
        return boxes
