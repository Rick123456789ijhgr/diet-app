"""合成測試影像。不使用真實照片；所有影像由 ``dietai.synthetic`` 生成，退化程度已知。"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pytest

from dietai.synthetic import gaussian_blur, label_scene

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
