"""合成測試影像。不使用真實照片；所有影像由 ``dietai.synthetic`` 生成，退化程度已知。"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pytest

from dietai.preprocess import DecodeHit, ZxingDecoder
from dietai.synthetic import ean13_scene, gaussian_blur, label_scene

SceneFactory = Callable[..., np.ndarray]


@pytest.fixture
def scene() -> SceneFactory:
    return label_scene


@pytest.fixture
def blur() -> Callable[[np.ndarray, float], np.ndarray]:
    return gaussian_blur


@pytest.fixture
def scene_1080p() -> np.ndarray:
    return label_scene()


@pytest.fixture(scope="session")
def zxing() -> ZxingDecoder:
    """預設解碼器（zxing-cpp 內建嘗試全開）。"""
    return ZxingDecoder()


@pytest.fixture(scope="session")
def ean13_img() -> np.ndarray:
    return ean13_scene()


class FakeDecoder:
    """依呼叫順序回傳預先設定的結果，並記錄收到的影像形狀。"""

    def __init__(self, responses: list[list[DecodeHit]]) -> None:
        self.responses = list(responses)
        self.shapes: list[tuple[int, ...]] = []

    def __call__(self, img: np.ndarray) -> list[DecodeHit]:
        self.shapes.append(img.shape)
        return self.responses.pop(0) if self.responses else []


@pytest.fixture
def fake_decoder() -> type[FakeDecoder]:
    return FakeDecoder
