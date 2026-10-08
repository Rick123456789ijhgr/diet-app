"""品質檢查測試。門檻尚未校準，因此以相對關係為主，只在退化極端時斷言分類結果。"""

import time

import cv2
import numpy as np
import pytest

from dietai.preprocess import (
    PreprocessWarning,
    QualityConfig,
    blur_score,
    check_quality,
    exposure_stats,
    resolution_check,
)
from dietai.preprocess.ops import to_gray

W = PreprocessWarning


def test_blur_score_decreases_monotonically_with_blur(scene_1080p, blur):
    scores = [blur_score(blur(scene_1080p, s)) for s in (0, 1, 2, 4, 8)]
    assert all(a > b for a, b in zip(scores, scores[1:], strict=False)), scores


def test_blur_score_comparable_across_resolutions(scene_1080p, blur):
    """同一內容在不同解析度下，正規化後的分數差距遠小於未正規化的拉普拉斯變異數。"""
    base = blur(scene_1080p, 2)
    sizes = [(960, 540), (1280, 720), (1920, 1080), (3840, 2160)]
    images = [
        cv2.resize(base, (w, h), interpolation=cv2.INTER_AREA if h < 1080 else cv2.INTER_LINEAR)
        for w, h in sizes
    ]
    normalized = [blur_score(img) for img in images]
    raw = [cv2.Laplacian(to_gray(img), cv2.CV_64F).var() for img in images]
    assert max(normalized) / min(normalized) < 1.5, normalized
    assert max(raw) / min(raw) > 10 * max(normalized) / min(normalized), raw


def test_blur_score_accepts_gray(scene_1080p):
    gray = scene_1080p[..., 1].copy()
    assert blur_score(gray) > 0


def test_exposure_stats_extremes():
    black = exposure_stats(np.zeros((10, 10, 3), dtype=np.uint8))
    white = exposure_stats(np.full((10, 10, 3), 255, dtype=np.uint8))
    assert (black.mean, black.dark_ratio, black.bright_ratio) == (0.0, 1.0, 0.0)
    assert (white.mean, white.dark_ratio, white.bright_ratio) == (255.0, 0.0, 1.0)


def test_exposure_stats_uses_config_levels():
    img = np.full((10, 10), 100, dtype=np.uint8)
    assert exposure_stats(img, QualityConfig(dark_level=101)).dark_ratio == 1.0
    assert exposure_stats(img, QualityConfig(bright_level=99)).bright_ratio == 1.0


def test_resolution_check_uses_short_side():
    cfg = QualityConfig(min_short_side=480)
    assert resolution_check(np.zeros((480, 2000), dtype=np.uint8), cfg)
    assert not resolution_check(np.zeros((479, 2000), dtype=np.uint8), cfg)


def test_black_image_warns_too_dark():
    report = check_quality(np.zeros((1080, 1920, 3), dtype=np.uint8))
    assert W.TOO_DARK in report.warnings
    assert W.TOO_BRIGHT not in report.warnings
    assert not report.passed


def test_white_image_warns_too_bright():
    report = check_quality(np.full((1080, 1920, 3), 255, dtype=np.uint8))
    assert W.TOO_BRIGHT in report.warnings
    assert W.TOO_DARK not in report.warnings
    assert not report.passed


def test_small_image_warns_low_resolution(scene):
    report = check_quality(scene(120, 160))
    assert not report.resolution_ok
    assert W.LOW_RESOLUTION in report.warnings


def test_extreme_blur_warns_too_blurry(scene_1080p, blur):
    report = check_quality(blur(scene_1080p, 25))
    assert W.TOO_BLURRY in report.warnings


def test_sharp_scene_passes(scene_1080p):
    report = check_quality(scene_1080p)
    assert report.passed
    assert report.warnings == ()


def test_check_quality_records_steps(scene_1080p):
    cfg = QualityConfig(blur_min=42.0)
    report = check_quality(scene_1080p, cfg)
    assert [s.name for s in report.steps] == ["resolution_check", "blur_score", "exposure_stats"]
    assert report.steps[1].params["blur_min"] == 42.0
    assert all(s.elapsed_ms >= 0 for s in report.steps)


def test_warnings_are_string_codes():
    report = check_quality(np.zeros((10, 10), dtype=np.uint8))
    assert all(isinstance(w, str) and w.isupper() for w in report.warnings)


def test_quality_functions_do_not_modify_input(scene_1080p):
    before = scene_1080p.copy()
    blur_score(scene_1080p)
    exposure_stats(scene_1080p)
    resolution_check(scene_1080p)
    check_quality(scene_1080p)
    np.testing.assert_array_equal(scene_1080p, before)


@pytest.mark.parametrize("fn", [blur_score, exposure_stats, resolution_check, check_quality])
def test_quality_functions_reject_bad_input(fn):
    with pytest.raises(ValueError):
        fn(np.zeros((10, 10), dtype=np.float64))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"blur_short_side": 0},
        {"min_short_side": -1},
        {"dark_level": 200, "bright_level": 100},
        {"dark_ratio_max": 1.5},
        {"bright_ratio_max": -0.1},
    ],
)
def test_quality_config_rejects_invalid_values(kwargs):
    with pytest.raises(ValueError):
        QualityConfig(**kwargs)


@pytest.mark.slow
def test_check_quality_1080p_under_50ms(scene_1080p):
    check_quality(scene_1080p)  # 暖機
    runs = []
    for _ in range(10):
        start = time.perf_counter()
        check_quality(scene_1080p)
        runs.append((time.perf_counter() - start) * 1000)
    assert float(np.median(runs)) < 50, runs
