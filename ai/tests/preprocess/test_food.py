"""食物照片前處理（Phase 4）。影像全部由程式繪製或 ``dietai.synthetic`` 生成，盤子位置已知。"""

from __future__ import annotations

import time

import cv2
import numpy as np
import pytest

from dietai.preprocess import (
    Box,
    Ellipse,
    FoodConfig,
    PreprocessWarning,
    crop_dishes,
    detect_plate_ellipse,
    dish_foreground,
    preprocess_food,
    resize_for_vlm,
)
from dietai.synthetic import food_scene

PLATES = FoodConfig(enable_plate=True)


def _three_circles() -> tuple[np.ndarray, list[Box]]:
    """任務書驗收用：灰色背景上 3 個不同顏色的圓，回傳（影像, 各圓的外接框）。"""
    img = np.full((600, 900, 3), (128, 128, 128), dtype=np.uint8)
    circles = [
        ((180, 200), 90, (40, 40, 220)),
        ((470, 380), 110, (40, 200, 40)),
        ((740, 180), 80, (220, 80, 30)),
    ]
    for center, r, color in circles:
        cv2.circle(img, center, r, color, -1)
    return img, [Box(x - r, y - r, 2 * r + 1, 2 * r + 1) for (x, y), r, _ in circles]


def _covers(boxes: tuple[Box, ...], truth: Box) -> bool:
    return any(b.contains(truth) for b in boxes)


# ---------------------------------------------------------------- 共用型別


def test_box_geometry():
    a, b = Box(0, 0, 10, 10), Box(5, 0, 10, 10)
    assert (a.x1, a.y1, a.area) == (10, 10, 100)
    assert a.iou(b) == pytest.approx(50 / 150)
    assert a.iou(Box(20, 20, 5, 5)) == 0.0
    assert a.contains(Box(2, 2, 3, 3)) and not a.contains(b)
    with pytest.raises(ValueError):
        Box(0, 0, 0, 5)


def test_box_crop_is_copy():
    img = np.arange(100, dtype=np.uint8).reshape(10, 10)
    crop = Box(2, 3, 4, 5).crop(img)
    assert crop.shape == (5, 4) and crop[0, 0] == 32
    crop[:] = 0
    assert img[3, 2] == 32


@pytest.mark.parametrize(
    ("box", "shape"),
    [
        (Box(-10, 0, 5, 3), (3, 0)),  # 整個在左方：x1=-5，不夾會切成 img[:, 0:-5]
        (Box(0, -10, 3, 5), (0, 3)),  # 整個在上方
        (Box(12, 2, 4, 4), (4, 0)),  # 整個在右方
        (Box(-3, -2, 6, 5), (3, 3)),  # 部分超出左上
        (Box(8, 7, 5, 6), (3, 2)),  # 部分超出右下
    ],
)
def test_box_crop_clamps_both_ends(box, shape):
    img = np.arange(100, dtype=np.uint8).reshape(10, 10)
    assert box.crop(img).shape == shape


@pytest.mark.parametrize("angle", [0.0, 30.0, 90.0, 135.0])
def test_ellipse_bbox_contains_boundary(angle):
    e = Ellipse(100.0, 80.0, 120.0, 50.0, angle)
    t = np.linspace(0, 2 * np.pi, 360)
    a, b, r = e.major / 2, e.minor / 2, np.radians(angle)
    xs = e.cx + a * np.cos(t) * np.cos(r) - b * np.sin(t) * np.sin(r)
    ys = e.cy + a * np.cos(t) * np.sin(r) + b * np.sin(t) * np.cos(r)
    assert np.allclose(e.normalized_radius(xs, ys), 1.0)
    box = e.bbox()
    assert box.x <= xs.min() and xs.max() <= box.x1 and box.y <= ys.min() and ys.max() <= box.y1
    assert box.w <= np.ptp(xs) + 3 and box.h <= np.ptp(ys) + 3  # 外接框是緊的
    assert e.normalized_radius(e.cx, e.cy) == 0


def test_ellipse_rejects_bad_axes():
    with pytest.raises(ValueError):
        Ellipse(0, 0, 10, 20, 0)


# ---------------------------------------------------------------- resize_for_vlm


@pytest.mark.parametrize(("h", "w"), [(1080, 1920), (1920, 1080), (1001, 1003), (3000, 997)])
def test_resize_long_side_and_aspect(h, w):
    img = np.zeros((h, w, 3), dtype=np.uint8)
    out = resize_for_vlm(img, 768, 85)
    oh, ow = out.image.shape[:2]
    assert max(oh, ow) == 768
    assert abs(ow / oh - w / h) <= 1 / min(oh, ow) * (w / h) + 1e-9  # 只差取整的一像素
    assert out.scale == pytest.approx(768 / max(h, w))


