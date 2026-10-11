"""營養標示前處理（Phase 3）。影像全部由 ``dietai.synthetic`` 生成，真實四角已知。"""

from __future__ import annotations

import time

import cv2
import numpy as np
import pytest

from dietai.preprocess import (
    LabelConfig,
    PreprocessWarning,
    detect_glare,
    enhance_contrast,
    label_edges,
    locate_label_quad,
    preprocess_label,
    rectify,
    remove_glare,
)
from dietai.preprocess.ops import order_quad
from dietai.synthetic import add_glare, label_perspective_scene, nutrition_label

TOLERANCE_PX = 10.0  # 任務書驗收：四角平均誤差上限
OFF = LabelConfig(enable_rectify=False, enable_glare=False, enable_contrast=False)


def _corner_error(found: np.ndarray, truth: np.ndarray) -> float:
    return float(np.linalg.norm(found - truth, axis=1).mean())


def _dashed_quad_scene(height: int = 900, width: int = 1200) -> tuple[np.ndarray, np.ndarray]:
    """只有虛線外框（段與段之間有大間隙）的透視四邊形：輪廓無法閉合，須靠直線法。"""
    img = np.full((height, width, 3), (120, 140, 155), dtype=np.uint8)
    quad = order_quad([[330, 140], [880, 110], [930, 790], [290, 760]])
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        length = float(np.linalg.norm(b - a))
        for t in np.arange(0, length, 70):
            p = a + (b - a) * t / length
            q = a + (b - a) * min(t + 40, length) / length
            cv2.line(img, tuple(int(v) for v in p), tuple(int(v) for v in q), (25, 25, 25), 4)
    return img, quad


def _horizontal_angles(img: np.ndarray) -> np.ndarray:
    """影像中長橫線的角度（度）。"""
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    w = img.shape[1]
    lines = cv2.HoughLinesP(edges, 1, np.pi / 360, 100, minLineLength=0.5 * w, maxLineGap=10)
    assert lines is not None
    segs = lines.reshape(-1, 4).astype(np.float64)
    angles = np.degrees(np.arctan2(segs[:, 3] - segs[:, 1], segs[:, 2] - segs[:, 0]))
    return angles[np.abs(angles) < 30]


# ---------------------------------------------------------------- 定位


@pytest.mark.parametrize("strength", [0.0, 0.1, 0.2])
@pytest.mark.parametrize("seed", range(4))
def test_locate_finds_corners_within_tolerance(strength, seed):
    img, truth = label_perspective_scene(strength, seed)
    quad = locate_label_quad(img)
    assert quad is not None
    assert quad.shape == (4, 2) and quad.dtype == np.float32
    assert _corner_error(quad, truth) < TOLERANCE_PX


