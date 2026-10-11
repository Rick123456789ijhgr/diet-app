"""全部測試共用的 fixture。"""

from __future__ import annotations

import numpy as np
import pytest

from dietai.preprocess import DecodeHit


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
