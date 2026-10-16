"""營養標示前處理：表格定位、透視校正、光斑處理、對比增強。

流程為「定位＋校正 → 光斑 → 對比」，各段由 ``LabelConfig.enable_*`` 開關。
找不到表格框時不中斷：以原圖繼續後續步驟並附 ``LABEL_NOT_LOCATED``。
只做影像處理，不做 OCR 或欄位解析（屬模組二）。
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np
import numpy.typing as npt

from dietai.preprocess import ops
from dietai.preprocess.config import LabelConfig
from dietai.preprocess.types import Image, PreprocessWarning, Quad, StepRecord

QuadMethod = Literal["contour", "hough"]


@dataclass(frozen=True)
class GlareResult:
    """``detect_glare`` 的結果：``mask`` 形狀為輸入的 ``(H, W)``，``ratio`` 為其面積比例。"""

    mask: npt.NDArray[np.bool_]
    ratio: float


@dataclass(frozen=True)
class LabelResult:
    """``preprocess_label`` 的結果。

    ``image`` 為處理後影像（校正後尺寸可能與輸入不同；``clahe_on_lab`` 關閉時為灰階）。
    ``quad`` 為找到的表格四角（原圖座標，左上起順時針），``quad_method`` 為找到它的方法；
    未啟用定位或找不到時皆為 ``None``。``glare`` 為光斑偵測結果（校正後座標），
    未啟用時為 ``None``。
    """

    image: Image
    quad: Quad | None
    quad_method: QuadMethod | None
    glare: GlareResult | None
    steps: tuple[StepRecord, ...]
    warnings: tuple[PreprocessWarning, ...]


def label_edges(img: Image, cfg: LabelConfig = LabelConfig()) -> Image:
    """定位用的邊緣圖（0／255 灰階），也是 ``locate_label_quad`` 的中間結果。

    影像先縮小到短邊 ``cfg.detect_short_side``（較小則不放大），高斯平滑後做
    Canny（``cfg.canny_low``、``cfg.canny_high``），再以 3×3 膨脹接上斷開的細縫。
    回傳的尺寸為縮小後的尺寸。
    """
    small, _ = _detect_scale(img, cfg)
    return _edges(small, cfg)


def locate_label_quad(img: Image, cfg: LabelConfig = LabelConfig()) -> Quad | None:
    """找出營養標示表格的四邊形，回傳原圖座標的四角（左上起順時針）；找不到時回傳 ``None``。

    先在 ``label_edges`` 上找面積最大、可近似成凸四邊形的輪廓（``cfg.approx_eps_ratio``）；
    找不到時改以 HoughLinesP（``cfg.hough_*``）找出最外側的上下左右四條直線並求交點。
    面積比例不在 ``cfg.min_quad_area_ratio``–``cfg.max_quad_area_ratio`` 之間的四邊形不採用。
    輸入不會被修改。
    """
    quad, _ = _locate(img, cfg)
    return quad


def rectify(img: Image, quad: npt.ArrayLike, cfg: LabelConfig = LabelConfig()) -> Image:
    """以單應性轉換把 ``quad`` 圍出的區域拉成正視的矩形。

    四角先以 ``ops.order_quad`` 排序，因此順序不拘。四角視為角落像素的中心（OpenCV 慣例），
    對應到輸出的 ``(0, 0)``–``(w − 1, h − 1)``，四條邊上的像素都保留在輸出內。
    輸出寬為上下兩邊較長者加 1、高為左右兩邊較長者加 1（像素數）；長邊超過
    ``cfg.rectify_max_side`` 時等比縮小。
    """
    ops.validate_image(img)
    q = ops.order_quad(quad)
    tl, tr, br, bl = q
    width = max(float(np.linalg.norm(tr - tl)), float(np.linalg.norm(br - bl)))
    height = max(float(np.linalg.norm(bl - tl)), float(np.linalg.norm(br - tr)))
    shrink = min(1.0, (cfg.rectify_max_side - 1) / max(width, height, 1.0))
    w, h = max(2, round(width * shrink) + 1), max(2, round(height * shrink) + 1)
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(q, dst)
    out = cv2.warpPerspective(
        img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
    return np.asarray(out, dtype=np.uint8)


def detect_glare(img: Image, cfg: LabelConfig = LabelConfig()) -> GlareResult:
    """偵測反光光斑：HSV 中亮度 ≥ ``cfg.glare_v_min`` 且飽和度 ≤ ``cfg.glare_s_max`` 的像素。

    灰階影像沒有飽和度，只以亮度判斷。遮罩再向外擴張 ``cfg.glare_dilate_px`` 像素，
    以涵蓋光斑邊緣的漸層。
    """
    ops.validate_image(img)
    if img.ndim == 2:
        raw = img >= cfg.glare_v_min
    else:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        raw = (hsv[..., 2] >= cfg.glare_v_min) & (hsv[..., 1] <= cfg.glare_s_max)
    mask = raw.astype(np.uint8)
    if cfg.glare_dilate_px > 0 and mask.any():
        size = 2 * cfg.glare_dilate_px + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
        mask = np.asarray(cv2.dilate(mask, kernel), dtype=np.uint8)
    result = mask.astype(bool)
    return GlareResult(mask=result, ratio=float(result.mean()))


def remove_glare(
    img: Image, mask: npt.NDArray[np.bool_], cfg: LabelConfig = LabelConfig()
) -> tuple[Image, PreprocessWarning | None]:
    """修補光斑：遮罩面積比例超過 ``cfg.glare_max_ratio`` 時不處理並回傳 ``GLARE_RETAKE``；
    否則以 ``cv2.inpaint``（Telea，半徑 ``cfg.inpaint_radius``）修補。

    回傳（影像, 警告或 ``None``），影像一律為新陣列。``mask`` 形狀須與影像的 ``(H, W)`` 相同。
    """
    ops.validate_image(img)
    if mask.shape != img.shape[:2]:
        raise ValueError(f"遮罩形狀 {mask.shape} 與影像 {img.shape[:2]} 不符")
    if float(mask.mean()) > cfg.glare_max_ratio:
        return img.copy(), PreprocessWarning.GLARE_RETAKE
    if not mask.any():
        return img.copy(), None
    out = cv2.inpaint(img, mask.astype(np.uint8) * 255, cfg.inpaint_radius, cv2.INPAINT_TELEA)
    return np.asarray(out, dtype=np.uint8), None


def enhance_contrast(img: Image, cfg: LabelConfig = LabelConfig()) -> Image:
    """CLAHE 局部對比增強（``cfg.clahe_clip``、``cfg.clahe_tile``）。

    ``cfg.clahe_on_lab`` 開啟且輸入為彩色時，只處理 LAB 的 L 通道並保留色彩（輸出 BGR）；
    否則轉灰階後處理（輸出灰階）。
    """
    ops.validate_image(img)
    if img.ndim == 3 and cfg.clahe_on_lab:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        lab[..., 0] = ops.clahe(np.ascontiguousarray(lab[..., 0]), cfg.clahe_clip, cfg.clahe_tile)
        return np.asarray(cv2.cvtColor(lab, cv2.COLOR_LAB2BGR), dtype=np.uint8)
    return ops.clahe(ops.to_gray(img), cfg.clahe_clip, cfg.clahe_tile)


def preprocess_label(img: Image, cfg: LabelConfig = LabelConfig()) -> LabelResult:
    """營養標示前處理：定位＋校正 → 光斑 → 對比，各段由 ``cfg.enable_*`` 開關。

    輸入為 BGR 或灰階 ``uint8`` 影像，不會被修改；三段全部關閉時輸出等於輸入（副本）。
    找不到表格框時以原圖繼續並附 ``LABEL_NOT_LOCATED``；光斑過大時不修補並附
    ``GLARE_RETAKE``，但對比增強照常執行。每段的參數與耗時記錄在 ``steps``。
    """
    ops.validate_image(img)
    out = img.copy()
    steps: list[StepRecord] = []
    warnings: list[PreprocessWarning] = []
    quad: Quad | None = None
    method: QuadMethod | None = None
    glare: GlareResult | None = None

    if cfg.enable_rectify:
        start = time.perf_counter()
        quad, method = _locate(img, cfg)
        steps.append(
            StepRecord(
                "locate_label_quad",
                _ms_since(start),
                {
                    "method": method or "none",
                    "detect_short_side": cfg.detect_short_side,
                    "canny_low": cfg.canny_low,
                    "canny_high": cfg.canny_high,
                    "approx_eps_ratio": cfg.approx_eps_ratio,
                    "min_quad_area_ratio": cfg.min_quad_area_ratio,
                    "max_quad_area_ratio": cfg.max_quad_area_ratio,
                    "hough_threshold": cfg.hough_threshold,
                    "hough_min_line_ratio": cfg.hough_min_line_ratio,
                    "hough_max_gap": cfg.hough_max_gap,
                    "hough_collinear_ratio": cfg.hough_collinear_ratio,
                    "hough_min_side_gap_ratio": cfg.hough_min_side_gap_ratio,
                    "hough_corner_margin_ratio": cfg.hough_corner_margin_ratio,
                },
            )
        )
        if quad is None:
            warnings.append(PreprocessWarning.LABEL_NOT_LOCATED)
        else:
            start = time.perf_counter()
            out = rectify(img, quad, cfg)
            steps.append(
                StepRecord(
                    "rectify",
                    _ms_since(start),
                    {"rectify_max_side": cfg.rectify_max_side, "size": out.shape[1::-1]},
                )
            )

    if cfg.enable_glare:
        start = time.perf_counter()
        glare = detect_glare(out, cfg)
        out, warning = remove_glare(out, glare.mask, cfg)
        if warning is not None:
            action = "retake"
            warnings.append(warning)
        else:
            action = "inpaint" if glare.ratio > 0 else "none"
        steps.append(
            StepRecord(
                "glare",
                _ms_since(start),
                {
                    "ratio": round(glare.ratio, 4),
                    "action": action,
                    "glare_v_min": cfg.glare_v_min,
                    "glare_s_max": cfg.glare_s_max,
                    "glare_dilate_px": cfg.glare_dilate_px,
                    "glare_max_ratio": cfg.glare_max_ratio,
                    "inpaint_radius": cfg.inpaint_radius,
                },
            )
        )

    if cfg.enable_contrast:
        start = time.perf_counter()
        out = enhance_contrast(out, cfg)
        steps.append(
            StepRecord(
                "enhance_contrast",
                _ms_since(start),
                {
                    "clahe_clip": cfg.clahe_clip,
                    "clahe_tile": cfg.clahe_tile,
                    "clahe_on_lab": cfg.clahe_on_lab,
                },
            )
        )

    return LabelResult(
        image=out,
        quad=quad,
        quad_method=method,
        glare=glare,
        steps=tuple(steps),
        warnings=tuple(warnings),
    )


# ---------------------------------------------------------------- 定位的內部實作


def _detect_scale(img: Image, cfg: LabelConfig) -> tuple[Image, float]:
    """縮小到定位用短邊（不放大），回傳（灰階小圖, 縮放倍率）。"""
    gray = ops.to_gray(img)
    short = min(gray.shape)
    if short <= cfg.detect_short_side:
        return gray, 1.0
    return ops.resize_short_side(gray, cfg.detect_short_side), cfg.detect_short_side / short


def _edges(gray: Image, cfg: LabelConfig) -> Image:
    smooth = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(smooth, cfg.canny_low, cfg.canny_high)
    return np.asarray(cv2.dilate(edges, np.ones((3, 3), np.uint8)), dtype=np.uint8)


def _locate(img: Image, cfg: LabelConfig) -> tuple[Quad | None, QuadMethod | None]:
    ops.validate_image(img)
    small, factor = _detect_scale(img, cfg)
    edges = _edges(small, cfg)
    total = small.shape[0] * small.shape[1]
    area = (cfg.min_quad_area_ratio * total, cfg.max_quad_area_ratio * total)
    found: tuple[Quad | None, QuadMethod | None] = (None, None)
    quad = _quad_from_contours(edges, cfg, area)
    if quad is not None:
        found = (quad, "contour")
    else:
        quad = _quad_from_lines(edges, cfg, area)
        if quad is not None:
            found = (quad, "hough")
    if found[0] is None:
        return found
    return (found[0] / np.float32(factor)).astype(np.float32), found[1]


def _quad_from_contours(edges: Image, cfg: LabelConfig, area: tuple[float, float]) -> Quad | None:
    """面積在 ``area``（最小, 最大）之間、由大到小第一個可近似成凸四邊形的輪廓。"""
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(contour) < area[0]:
            break
        eps = cfg.approx_eps_ratio * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, eps, True)
        if (
            len(approx) == 4
            and cv2.isContourConvex(approx)
            and area[0] <= cv2.contourArea(approx) <= area[1]
        ):
            return ops.order_quad(approx)
    return None


# 共線容許距離的下限：HoughLinesP 的距離解析度 1 像素，加上邊緣圖 3×3 膨脹的寬度
_MIN_COLLINEAR_PX = 2.0

# 直線：(點, 單位方向向量)
_Line = tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]


def _quad_from_lines(edges: Image, cfg: LabelConfig, area: tuple[float, float]) -> Quad | None:
    """HoughLinesP 備援：取最外側的上、下、左、右邊線求四個交點。

    線段依方向分為近水平與近垂直兩組。每組以線段延長後在影像中心處的位置排序，
    取兩端最外側的線段，收集與它共線（端點距離在 ``cfg.hough_collinear_ratio`` 內）的所有線段
    擬合一條直線；
    只收共線者是為了不把粗外框內側的另一條邊混進來，虛線外框的各段則會被收在一起。
    """
    h, w = edges.shape
    segments = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        cfg.hough_threshold,
        minLineLength=cfg.hough_min_line_ratio * min(h, w),
        maxLineGap=cfg.hough_max_gap,
    )
    if segments is None:
        return None
    segs = segments.reshape(-1, 4).astype(np.float64)
    dx, dy = segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1]
    horizontal = np.abs(dx) >= np.abs(dy)
    center = np.array([w / 2, h / 2])
    tol = max(_MIN_COLLINEAR_PX, cfg.hough_collinear_ratio * min(h, w))
    sides: list[_Line] = []
    for mask, axis in ((horizontal, 1), (~horizontal, 0)):
        group = segs[mask]
        if len(group) < 2:
            return None
        lines = [_fit_line(g[None, :]) for g in group]
        pos = np.array([_coord_at(line, center, axis) for line in lines])
        if pos.max() - pos.min() < cfg.hough_min_side_gap_ratio * min(h, w):  # 只有一條邊
            return None
        for extreme in (int(np.argmin(pos)), int(np.argmax(pos))):
            near = [_distance(lines[extreme], g) <= tol for g in group]
            sides.append(_fit_line(group[np.array(near)]))
    top, bottom, left, right = sides
    pairs = ((top, left), (top, right), (bottom, right), (bottom, left))
    corners = [_intersect(a, b) for a, b in pairs]
    if any(c is None for c in corners):
        return None
    quad = ops.order_quad(np.array(corners))
    margin = cfg.hough_corner_margin_ratio * max(h, w)
    inside = bool(((quad >= -margin) & (quad <= np.array([w, h]) + margin)).all())
    contour = quad.reshape(-1, 1, 2)
    if not inside or not cv2.isContourConvex(contour):
        return None
    if not area[0] <= cv2.contourArea(contour) <= area[1]:
        return None
    return quad


def _coord_at(line: _Line, center: npt.NDArray[np.float64], axis: int) -> float:
    """直線在影像中心處的座標：近水平線取 x = 中心時的 y（``axis=1``），近垂直線反之。"""
    p, r = line
    other = 1 - axis
    if abs(r[other]) < 1e-9:
        return float(p[axis])
    t = (center[other] - p[other]) / r[other]
    return float(p[axis] + t * r[axis])


def _distance(line: _Line, seg: npt.NDArray[np.float64]) -> float:
    """線段兩端點到直線的最大距離。"""
    p, r = line
    ends = seg.reshape(2, 2) - p
    return float(np.abs(ends[:, 0] * r[1] - ends[:, 1] * r[0]).max())


def _fit_line(segs: npt.NDArray[np.float64]) -> _Line:
    points = segs.reshape(-1, 2).astype(np.float32)
    vx, vy, x0, y0 = cv2.fitLine(points, cv2.DIST_L2, 0, 0.01, 0.01).ravel()
    return np.array([x0, y0], dtype=np.float64), np.array([vx, vy], dtype=np.float64)


def _intersect(a: _Line, b: _Line) -> npt.NDArray[np.float64] | None:
    (p, r), (q, s) = a, b
    cross = r[0] * s[1] - r[1] * s[0]
    if abs(cross) < 1e-6:  # 平行
        return None
    t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross
    return np.asarray(p + t * r, dtype=np.float64)


def _ms_since(start: float) -> float:
    return (time.perf_counter() - start) * 1000
