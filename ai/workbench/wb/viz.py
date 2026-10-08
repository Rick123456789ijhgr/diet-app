"""品質檢查的視覺化。數值一律取自 ``dietai.preprocess.quality`` 的中間結果，不另行計算。"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from dietai.preprocess import QualityConfig, QualityReport
from dietai.preprocess.ops import to_gray
from dietai.preprocess.quality import exposure_masks, laplacian_map
from dietai.preprocess.types import Image

# BGR
DARK_COLOR = (255, 80, 0)
BRIGHT_COLOR = (0, 0, 255)


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


def gray_histogram(img: Image) -> list[dict[str, int]]:
    """灰階直方圖（0–255 每一階的像素數）。"""
    counts = np.bincount(to_gray(img).ravel(), minlength=256)
    return [{"灰階": i, "像素數": int(c)} for i, c in enumerate(counts)]


def report_metrics(report: QualityReport) -> dict[str, Any]:
    """把報告攤平成一列，供批次表格使用。"""
    return {
        "模糊分數": round(report.blur_score, 2),
        "平均亮度": round(report.exposure.mean, 2),
        "過暗比例": round(report.exposure.dark_ratio, 4),
        "過亮比例": round(report.exposure.bright_ratio, 4),
        "解析度通過": report.resolution_ok,
        "通過": report.passed,
        "警告": ", ".join(w.value for w in report.warnings),
    }


def steps_rows(report: QualityReport) -> list[dict[str, Any]]:
    return [
        {
            "步驟": s.name,
            "耗時（ms）": round(s.elapsed_ms, 3),
            "參數": ", ".join(f"{k}={v}" for k, v in s.params.items()),
        }
        for s in report.steps
    ]
