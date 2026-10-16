"""食物照片前處理：縮放壓縮給 VLM、切出各道菜、（選做）盤緣橢圓。

流程為「切出各道菜 →（選做）盤緣橢圓 → 整張與各裁切縮放壓縮」，由 ``FoodConfig.enable_*`` 開關。
切菜只回傳框座標（``Box``），不暴露輪廓等實作細節，之後若改用 SAM 等工具可直接替換。
只做影像處理，不呼叫 VLM（屬模組四）；VLM 輸入的最終尺寸由 E2 實驗決定。
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import cv2
import numpy as np
import numpy.typing as npt

from dietai.preprocess import ops
from dietai.preprocess.config import FoodConfig
from dietai.preprocess.types import Box, Ellipse, Image, PreprocessWarning, StepRecord

_COVERAGE_BINS = 36  # 計算圓周覆蓋時把橢圓周分成的角度格數（每格 10°）


@dataclass(frozen=True)
class VlmImage:
    """``resize_for_vlm`` 的結果。

    ``image`` 為縮放後、壓縮前的影像；``jpeg`` 為實際要送出的 JPEG 位元組；
    ``scale`` 為縮放倍率（輸出長邊 ÷ 輸入長邊，未縮小時為 1），可把 VLM 回傳的座標換回原圖。
    """

    image: Image
    jpeg: bytes
    scale: float

    @property
    def num_bytes(self) -> int:
        return len(self.jpeg)


@dataclass(frozen=True)
class FoodResult:
    """``preprocess_food`` 的結果。

    ``whole`` 為整張影像的 VLM 輸入；``dishes`` 為各道菜的框（原圖座標，面積由大到小），
    ``crops`` 為對應各框的 VLM 輸入（順序與 ``dishes`` 相同）。未啟用切菜時 ``dishes`` 為
    ``None``、``crops`` 為空。``plates`` 為盤緣橢圓（原圖座標），未啟用時為 ``None``。
    """

    whole: VlmImage
    dishes: tuple[Box, ...] | None
    crops: tuple[VlmImage, ...]
    plates: tuple[Ellipse, ...] | None
    steps: tuple[StepRecord, ...]
    warnings: tuple[PreprocessWarning, ...]

    @property
    def image(self) -> Image:
        """整張影像縮放後的版本（與 ``whole.image`` 相同）。"""
        return self.whole.image


def resize_for_vlm(img: Image, max_side: int, jpeg_quality: int) -> VlmImage:
    """等比縮小使長邊等於 ``max_side``（較小的影像不放大），再以 ``jpeg_quality`` 壓成 JPEG。

    輸入為 BGR 或灰階 ``uint8`` 影像，不會被修改；縮小用 ``INTER_AREA``。
    「不影響準確率的最小尺寸」由 E2 實驗決定，這裡不設預設值，``preprocess_food`` 由
    ``FoodConfig.vlm_max_side``、``FoodConfig.vlm_jpeg_quality`` 傳入。
    """
    ops.validate_image(img)
    if max_side <= 0:
        raise ValueError(f"max_side 必須為正整數，收到 {max_side}")
    if not 1 <= jpeg_quality <= 100:
        raise ValueError(f"jpeg_quality 必須介於 1 與 100，收到 {jpeg_quality}")
    h, w = img.shape[:2]
    long_side = max(h, w)
    if long_side <= max_side:
        out, scale = img.copy(), 1.0
    else:
        scale = max_side / long_side
        # 長邊直接設為 max_side，避免浮點取整差一像素
        size = (
            (max_side, max(1, round(h * scale))) if w >= h else (max(1, round(w * scale)), max_side)
        )
        out = np.asarray(cv2.resize(img, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not ok:  # pragma: no cover - OpenCV 對合法的 uint8 影像不會失敗
        raise RuntimeError("JPEG 編碼失敗")
    return VlmImage(image=out, jpeg=buf.tobytes(), scale=scale)


def dish_foreground(img: Image, cfg: FoodConfig = FoodConfig()) -> npt.NDArray[np.bool_]:
    """切菜用的前景遮罩（盤子與食物），也是 ``crop_dishes`` 的中間結果。

    影像先縮小到短邊 ``cfg.detect_short_side``（較小則不放大）並高斯平滑；以四周寬
    ``cfg.bg_border_ratio`` 的邊框估計桌面背景色（LAB 中位數），與背景色的 ΔE（CIE76）超過
    ``cfg.bg_distance`` 者為前景，再以半徑 ``cfg.morph_px`` 做閉運算與開運算，最後填滿被前景
    包圍的洞（與桌面同色的食物仍屬於盤子）。回傳的尺寸為縮小後的尺寸。
    """
    mask, _ = _foreground(img, cfg)
    return mask


def crop_dishes(img: Image, cfg: FoodConfig = FoodConfig()) -> tuple[Box, ...]:
    """切出各道菜的框（原圖座標），依面積由大到小排列；切不出時回傳空的 tuple。

    取 ``dish_foreground`` 各個外輪廓的外接矩形，依序過濾：面積比例不在
    ``cfg.min_dish_area_ratio``–``cfg.max_dish_area_ratio`` 之間者不採用；與已保留的框
    IoU 超過 ``cfg.max_overlap`` 者不採用；最多保留 ``cfg.max_dishes`` 個。
    保留的框再向外擴張邊長的 ``cfg.box_pad_ratio`` 倍並截在影像內。輸入不會被修改。

    相鄰或互相接觸的盤子會被併成同一個框（已知限制，見任務書第 9 節）。
    """
    mask, factor = _foreground(img, cfg)
    sh, sw = mask.shape
    total = sh * sw
    contours, _ = cv2.findContours(
        mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    rects = sorted((cv2.boundingRect(c) for c in contours), key=lambda r: r[2] * r[3], reverse=True)
    kept: list[Box] = []
    for x, y, w, h in rects:
        ratio = w * h / total
        if ratio < cfg.min_dish_area_ratio:
            break  # 已依面積排序，之後的都更小
        if ratio > cfg.max_dish_area_ratio:
            continue
        box = Box(x, y, w, h)
        if any(box.iou(k) > cfg.max_overlap for k in kept):
            continue
        kept.append(box)
        if len(kept) == cfg.max_dishes:
            break
    height, width = img.shape[:2]
    return tuple(_to_original(b, factor, cfg.box_pad_ratio, width, height) for b in kept)


def detect_plate_ellipse(img: Image, cfg: FoodConfig = FoodConfig()) -> tuple[Ellipse, ...]:
    """以橢圓擬合偵測盤緣，回傳原圖座標的橢圓，依面積由大到小；找不到時回傳空的 tuple。

    在縮小後的灰階影像上做 Canny（``cfg.plate_canny_low``、``cfg.plate_canny_high``），
    對點數不少於 ``cfg.plate_min_contour_points`` 的輪廓以 ``cv2.fitEllipse`` 擬合，只保留：
    長軸不小於短邊的 ``cfg.plate_min_size_ratio``、短長軸比不小於 ``cfg.plate_min_axis_ratio``、
    輪廓點正規化半徑的平均殘差不大於 ``cfg.plate_max_residual``、
    且輪廓涵蓋橢圓周至少 ``cfg.plate_min_coverage`` 者。
    中心落在較大橢圓內部的候選（盤緣內圈、盤中食物、同一邊緣的兩側）不採用。
    """
    ops.validate_image(img)
    small, factor = _detect_scale(img, cfg.detect_short_side)
    gray = ops.to_gray(small)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), cfg.plate_canny_low, cfg.plate_canny_high)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    sh, sw = gray.shape
    min_major = cfg.plate_min_size_ratio * min(sh, sw)
    candidates: list[Ellipse] = []
    for contour in contours:
        if len(contour) < cfg.plate_min_contour_points:
            continue
        _, _, bw, bh = cv2.boundingRect(contour)
        if max(bw, bh) < min_major:
            continue
        e = _fit_ellipse(contour)
        if e is None or e.major < min_major or e.minor / e.major < cfg.plate_min_axis_ratio:
            continue
        if not (0 <= e.cx < sw and 0 <= e.cy < sh):
            continue
        pts = contour.reshape(-1, 2).astype(np.float64)
        residual, coverage = _fit_quality(e, pts)
        if residual <= cfg.plate_max_residual and coverage >= cfg.plate_min_coverage:
            candidates.append(e)
    kept: list[Ellipse] = []
    for e in sorted(candidates, key=lambda c: c.major * c.minor, reverse=True):
        if any(k.normalized_radius(e.cx, e.cy) < 1 for k in kept):
            continue
        kept.append(e)
    return tuple(
        Ellipse(e.cx / factor, e.cy / factor, e.major / factor, e.minor / factor, e.angle)
        for e in kept
    )


def preprocess_food(img: Image, cfg: FoodConfig = FoodConfig()) -> FoodResult:
    """食物照片前處理：切出各道菜 →（選做）盤緣橢圓 → 整張與各裁切縮放壓縮給 VLM。

    輸入為 BGR 或灰階 ``uint8`` 影像，不會被修改。切菜與盤緣由 ``cfg.enable_crop``、
    ``cfg.enable_plate`` 開關；縮放壓縮一律執行（``cfg.vlm_max_side``、``cfg.vlm_jpeg_quality``）。
    啟用切菜但切不出任何框時附 ``DISH_NOT_FOUND``，只輸出整張影像。每段的參數與耗時記錄在
    ``steps``。
    """
    ops.validate_image(img)
    steps: list[StepRecord] = []
    warnings: list[PreprocessWarning] = []
    dishes: tuple[Box, ...] | None = None
    plates: tuple[Ellipse, ...] | None = None

    if cfg.enable_crop:
        start = time.perf_counter()
        dishes = crop_dishes(img, cfg)
        steps.append(
            StepRecord(
                "crop_dishes",
                _ms_since(start),
                {
                    "count": len(dishes),
                    "detect_short_side": cfg.detect_short_side,
                    "bg_border_ratio": cfg.bg_border_ratio,
                    "bg_distance": cfg.bg_distance,
                    "morph_px": cfg.morph_px,
                    "min_dish_area_ratio": cfg.min_dish_area_ratio,
                    "max_dish_area_ratio": cfg.max_dish_area_ratio,
                    "max_overlap": cfg.max_overlap,
                    "max_dishes": cfg.max_dishes,
                    "box_pad_ratio": cfg.box_pad_ratio,
                },
            )
        )
        if not dishes:
            warnings.append(PreprocessWarning.DISH_NOT_FOUND)

    if cfg.enable_plate:
        start = time.perf_counter()
        plates = detect_plate_ellipse(img, cfg)
        steps.append(
            StepRecord(
                "detect_plate_ellipse",
                _ms_since(start),
                {
                    "count": len(plates),
                    "plate_canny_low": cfg.plate_canny_low,
                    "plate_canny_high": cfg.plate_canny_high,
                    "plate_min_size_ratio": cfg.plate_min_size_ratio,
                    "plate_min_axis_ratio": cfg.plate_min_axis_ratio,
                    "plate_max_residual": cfg.plate_max_residual,
                    "plate_min_coverage": cfg.plate_min_coverage,
                    "plate_min_contour_points": cfg.plate_min_contour_points,
                },
            )
        )

    start = time.perf_counter()
    whole = resize_for_vlm(img, cfg.vlm_max_side, cfg.vlm_jpeg_quality)
    crops = tuple(
        resize_for_vlm(box.crop(img), cfg.vlm_max_side, cfg.vlm_jpeg_quality)
        for box in dishes or ()
    )
    steps.append(
        StepRecord(
            "resize_for_vlm",
            _ms_since(start),
            {
                "vlm_max_side": cfg.vlm_max_side,
                "vlm_jpeg_quality": cfg.vlm_jpeg_quality,
                "images": 1 + len(crops),
                "total_bytes": whole.num_bytes + sum(c.num_bytes for c in crops),
            },
        )
    )

    return FoodResult(
        whole=whole,
        dishes=dishes,
        crops=crops,
        plates=plates,
        steps=tuple(steps),
        warnings=tuple(warnings),
    )


# ---------------------------------------------------------------- 內部實作


def _detect_scale(img: Image, short_side: int) -> tuple[Image, float]:
    """縮小到偵測用短邊（不放大），回傳（小圖, 縮放倍率）；保留色彩。"""
    short = min(img.shape[:2])
    if short <= short_side:
        return img, 1.0
    return ops.resize_short_side(img, short_side), short_side / short


def _foreground(img: Image, cfg: FoodConfig) -> tuple[npt.NDArray[np.bool_], float]:
    ops.validate_image(img)
    small, factor = _detect_scale(img, cfg.detect_short_side)
    bgr = small if small.ndim == 3 else cv2.cvtColor(small, cv2.COLOR_GRAY2BGR)
    lab = cv2.cvtColor(cv2.GaussianBlur(bgr, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    # OpenCV 的 8 位元 LAB：L 縮放到 0–255、a／b 加 128；換回 CIELAB 單位使門檻即為 ΔE
    lab[..., 0] *= 100 / 255
    lab[..., 1:] -= 128
    h, w = lab.shape[:2]
    border = max(1, round(cfg.bg_border_ratio * min(h, w)))
    samples = np.concatenate(
        [
            lab[:border].reshape(-1, 3),
            lab[-border:].reshape(-1, 3),
            lab[border:-border, :border].reshape(-1, 3),
            lab[border:-border, -border:].reshape(-1, 3),
        ]
    )
    background = np.median(samples, axis=0)
    mask = (np.linalg.norm(lab - background, axis=2) > cfg.bg_distance).astype(np.uint8)
    if cfg.morph_px > 0:
        size = 2 * cfg.morph_px + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    # 填滿被前景包圍的洞：與桌面同色的食物仍屬於盤子
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(mask, contours, -1, 1, thickness=cv2.FILLED)
    return mask.astype(bool), factor


def _to_original(box: Box, factor: float, pad_ratio: float, width: int, height: int) -> Box:
    """縮小後的框換回原圖座標、向外擴張並截在影像內。"""
    px, py = pad_ratio * box.w, pad_ratio * box.h
    x0 = max(0, int(np.floor((box.x - px) / factor)))
    y0 = max(0, int(np.floor((box.y - py) / factor)))
    x1 = min(width, int(np.ceil((box.x1 + px) / factor)))
    y1 = min(height, int(np.ceil((box.y1 + py) / factor)))
    return Box(x0, y0, max(1, x1 - x0), max(1, y1 - y0))


def _fit_ellipse(contour: cv2.typing.MatLike) -> Ellipse | None:
    """``cv2.fitEllipse`` 轉成 ``Ellipse``（長軸在前、角度為長軸方向）；退化時回傳 ``None``。"""
    (cx, cy), (d1, d2), angle = cv2.fitEllipse(contour)
    if not (np.isfinite([cx, cy, d1, d2, angle]).all() and min(d1, d2) > 0):
        return None
    if d1 < d2:  # OpenCV 的角度是第一軸的方向
        d1, d2, angle = d2, d1, angle + 90
    return Ellipse(float(cx), float(cy), float(d1), float(d2), float(angle % 180))


def _fit_quality(e: Ellipse, pts: npt.NDArray[np.float64]) -> tuple[float, float]:
    """（平均殘差, 圓周覆蓋比例）：殘差為輪廓點正規化半徑與 1 的平均差。"""
    t = np.radians(e.angle)
    dx, dy = pts[:, 0] - e.cx, pts[:, 1] - e.cy
    u = (dx * np.cos(t) + dy * np.sin(t)) / (e.major / 2)
    v = (-dx * np.sin(t) + dy * np.cos(t)) / (e.minor / 2)
    residual = float(np.abs(np.hypot(u, v) - 1).mean())
    bins = ((np.arctan2(v, u) + np.pi) / (2 * np.pi) * _COVERAGE_BINS).astype(int)
    coverage = len(np.unique(np.clip(bins, 0, _COVERAGE_BINS - 1))) / _COVERAGE_BINS
    return residual, coverage


def _ms_since(start: float) -> float:
    return (time.perf_counter() - start) * 1000
