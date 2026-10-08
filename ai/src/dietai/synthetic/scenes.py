"""合成場景。不使用真實照片；內容由程式繪製，供測試與工作台使用。"""

from __future__ import annotations

import cv2
import numpy as np

from dietai.preprocess.types import Image

_BASE_H, _BASE_W = 1080, 1920


def label_scene(height: int = 1080, width: int = 1920, seed: int = 0) -> Image:
    """紙色底上的格線、文字與色塊，模擬包裝標示，提供足夠的邊緣供模糊分數計算。

    以 1080p 為基準繪製後再縮放到指定尺寸，使不同解析度的內容一致。
    """
    rng = np.random.default_rng(seed)
    img = np.full((_BASE_H, _BASE_W, 3), (190, 200, 205), dtype=np.uint8)  # 一般光線下的紙張
    for y in range(120, _BASE_H - 80, 60):
        cv2.line(img, (100, y), (_BASE_W - 100, y), (0, 0, 0), 2)
    for x in (100, 900, _BASE_W - 100):
        cv2.line(img, (x, 120), (x, _BASE_H - 140), (0, 0, 0), 2)
    for i, y in enumerate(range(160, _BASE_H - 80, 60)):
        cv2.putText(img, f"Item {i} 12.{i}g", (130, y), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2)
    for _ in range(8):
        x, y = int(rng.integers(950, _BASE_W - 250)), int(rng.integers(150, _BASE_H - 300))
        color = tuple(int(c) for c in rng.integers(0, 200, 3))
        cv2.rectangle(img, (x, y), (x + 150, y + 150), color, -1)
    if (height, width) != (_BASE_H, _BASE_W):
        return np.asarray(
            cv2.resize(img, (width, height), interpolation=cv2.INTER_AREA), dtype=np.uint8
        )
    return img