def test_locate_works_on_gray_and_large_images():
    img, truth = label_perspective_scene(0.15, seed=7, height=2160, width=2880)
    quad = locate_label_quad(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    assert quad is not None
    assert _corner_error(quad, truth) < 2 * TOLERANCE_PX  # 4K 原圖座標，容許值隨尺寸放大


def test_hough_fallback_when_contour_is_open():
    img, truth = _dashed_quad_scene()
    result = preprocess_label(img)
    assert result.quad_method == "hough"
    assert result.quad is not None
    assert _corner_error(result.quad, truth) < TOLERANCE_PX


@pytest.mark.parametrize("seed", [0, 2])
def test_glare_cutting_border_falls_back_to_lines(seed):
    # 光斑切斷外框使輪廓無法閉合，由直線法救回。光斑更大、遮住整段外框時直線法
    # 可能誤把表格內的橫線當成外框（已知限制，見任務書 Phase 3 決議）。
    img, truth = label_perspective_scene(0.15, seed)
    result = preprocess_label(add_glare(img, 0.1, seed=seed))
    assert result.quad_method == "hough"
    assert result.quad is not None
    assert _corner_error(result.quad, truth) < TOLERANCE_PX


def test_locate_returns_none_on_noise_and_blank():
    noise = np.random.default_rng(0).integers(0, 256, (600, 800, 3), dtype=np.uint8)
    blank = np.full((600, 800, 3), 200, dtype=np.uint8)
    assert locate_label_quad(noise) is None
    assert locate_label_quad(blank) is None


def test_min_area_rejects_small_quad():
    img, _ = label_perspective_scene(0.1, seed=1)
    assert locate_label_quad(img, LabelConfig(min_quad_area_ratio=0.9)) is None


def test_label_edges_uses_detect_scale():
    img, _ = label_perspective_scene(0.1, seed=0, height=1080, width=1440)
    edges = label_edges(img, LabelConfig(detect_short_side=540))
    assert edges.shape == (540, 720)
    assert set(np.unique(edges)) <= {0, 255}


# ---------------------------------------------------------------- 校正


@pytest.mark.parametrize("seed", range(3))
def test_rectify_makes_rows_horizontal(seed):
    img, _ = label_perspective_scene(0.2, seed)
    quad = locate_label_quad(img)
    assert quad is not None
    angles = _horizontal_angles(rectify(img, quad))
    assert len(angles) >= 5
    assert np.abs(angles).max() < 2.0


def test_rectify_output_size_and_corner_order_invariance():
    img, truth = label_perspective_scene(0.0, seed=0)
    out = rectify(img, truth)
    shuffled = rectify(img, truth[[2, 0, 3, 1]])
    np.testing.assert_array_equal(out, shuffled)
    lw, lh = truth[1, 0] - truth[0, 0], truth[3, 1] - truth[0, 1]
    assert out.shape[:2] == (round(lh), round(lw))
    # 正視的標示經校正後應接近原本的表格（縮放到相同尺寸後比較）
    label = cv2.resize(nutrition_label(), (out.shape[1], out.shape[0]))
    assert np.abs(out.astype(int) - label.astype(int)).mean() < 15


def test_rectify_caps_long_side():
    img, truth = label_perspective_scene(0.1, seed=2)
    out = rectify(img, truth, LabelConfig(rectify_max_side=300))
    assert max(out.shape[:2]) == 300


def test_rectify_rejects_bad_quad():
    img, _ = label_perspective_scene()
    with pytest.raises(ValueError):
        rectify(img, np.zeros((3, 2), dtype=np.float32))


# ---------------------------------------------------------------- 光斑


def test_glare_detection_ignores_white_label_paper():
    label = nutrition_label()
    assert detect_glare(label).ratio == 0.0
    glared = add_glare(label, 0.1, seed=0)
    assert detect_glare(glared).ratio > 0.01


def test_glare_on_gray_uses_brightness_only():
    gray = cv2.cvtColor(add_glare(nutrition_label(), 0.1, seed=0), cv2.COLOR_BGR2GRAY)
    result = detect_glare(gray)
    assert result.mask.shape == gray.shape
    assert result.ratio > 0.01


def test_small_glare_is_inpainted():
    label = nutrition_label()
    glared = add_glare(label, 0.05, seed=3)
    glare = detect_glare(glared)
    assert 0 < glare.ratio < LabelConfig().glare_max_ratio
    fixed, warning = remove_glare(glared, glare.mask)
    assert warning is None
    m = glare.mask
    before = np.abs(glared[m].astype(int) - label[m].astype(int)).mean()
    after = np.abs(fixed[m].astype(int) - label[m].astype(int)).mean()
    assert after < before  # 光斑下的文字無法還原，只要求更接近原標示
    assert detect_glare(fixed).ratio < 0.1 * glare.ratio  # 修補後不再被判為光斑


def test_large_glare_requests_retake_without_changes():
    glared = add_glare(nutrition_label(), 0.4, seed=0)
    glare = detect_glare(glared)
    assert glare.ratio > LabelConfig().glare_max_ratio
    out, warning = remove_glare(glared, glare.mask)
    assert warning is PreprocessWarning.GLARE_RETAKE
    np.testing.assert_array_equal(out, glared)


def test_remove_glare_rejects_mismatched_mask():
    with pytest.raises(ValueError):
        remove_glare(nutrition_label(), np.zeros((3, 3), dtype=bool))


# ---------------------------------------------------------------- 對比


def test_enhance_contrast_lab_keeps_color_and_gray_mode_outputs_gray():
    rng = np.random.default_rng(0)
    texture = rng.integers(100, 140, (300, 400), dtype=np.uint8)
    tint = np.array([1.0, 0.8, 0.6], dtype=np.float32)  # 偏藍的低對比影像
    img = (texture[..., None].astype(np.float32) * tint).astype(np.uint8)

    color = enhance_contrast(img)
    assert color.shape == img.shape
    l_before = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)[..., 0]
    lab_after = cv2.cvtColor(color, cv2.COLOR_BGR2LAB)
    assert lab_after[..., 0].std() > l_before.std()
    assert color[..., 0].mean() > color[..., 2].mean()  # 色調保留

    gray = enhance_contrast(img, LabelConfig(clahe_on_lab=False))
    assert gray.ndim == 2
    assert gray.std() > cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).std()
    assert enhance_contrast(texture).ndim == 2  # 灰階輸入一律輸出灰階


