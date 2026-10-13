"""合成退化的回歸測試：E1 的合成資料集由這些函式產生，最佳化時輸出必須逐像素不變。"""

import numpy as np
import pytest

from dietai.synthetic import add_glare, food_scene, label_scene


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
