"""合成退化的回歸測試：E1 的合成資料集由這些函式產生，最佳化時輸出必須逐像素不變。"""

import cv2
import numpy as np
import pytest

from dietai.synthetic import (
    add_glare,
    food_scene,
    label_scene,
    perspective,
    perspective_matrix,
    rotate,
)


def _glare_full_frame(img, radius_ratio, seed=0):
    """add_glare 最佳化前的整張計算版本，作為對照。"""
    h, w = img.shape[:2]
    rng = np.random.default_rng(seed)
    r = radius_ratio * min(h, w)
    cx, cy = rng.uniform(r, max(r, w - r)), rng.uniform(r, max(r, h - r))
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    alpha = np.clip((r - dist) / (0.2 * r) + 1, 0, 1).astype(np.float32)
    if img.ndim == 3:
        alpha = alpha[..., None]
    out = img.astype(np.float32) * (1 - alpha) + 255 * alpha
    return np.clip(out, 0, 255).astype(np.uint8)


IMAGES = {
    "label": label_scene(301, 517, 3),
    "food": food_scene(height=240, width=320)[0],
    "gray": np.random.default_rng(0).integers(0, 256, (120, 90), dtype=np.uint8),
}


@pytest.mark.parametrize("name", IMAGES)
@pytest.mark.parametrize("radius_ratio", [0.01, 0.2, 0.6, 1.5])
@pytest.mark.parametrize("seed", [0, 7])
def test_glare_matches_full_frame_computation(name, radius_ratio, seed):
    img = IMAGES[name]
    np.testing.assert_array_equal(
        add_glare(img, radius_ratio, seed), _glare_full_frame(img, radius_ratio, seed)
    )


def test_glare_does_not_modify_input():
    img = IMAGES["label"].copy()
    add_glare(img, 0.3)
    np.testing.assert_array_equal(img, IMAGES["label"])


def test_perspective_zero_is_identity_and_keeps_size():
    img = IMAGES["label"]
    assert np.array_equal(perspective(img, 0), img)
    out = perspective(img, 0.2)
    assert out.shape == img.shape
    with pytest.raises(ValueError):
        perspective(img, 0.5)


def test_perspective_moves_corners_inward_more_with_strength():
    shape = (200, 300)
    corners = np.array([[0, 0], [300, 0], [300, 200], [0, 200]], dtype=np.float64)

    def moved(strength):
        m = perspective_matrix(shape, strength)
        out = cv2.perspectiveTransform(corners.reshape(-1, 1, 2), m).reshape(-1, 2)
        return np.linalg.norm(out - corners, axis=1)

    assert np.all(moved(0.1) > 0)
    assert np.all(moved(0.3) > moved(0.1))


@pytest.mark.parametrize(
    "fn", [lambda im: rotate(im, 30, border=None), lambda im: perspective(im, 0.3, border=None)]
)
def test_border_none_extends_edges_instead_of_white(fn):
    # 全黑影像延伸邊緣後仍全黑；定值填色（預設 255）則會出現白邊
    img = np.zeros((80, 120, 3), dtype=np.uint8)
    assert fn(img).max() == 0
    assert rotate(img, 30).max() == 255
