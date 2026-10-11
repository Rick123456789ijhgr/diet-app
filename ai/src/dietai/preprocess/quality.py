"""共通品質檢查：模糊、曝光、解析度。

門檻皆由 ``QualityConfig`` 傳入，數值待研究組以標記照片校準。
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass

import cv2
import numpy as np
import numpy.typing as npt

from dietai.preprocess.config import QualityConfig
from dietai.preprocess.ops import resize_short_side, to_gray, validate_image
from dietai.preprocess.types import Image, PreprocessWarning, StepRecord

# check_quality 可能產生的警告（依產生順序）
QUALITY_WARNINGS: tuple[PreprocessWarning, ...] = (
    PreprocessWarning.LOW_RESOLUTION,
    PreprocessWarning.TOO_BLURRY,
    PreprocessWarning.TOO_DARK,
    PreprocessWarning.TOO_BRIGHT,
)


@dataclass(frozen=True)
class ExposureStats:
    """亮度統計。``mean`` 為灰階平均（0–255），比例皆介於 0 與 1。"""

    mean: float
    dark_ratio: float
    bright_ratio: float


@dataclass(frozen=True)
class QualityReport:
    """``check_quality`` 的結果。

    品質檢查不產生新影像，因此沒有 ``image`` 欄位。
    ``passed`` 為 ``True`` 若且唯若 ``warnings`` 為空。
    """

    blur_score: float
    exposure: ExposureStats
    resolution_ok: bool
    passed: bool
    warnings: tuple[PreprocessWarning, ...]
    steps: tuple[StepRecord, ...]


def laplacian_map(img: Image, cfg: QualityConfig = QualityConfig()) -> npt.NDArray[np.float64]:
    """``blur_score`` 的中間結果：縮放到短邊 ``cfg.blur_short_side`` 後的灰階拉普拉斯響應。

    供視覺化檢查哪些區域貢獻邊緣；回傳 ``float64``，形狀為縮放後的 ``(H, W)``。
    """
    gray = resize_short_side(to_gray(img), cfg.blur_short_side)
    return np.asarray(cv2.Laplacian(gray, cv2.CV_64F), dtype=np.float64)


def blur_score(img: Image, cfg: QualityConfig = QualityConfig()) -> float:
    """模糊分數：灰階拉普拉斯變異數，越低越模糊。

    計算前先把影像等比縮放到短邊 ``cfg.blur_short_side``，
    避免解析度不同造成分數不可比。輸入為 BGR 或灰階 ``uint8`` 影像。
    """
    return float(laplacian_map(img, cfg).var())


def exposure_masks(
    img: Image, cfg: QualityConfig = QualityConfig()
) -> tuple[npt.NDArray[np.bool_], npt.NDArray[np.bool_]]:
    """``exposure_stats`` 的中間結果：（過暗遮罩, 過亮遮罩），形狀同輸入的 ``(H, W)``。

    過暗為灰階低於 ``cfg.dark_level``，過亮為高於 ``cfg.bright_level``。
    """
    gray = to_gray(img)
    return gray < cfg.dark_level, gray > cfg.bright_level


def exposure_stats(img: Image, cfg: QualityConfig = QualityConfig()) -> ExposureStats:
    """亮度平均，以及灰階低於 ``cfg.dark_level``、高於 ``cfg.bright_level`` 的像素比例。"""
    dark, bright = exposure_masks(img, cfg)
    return ExposureStats(
        mean=float(to_gray(img).mean()),
        dark_ratio=float(dark.mean()),
        bright_ratio=float(bright.mean()),
    )


def resolution_check(img: Image, cfg: QualityConfig = QualityConfig()) -> bool:
    """短邊不低於 ``cfg.min_short_side`` 時回傳 ``True``（通過）。"""
    validate_image(img)
    return bool(min(img.shape[:2]) >= cfg.min_short_side)


def check_quality(img: Image, cfg: QualityConfig = QualityConfig()) -> QualityReport:
    """綜合模糊、曝光、解析度檢查。

    使用 ``QualityConfig`` 的全部欄位；每項檢查的參數與耗時記錄在 ``steps``。
    警告依序可能為 ``LOW_RESOLUTION``、``TOO_BLURRY``、``TOO_DARK``、``TOO_BRIGHT``。
    """
    validate_image(img)
    params = asdict(cfg)
    steps: list[StepRecord] = []
    warnings: list[PreprocessWarning] = []

    start = time.perf_counter()
    resolution_ok = resolution_check(img, cfg)
    steps.append(
        StepRecord(
            "resolution_check",
            _ms_since(start),
            {"min_short_side": params["min_short_side"]},
        )
    )
    if not resolution_ok:
        warnings.append(PreprocessWarning.LOW_RESOLUTION)

    start = time.perf_counter()
    blur = blur_score(img, cfg)
    steps.append(
        StepRecord(
            "blur_score",
            _ms_since(start),
            {k: params[k] for k in ("blur_short_side", "blur_min")},
        )
    )
    if blur < cfg.blur_min:
        warnings.append(PreprocessWarning.TOO_BLURRY)

    start = time.perf_counter()
    exposure = exposure_stats(img, cfg)
    steps.append(
        StepRecord(
            "exposure_stats",
            _ms_since(start),
            {
                k: params[k]
                for k in ("dark_level", "dark_ratio_max", "bright_level", "bright_ratio_max")
            },
        )
    )
    if exposure.dark_ratio > cfg.dark_ratio_max:
        warnings.append(PreprocessWarning.TOO_DARK)
    if exposure.bright_ratio > cfg.bright_ratio_max:
        warnings.append(PreprocessWarning.TOO_BRIGHT)

    return QualityReport(
        blur_score=blur,
        exposure=exposure,
        resolution_ok=resolution_ok,
        passed=not warnings,
        warnings=tuple(warnings),
        steps=tuple(steps),
    )


def _ms_since(start: float) -> float:
    return (time.perf_counter() - start) * 1000
