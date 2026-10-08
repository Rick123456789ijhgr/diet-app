import numpy as np
import pytest

import dietai.preprocess.steps  # noqa: F401  註冊基本步驟
from dietai.preprocess import register, run_pipeline


@register("test_invert")
def _invert(image: np.ndarray) -> np.ndarray:
    return 255 - image


@register("test_subtract")
def _subtract(image: np.ndarray, amount: int = 0) -> np.ndarray:
    return image - amount


def test_steps_run_in_order_with_params():
    img = np.zeros((2, 2), dtype=np.uint8)
    result = run_pipeline(img, ["test_invert", "test_subtract"], {"test_subtract": {"amount": 5}})
    assert (result.image == 250).all()
    assert [r.name for r in result.records] == ["test_invert", "test_subtract"]


def test_empty_steps_returns_original():
    img = np.ones((2, 2), dtype=np.uint8)
    assert run_pipeline(img, []).image is img


def test_unknown_step_raises():
    with pytest.raises(KeyError):
        run_pipeline(np.zeros((1, 1)), ["does_not_exist"])


def test_duplicate_registration_raises():
    with pytest.raises(ValueError):
        register("test_invert")(lambda image: image)


def test_gray_converts_rgb():
    img = np.full((2, 2, 3), 100, dtype=np.uint8)
    out = run_pipeline(img, ["gray"]).image
    assert out.shape == (2, 2)
    assert (out == 100).all()
