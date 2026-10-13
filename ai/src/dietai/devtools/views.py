"""診斷檢視：把前處理的中間結果畫成影像，或整理成圖表資料。

數值一律取自 ``dietai.preprocess`` 的公開函式與中間結果，不另行計算。
"""

from __future__ import annotations

import cv2
import numpy as np
import numpy.typing as npt

from dietai.preprocess import QualityConfig
from dietai.preprocess.ops import to_gray
from dietai.preprocess.quality import exposure_masks, laplacian_map
from dietai.preprocess.types import Image

# BGR
DARK_COLOR = (255, 80, 0)
BRIGHT_COLOR = (0, 0, 255)
MASK_COLOR = (0, 0, 255)  # 紅：光斑、前景等遮罩


def laplacian_heatmap(img: Image, cfg: QualityConfig) -> Image:
    """拉普拉斯響應強度熱度圖（BGR）。以第 99 百分位正規化，避免少數強邊緣壓暗整張圖。"""
    mag = np.abs(laplacian_map(img, cfg))
    top = float(np.percentile(mag, 99)) or 1.0
    norm = np.clip(mag / top * 255, 0, 255).astype(np.uint8)
    return np.asarray(cv2.applyColorMap(norm, cv2.COLORMAP_INFERNO), dtype=np.uint8)


def exposure_overlay(img: Image, cfg: QualityConfig, alpha: float = 0.6) -> Image:
    """在原圖上以藍色標出過暗、紅色標出過亮像素（BGR）。"""
    dark, bright = exposure_masks(img, cfg)
    base = img if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    out = base.astype(np.float32)
    for mask, color in ((dark, DARK_COLOR), (bright, BRIGHT_COLOR)):
        out[mask] = out[mask] * (1 - alpha) + np.array(color, dtype=np.float32) * alpha
    return out.astype(np.uint8)


def gray_histogram_counts(img: Image) -> list[int]:
    """灰階直方圖：0–255 每一階的像素數（長度 256）。"""
    return [int(c) for c in np.bincount(to_gray(img).ravel(), minlength=256)]


def mask_overlay(img: Image, mask: npt.NDArray[np.bool_], alpha: float = 0.6) -> Image:
    """以紅色標出遮罩區域（BGR），例如光斑遮罩。"""
    base = img if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    out = base.astype(np.float32)
    out[mask] = out[mask] * (1 - alpha) + np.array(MASK_COLOR, dtype=np.float32) * alpha
    return out.astype(np.uint8)


def mask_on_small(img: Image, mask: npt.NDArray[np.bool_]) -> Image:
    """把縮小後算出的遮罩（如 ``food.dish_foreground``）疊在同尺寸的縮圖上（BGR）。"""
    h, w = mask.shape
    small = (
        img if img.shape[:2] == (h, w) else cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
    )
    return mask_overlay(np.asarray(small, dtype=np.uint8), mask)
