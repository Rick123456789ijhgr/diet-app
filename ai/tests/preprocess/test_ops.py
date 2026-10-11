import numpy as np
import pytest

from dietai.preprocess.ops import (
    adaptive_threshold,
    estimate_skew,
    median_blur,
    resize_short_side,
    rotate,
    rotation_matrix,
    scale,
    to_gray,
    unsharp_mask,
    validate_image,
)


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
    adaptive_threshold(img, 31, 5)
    rotate(img, 30)
    scale(img, 2.0)
    scale(img, 0.5)
    unsharp_mask(img, 2.0, 1.0)
    median_blur(img, 3)
    estimate_skew(img)
    np.testing.assert_array_equal(img, before)


def test_adaptive_threshold_is_binary_gray(scene):
    out = adaptive_threshold(scene(240, 320), 31, 5)
    assert out.ndim == 2 and set(np.unique(out)) <= {0, 255}


@pytest.mark.parametrize("block_size", [1, 2, 30])
def test_adaptive_threshold_rejects_bad_block_size(block_size):
    with pytest.raises(ValueError):
        adaptive_threshold(np.zeros((8, 8), dtype=np.uint8), block_size, 0)


def test_adaptive_threshold_survives_brightness_gradient():
    """左暗右亮的背景上，二值化後背景兩側都應為白色（全域門檻做不到）。"""
    ramp = np.tile(np.linspace(40, 230, 200, dtype=np.float64), (100, 1)).astype(np.uint8)
    out = adaptive_threshold(ramp, 31, 5)
    assert out[:, 20:40].mean() > 250 and out[:, 160:180].mean() > 250


@pytest.mark.parametrize("degrees", [0, 15, 45, 90, -30])
def test_rotate_keeps_whole_image_and_matrix_maps_corners(degrees):
    img = np.zeros((100, 200), dtype=np.uint8)
    out = rotate(img, degrees)
    m, (w, h) = rotation_matrix(img.shape, degrees)
    assert out.shape == (h, w)
    corners = np.array([[0, 0], [199, 0], [199, 99], [0, 99]], dtype=np.float64)
    mapped = corners @ m[:, :2].T + m[:, 2]
    assert (mapped >= -1).all() and (mapped[:, 0] <= w + 1).all() and (mapped[:, 1] <= h + 1).all()


def test_rotate_fills_border():
    out = rotate(np.zeros((50, 50, 3), dtype=np.uint8), 45, border=255)
    assert (out[0, 0] == 255).all()


@pytest.mark.parametrize("factor", [0.25, 0.5, 2.0, 3.0])
def test_scale_resizes_by_factor(factor):
    out = scale(np.zeros((100, 160, 3), dtype=np.uint8), factor)
    assert out.shape == (round(100 * factor), round(160 * factor), 3)


@pytest.mark.parametrize("factor", [0, -1])
def test_scale_rejects_non_positive(factor):
    with pytest.raises(ValueError):
        scale(np.zeros((4, 4), dtype=np.uint8), factor)


def test_unsharp_mask_increases_edge_contrast(scene, blur):
    img = to_gray(blur(scene(240, 320), 2))
    out = unsharp_mask(img, 2.0, 1.5)
    assert (
        np.abs(np.diff(out.astype(int), axis=1)).mean()
        > np.abs(np.diff(img.astype(int), axis=1)).mean()
    )


def test_unsharp_mask_zero_amount_is_identity(scene):
    img = scene(120, 160)
    np.testing.assert_array_equal(unsharp_mask(img, 2.0, 0.0), img)


def test_median_blur_removes_salt_noise():
    img = np.full((50, 50), 128, dtype=np.uint8)
    img[::7, ::7] = 255
    assert (median_blur(img, 3) == 128).all()


@pytest.mark.parametrize("ksize", [1, 4])
def test_median_blur_rejects_bad_ksize(ksize):
    with pytest.raises(ValueError):
        median_blur(np.zeros((8, 8), dtype=np.uint8), ksize)


def _vertical_bars() -> np.ndarray:
    img = np.full((400, 600), 255, dtype=np.uint8)
    for x in range(150, 450, 12):
        img[100:300, x : x + 5] = 0
    return img


@pytest.mark.parametrize("degrees", [0, 10, 30, 45, -20, -60, 80])
def test_estimate_skew_matches_rotation(degrees):
    """rotate(img, θ) 後估計值約為 θ（容許 3°），可用 rotate(img, -θ) 轉回。"""
    assert estimate_skew(rotate(_vertical_bars(), degrees)) == pytest.approx(degrees, abs=3)


def test_estimate_skew_flat_image_is_zero():
    assert estimate_skew(np.full((10, 10), 200, dtype=np.uint8)) == 0.0
