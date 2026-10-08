import numpy as np
import pytest

from dietai.preprocess.ops import resize_short_side, to_gray, validate_image


@pytest.mark.parametrize(
    "bad",
    [
        np.zeros((4, 4), dtype=np.float32),
        np.zeros((4, 4, 4), dtype=np.uint8),
        np.zeros((4, 4, 1), dtype=np.uint8),
        np.zeros(4, dtype=np.uint8),
        np.zeros((0, 4), dtype=np.uint8),
        [[0, 0], [0, 0]],
    ],
)
def test_validate_image_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        validate_image(bad)


@pytest.mark.parametrize("shape", [(4, 5), (4, 5, 3)])
def test_validate_image_accepts_gray_and_bgr(shape):
    validate_image(np.zeros(shape, dtype=np.uint8))


def test_to_gray_uses_bgr_order():
    blue = np.zeros((2, 2, 3), dtype=np.uint8)
    blue[..., 0] = 255
    assert (to_gray(blue) == 29).all()  # 0.114 × 255


def test_to_gray_returns_copy_for_gray_input():
    img = np.full((3, 3), 7, dtype=np.uint8)
    out = to_gray(img)
    assert out is not img
    out[0, 0] = 0
    assert img[0, 0] == 7


@pytest.mark.parametrize("shape", [(1080, 1920, 3), (1920, 1080), (300, 400, 3)])
def test_resize_short_side_keeps_aspect_ratio(shape):
    img = np.zeros(shape, dtype=np.uint8)
    out = resize_short_side(img, 480)
    assert min(out.shape[:2]) == 480
    assert out.shape[1] / out.shape[0] == pytest.approx(shape[1] / shape[0], rel=0.01)
    assert out.ndim == img.ndim


def test_resize_short_side_rejects_non_positive():
    with pytest.raises(ValueError):
        resize_short_side(np.zeros((4, 4), dtype=np.uint8), 0)


def test_ops_do_not_modify_input(scene):
    img = scene(540, 960)
    before = img.copy()
    to_gray(img)
    resize_short_side(img, 480)
    resize_short_side(img, 540)
    np.testing.assert_array_equal(img, before)