# ---------------------------------------------------------------- 串接


def test_preprocess_label_full_pipeline():
    img, truth = label_perspective_scene(0.15, seed=5)
    result = preprocess_label(img)
    assert result.warnings == ()
    assert result.quad is not None and result.quad_method == "contour"
    assert _corner_error(result.quad, truth) < TOLERANCE_PX
    assert [s.name for s in result.steps] == [
        "locate_label_quad",
        "rectify",
        "glare",
        "enhance_contrast",
    ]
    assert result.glare is not None and result.glare.mask.shape == result.image.shape[:2]
    assert all(s.elapsed_ms >= 0 for s in result.steps)


def test_not_located_continues_with_original():
    blank = np.full((600, 800, 3), 200, dtype=np.uint8)
    result = preprocess_label(blank)
    assert result.warnings == (PreprocessWarning.LABEL_NOT_LOCATED,)
    assert result.quad is None and result.quad_method is None
    assert result.image.shape == blank.shape
    assert [s.name for s in result.steps] == ["locate_label_quad", "glare", "enhance_contrast"]


def test_glare_retake_still_enhances_contrast():
    img = add_glare(nutrition_label(), 0.4, seed=0)
    result = preprocess_label(img, LabelConfig(enable_rectify=False))
    assert result.warnings == (PreprocessWarning.GLARE_RETAKE,)
    np.testing.assert_array_equal(result.image, enhance_contrast(img))
    glare_step = next(s for s in result.steps if s.name == "glare")
    assert glare_step.params["action"] == "retake"


@pytest.mark.parametrize("shape", [(480, 640, 3), (480, 640)])
def test_all_steps_off_returns_equal_copy(shape):
    img = np.random.default_rng(0).integers(0, 256, shape, dtype=np.uint8)
    result = preprocess_label(img, OFF)
    np.testing.assert_array_equal(result.image, img)
    assert result.image is not img
    assert result.steps == () and result.warnings == ()
    assert result.quad is None and result.glare is None


@pytest.mark.parametrize("disabled", ["enable_rectify", "enable_glare", "enable_contrast"])
def test_each_step_can_be_disabled(disabled):
    img, _ = label_perspective_scene(0.1, seed=1)
    img = add_glare(img, 0.04, seed=2)
    cfg = LabelConfig(**{disabled: False})
    result = preprocess_label(img, cfg)

    expected = img
    if cfg.enable_rectify:
        quad = locate_label_quad(img, cfg)
        assert quad is not None
        expected = rectify(img, quad, cfg)
    if cfg.enable_glare:
        expected, _ = remove_glare(expected, detect_glare(expected, cfg).mask, cfg)
    if cfg.enable_contrast:
        expected = enhance_contrast(expected, cfg)
    np.testing.assert_array_equal(result.image, expected)

    names = {s.name for s in result.steps}
    step = {"enable_rectify": "locate_label_quad", "enable_glare": "glare"}
    assert step.get(disabled, "enhance_contrast") not in names


@pytest.mark.parametrize("cfg", [LabelConfig(), OFF])
def test_does_not_modify_input(cfg):
    img, _ = label_perspective_scene(0.1, seed=0)
    before = img.copy()
    preprocess_label(img, cfg)
    np.testing.assert_array_equal(img, before)


@pytest.mark.parametrize(
    "bad",
    [np.zeros((10, 10), dtype=np.float32), np.zeros((10, 10, 4), dtype=np.uint8), "img"],
)
def test_rejects_invalid_image(bad):
    with pytest.raises(ValueError):
        preprocess_label(bad)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"canny_low": 200, "canny_high": 100},
        {"min_quad_area_ratio": 0.9, "max_quad_area_ratio": 0.5},
        {"approx_eps_ratio": 0.0},
        {"glare_v_min": 300},
        {"clahe_clip": 0.0},
        {"clahe_tile": 0},
        {"hough_max_gap": -1},
    ],
)
def test_config_rejects_invalid_values(kwargs):
    with pytest.raises(ValueError):
        LabelConfig(**kwargs)


@pytest.mark.slow
def test_preprocess_label_1080p_speed():
    img, _ = label_perspective_scene(0.15, seed=0, height=1080, width=1920)
    preprocess_label(img)  # 暖機
    start = time.perf_counter()
    for _ in range(5):
        preprocess_label(img)
    elapsed_ms = (time.perf_counter() - start) * 1000 / 5
    assert elapsed_ms < 150
