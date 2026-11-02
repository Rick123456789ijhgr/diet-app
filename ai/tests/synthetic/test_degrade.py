"""合成退化的回歸測試：E1 的合成資料集由這些函式產生，最佳化時輸出必須逐像素不變。"""

import cv2
import numpy as np
import pytest

from dietai.synthetic import (
    add_glare,
    cylinder_warp,
    food_scene,
    jpeg,
    label_scene,
    motion_blur,
    perspective,
    perspective_matrix,
    reduce_contrast,
    rotate,
    salt_pepper,
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


# ---- ADR 0005 新增的劣化 ----


def _stripes(vertical: bool):
    """黑白相間、寬 4 px 的條紋（vertical 為直條）。"""
    img = np.zeros((64, 64), dtype=np.uint8)
    if vertical:
        img[:, (np.arange(64) // 4) % 2 == 0] = 255
    else:
        img[(np.arange(64) // 4) % 2 == 0, :] = 255
    return img


def test_motion_blur_is_directional():
    v, h = _stripes(True), _stripes(False)
    # 水平移動抹平直條、不影響橫條；垂直移動相反
    assert motion_blur(v, 9).std() < v.std() / 2
    np.testing.assert_array_equal(motion_blur(h, 9), h)
    np.testing.assert_array_equal(motion_blur(v, 9, 90), v)
    assert motion_blur(h, 9, 90).std() < h.std() / 2
    # 平均亮度不變；長度 ≤ 1 時回傳副本
    assert abs(float(motion_blur(v, 9, 30).mean()) - float(v.mean())) < 2
    np.testing.assert_array_equal(motion_blur(v, 1), v)


def test_salt_pepper_fraction_and_seed():
    img = np.full((200, 200, 3), 128, dtype=np.uint8)
    out = salt_pepper(img, 0.1, seed=3)
    changed = (out != 128).any(axis=2)
    assert changed.mean() == pytest.approx(0.1, abs=0.01)
    # 同一像素三個色版一起變，只有全黑或全白
    assert set(np.unique(out[changed])) <= {0, 255}
    assert (out[changed].min(axis=1) == out[changed].max(axis=1)).all()
    np.testing.assert_array_equal(salt_pepper(img, 0.1, seed=3), out)
    assert not np.array_equal(salt_pepper(img, 0.1, seed=4), out)
    with pytest.raises(ValueError):
        salt_pepper(img, 1.5)


def test_reduce_contrast_keeps_mean():
    img = IMAGES["label"]
    out = reduce_contrast(img, 0.3)
    assert abs(float(out.mean()) - float(img.mean())) < 1
    assert float(out.std()) == pytest.approx(0.3 * float(img.std()), rel=0.02)
    np.testing.assert_array_equal(reduce_contrast(img, 1), img)
    with pytest.raises(ValueError):
        reduce_contrast(img, 1.2)


def test_jpeg_degrades_with_quality():
    img = IMAGES["label"]
    err = {q: np.abs(jpeg(img, q).astype(int) - img).mean() for q in (90, 30)}
    assert 0 < err[90] < err[30]
    assert jpeg(IMAGES["gray"], 50).shape == IMAGES["gray"].shape
    with pytest.raises(ValueError):
        jpeg(img, 0)


def test_cylinder_warp_compresses_edges():
    img = _stripes(True)
    out = cylinder_warp(img, 0.5)
    theta = 0.5 * np.pi / 2
    radius = 32 / theta
    assert out.shape == (64, round(2 * radius * np.sin(theta)))
    assert out.shape[1] < 64
    # 中央的條紋寬度幾乎不變，邊緣的條紋被壓窄
    row = out[0] > 127
    runs = np.diff(np.flatnonzero(np.diff(row.astype(int))))
    assert runs[len(runs) // 2] >= 3 and runs[0] < runs[len(runs) // 2]
    np.testing.assert_array_equal(cylinder_warp(img, 0), img)
    assert cylinder_warp(IMAGES["label"], 0.3).shape[2] == 3
    with pytest.raises(ValueError):
        cylinder_warp(img, 1.0)