def test_resize_never_upscales():
    img = np.full((300, 400, 3), 90, dtype=np.uint8)
    out = resize_for_vlm(img, 1024, 85)
    assert out.image.shape == img.shape and out.scale == 1.0
    assert out.image is not img


def test_resize_jpeg_roundtrip_and_quality():
    img, _ = food_scene(3, seed=1)
    high = resize_for_vlm(img, 640, 95)
    low = resize_for_vlm(img, 640, 30)
    decoded = cv2.imdecode(np.frombuffer(high.jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == high.image.shape
    assert low.num_bytes < high.num_bytes
    assert np.abs(decoded.astype(int) - high.image.astype(int)).mean() < 5


def test_resize_gray_and_input_untouched():
    img = np.tile(np.arange(256, dtype=np.uint8), (100, 4))
    before = img.copy()
    out = resize_for_vlm(img, 512, 80)
    assert out.image.shape == (50, 512)
    assert cv2.imdecode(np.frombuffer(out.jpeg, np.uint8), cv2.IMREAD_UNCHANGED).ndim == 2
    assert np.array_equal(img, before)


@pytest.mark.parametrize(("max_side", "quality"), [(0, 85), (512, 0), (512, 101)])
def test_resize_rejects_bad_args(max_side, quality):
    with pytest.raises(ValueError):
        resize_for_vlm(np.zeros((10, 10), np.uint8), max_side, quality)


# ---------------------------------------------------------------- crop_dishes


def test_crop_three_circles():
    """任務書驗收：3 個不同顏色的圓切出 3 個框，且每個框涵蓋對應的圓。"""
    img, truth = _three_circles()
    boxes = crop_dishes(img)
    assert len(boxes) == 3
    for t in truth:
        assert _covers(boxes, t)
    assert [b.area for b in boxes] == sorted((b.area for b in boxes), reverse=True)


@pytest.mark.parametrize("n", [1, 3, 5])
@pytest.mark.parametrize("tilt", [0.0, 0.3, 0.6])
@pytest.mark.parametrize("seed", range(3))
def test_crop_food_scene(n, tilt, seed):
    img, plates = food_scene(n, seed, tilt=tilt)
    boxes = crop_dishes(img)
    assert len(boxes) == n  # 筷子面積太小，被過濾
    for p in plates:
        assert _covers(boxes, p.bbox())


def test_crop_gray_and_large_input():
    img, plates = food_scene(3, seed=4, height=2160, width=2880)
    boxes = crop_dishes(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    assert len(boxes) == 3
    for p in plates:
        assert _covers(boxes, p.bbox())


def test_crop_boxes_within_image_and_padded():
    img, truth = _three_circles()
    tight = crop_dishes(img, FoodConfig(box_pad_ratio=0.0))
    padded = crop_dishes(img, FoodConfig(box_pad_ratio=0.2))
    h, w = img.shape[:2]
    for b in padded:
        assert b.x >= 0 and b.y >= 0 and b.x1 <= w and b.y1 <= h
    assert all(p.contains(t) for p, t in zip(padded, tight, strict=True))
    assert sum(b.area for b in padded) > sum(b.area for b in tight)


def test_crop_empty_table_and_full_frame():
    blank = np.full((400, 600, 3), (70, 105, 150), dtype=np.uint8)
    assert crop_dishes(blank) == ()
    full = blank.copy()
    cv2.rectangle(full, (20, 20), (580, 380), (240, 240, 240), -1)  # 約佔畫面 84%
    assert crop_dishes(full, FoodConfig(max_dish_area_ratio=0.8)) == ()
    assert len(crop_dishes(full)) == 1


def test_crop_overlap_filter_and_max_dishes():
    img = np.full((400, 400, 3), 128, dtype=np.uint8)
    # 兩個互相嵌合、但不相連的 L 形：外接框幾乎相同
    cv2.rectangle(img, (50, 50), (80, 350), (0, 0, 255), -1)
    cv2.rectangle(img, (50, 320), (330, 350), (0, 0, 255), -1)
    cv2.rectangle(img, (110, 50), (350, 80), (0, 255, 0), -1)
    cv2.rectangle(img, (320, 50), (350, 290), (0, 255, 0), -1)
    assert len(crop_dishes(img)) == 1
    assert len(crop_dishes(img, FoodConfig(max_overlap=1.0))) == 2
    circles, _ = _three_circles()
    assert len(crop_dishes(circles, FoodConfig(max_dishes=2))) == 2


def test_dish_foreground_fills_food_matching_table():
    """與桌面同色的食物被白盤包圍時，仍屬於前景（不會在盤子中間挖洞）。"""
    table = (70, 105, 150)
    img = np.full((400, 400, 3), table, dtype=np.uint8)
    cv2.circle(img, (200, 200), 120, (240, 240, 240), -1)
    cv2.circle(img, (200, 200), 60, table, -1)
    mask = dish_foreground(img, FoodConfig(detect_short_side=400))
    assert mask.shape == (400, 400) and mask.dtype == bool
    assert mask[200, 200] and not mask[10, 10]
    assert len(crop_dishes(img)) == 1


def test_dish_foreground_downscales():
    img, _ = food_scene(2, seed=0, height=1080, width=1440)
    assert dish_foreground(img).shape == (512, 683)


# ---------------------------------------------------------------- detect_plate_ellipse


@pytest.mark.parametrize("tilt", [0.0, 0.3, 0.5])
@pytest.mark.parametrize("seed", range(3))
def test_plate_ellipses_match_truth(tilt, seed):
    img, plates = food_scene(3, seed, tilt=tilt)
    found = detect_plate_ellipse(img)
    assert len(found) == 3  # 內圈盤緣與不規則食物都不算
    for p in plates:
        e = min(found, key=lambda f: np.hypot(f.cx - p.cx, f.cy - p.cy))
        assert np.hypot(e.cx - p.cx, e.cy - p.cy) < 3
        assert e.major == pytest.approx(p.major, rel=0.08)
        assert e.minor == pytest.approx(p.minor, rel=0.1)
        if p.minor / p.major < 0.9:  # 接近圓形時角度沒有意義
            diff = abs(e.angle - p.angle) % 180
            assert min(diff, 180 - diff) < 5


def test_plate_none_on_blank_or_rectangles():
    blank = np.full((400, 600, 3), (70, 105, 150), dtype=np.uint8)
    assert detect_plate_ellipse(blank) == ()
    rect = blank.copy()
    cv2.rectangle(rect, (100, 100), (400, 300), (240, 240, 240), -1)
    assert detect_plate_ellipse(rect) == ()


def test_plate_rejects_partial_arc():
    img = np.full((500, 500, 3), (70, 105, 150), dtype=np.uint8)
    cv2.ellipse(img, (250, 250), (180, 120), 0, 0, 90, (240, 240, 240), 6)  # 只有四分之一圈
    assert detect_plate_ellipse(img) == ()
    assert len(detect_plate_ellipse(img, FoodConfig(plate_min_coverage=0.1))) >= 1


# ---------------------------------------------------------------- preprocess_food


def test_preprocess_food_full():
    img, plates = food_scene(3, seed=2, height=1080, width=1440)
    before = img.copy()
    result = preprocess_food(img, PLATES)
    assert np.array_equal(img, before)
    assert result.warnings == ()
    assert [s.name for s in result.steps] == [
        "crop_dishes",
        "detect_plate_ellipse",
        "resize_for_vlm",
    ]
    assert result.dishes is not None and len(result.dishes) == 3
    assert result.plates is not None and len(result.plates) == 3
    assert len(result.crops) == 3
    assert max(result.image.shape[:2]) == PLATES.vlm_max_side
    assert result.image is result.whole.image
    for box, crop in zip(result.dishes, result.crops, strict=True):
        assert crop.image.shape[:2] == (box.h, box.w)  # 裁切比 VLM 長邊小，不放大
    total = result.steps[-1].params["total_bytes"]
    assert total == result.whole.num_bytes + sum(c.num_bytes for c in result.crops)


def test_preprocess_food_not_found_warns():
    blank = np.full((300, 400, 3), (70, 105, 150), dtype=np.uint8)
    result = preprocess_food(blank)
    assert result.warnings == (PreprocessWarning.DISH_NOT_FOUND,)
    assert result.dishes == () and result.crops == ()
    assert result.whole.image.shape == blank.shape


def test_preprocess_food_steps_off():
    img, _ = food_scene(2, seed=0)
    result = preprocess_food(img, FoodConfig(enable_crop=False, enable_plate=False))
    assert result.dishes is None and result.plates is None and result.crops == ()
    assert [s.name for s in result.steps] == ["resize_for_vlm"]
    assert result.warnings == ()


@pytest.mark.parametrize(
    "bad",
    [np.zeros((10, 10), np.float32), np.zeros((10, 10, 4), np.uint8), np.zeros((0, 10), np.uint8)],
)
def test_preprocess_food_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        preprocess_food(bad)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"detect_short_side": 0},
        {"bg_border_ratio": 0.5},
        {"min_dish_area_ratio": 0.5, "max_dish_area_ratio": 0.4},
        {"plate_canny_low": 200, "plate_canny_high": 100},
        {"plate_min_axis_ratio": 0.0},
        {"plate_min_contour_points": 4},
        {"vlm_jpeg_quality": 0},
        {"morph_px": -1},
    ],
)
def test_config_validation(kwargs):
    with pytest.raises(ValueError):
        FoodConfig(**kwargs)


@pytest.mark.slow
def test_preprocess_food_speed_1080p():
    img, _ = food_scene(4, seed=0, height=1080, width=1920)
    preprocess_food(img, PLATES)  # 暖機
    start = time.perf_counter()
    preprocess_food(img, PLATES)
    assert (time.perf_counter() - start) * 1000 < 200
