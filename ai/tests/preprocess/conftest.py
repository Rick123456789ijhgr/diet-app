"""合成測試影像。不使用真實照片；所有影像由程式生成，退化程度已知。"""

from __future__ import annotations

from collections.abc import Callable

import cv2
import numpy as np
import pytest

SceneFactory = Callable[..., np.ndarray]


def make_scene(height: int = 1080, width: int = 1920, seed: int = 0) -> np.ndarray:
    """紙色底上的格線、文字與色塊，模擬包裝標示，提供足夠的邊緣供模糊分數計算。

    以 1080p 為基準繪製後再縮放到指定尺寸，使不同解析度的內容一致。
    """
    rng = np.random.default_rng(seed)
    base_h, base_w = 1080, 1920
    img = np.full((base_h, base_w, 3), (190, 200, 205), dtype=np.uint8)  # 一般光線下的紙張
    for y in range(120, base_h - 80, 60):
        cv2.line(img, (100, y), (base_w - 100, y), (0, 0, 0), 2)
    for x in (100, 900, base_w - 100):
        cv2.line(img, (x, 120), (x, base_h - 140), (0, 0, 0), 2)
    for i, y in enumerate(range(160, base_h - 80, 60)):
        cv2.putText(img, f"Item {i} 12.{i}g", (130, y), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2)
    for _ in range(8):
        x, y = int(rng.integers(950, base_w - 250)), int(rng.integers(150, base_h - 300))
        color = tuple(int(c) for c in rng.integers(0, 200, 3))
        cv2.rectangle(img, (x, y), (x + 150, y + 150), color, -1)
    if (height, width) != (base_h, base_w):
        img = cv2.resize(img, (width, height), interpolation=cv2.INTER_AREA)
    return img


def gaussian_blur(img: np.ndarray, sigma: float) -> np.ndarray:
    """以已知 sigma 施加高斯模糊；sigma 為 0 時回傳副本。"""
    if sigma == 0:
        return img.copy()
    return cv2.GaussianBlur(img, (0, 0), sigmaX=sigma)


@pytest.fixture
def scene() -> SceneFactory:
    return make_scene


@pytest.fixture
def blur() -> Callable[[np.ndarray, float], np.ndarray]:
    return gaussian_blur


@pytest.fixture
def scene_1080p() -> np.ndarray:
    return make_scene()
