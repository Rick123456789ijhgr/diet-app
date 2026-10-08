"""共通品質檢查：模糊、曝光、解析度。門檻由呼叫端傳入，以標記集調整。"""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ExposureStats:
    mean: float
    dark_ratio: float
    bright_ratio: float


def exposure_stats(gray: np.ndarray, dark: int = 30, bright: int = 225) -> ExposureStats:
    """計算灰階影像的平均亮度與過暗、過亮像素比例。"""
    return ExposureStats(
        mean=float(gray.mean()),
        dark_ratio=float((gray < dark).mean()),
        bright_ratio=float((gray > bright).mean()),
    )


# TODO(模組一)：laplacian_variance（模糊偵測，需 OpenCV）、resolution_check
