"""自適應策略用的品質量測值（設計 6.7 節）：模糊、亮度、對比、雜訊、光線不均、傾斜、解析度、反光。

全部是確定性的影像統計，不訓練模型（根目錄規則 5）。除了解析度，其餘都在縮放到
``QualityConfig.blur_short_side`` 短邊的灰階上量測：不同解析度的照片可以互相比較，而且量測只在
原圖辨識失敗後才執行，耗時要比解碼低才有意義。
量測值的意義與單位見 ``QualityFeatures``；由量測值選擇處理方式的規則見 ``preprocess.adaptive``。
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass

import cv2
import numpy as np

from dietai.preprocess.config import QualityConfig
from dietai.preprocess.ops import estimate_skew, resize_short_side, to_gray, validate_image
from dietai.preprocess.quality import blur_score, exposure_stats
from dietai.preprocess.types import Image

# 與 3×3 中值濾波結果相差超過此灰階值的像素視為脈衝（椒鹽）雜訊
IMPULSE_DIFF = 64
# 估計背景光線：先縮到此短邊，再以短邊的 BACKGROUND_SIGMA 倍做高斯模糊（遠大於條碼線條與文字）
BACKGROUND_SHORT_SIDE = 64
BACKGROUND_SIGMA = 0.08
# 反光：灰階達此值（接近飽和）的連通區域，面積至少為量測影像面積的 GLARE_MIN_AREA 才算。
# 不用 QualityConfig.bright_level：白紙與白色包裝本身就高於它，會把整張背景當成反光
GLARE_LEVEL = 250
GLARE_MIN_AREA = 0.002


@dataclass(frozen=True)
class QualityFeatures:
    """一張影像的品質量測值。

    - ``blur``：拉普拉斯變異數（越小越模糊），同 ``quality.blur_score``
    - ``brightness``：灰階平均（0–255）；``dark_ratio``／``bright_ratio``：過暗／過亮像素比例
    - ``contrast``：灰階第 95 與第 5 百分位數的差（0–255）
    - ``noise``：灰階與 3×3 中值濾波結果的平均絕對差（灰階值）
    - ``impulse_ratio``：與中值濾波結果相差超過 ``IMPULSE_DIFF`` 的像素比例（椒鹽雜訊）
    - ``illumination``：大範圍模糊後的背景亮度之變異係數（標準差／平均，光線不均越大）
    - ``skew``：``ops.estimate_skew`` 的絕對值（度）
    - ``short_side``：原圖短邊（像素）
    - ``glare_ratio``：面積夠大的近飽和（≥ ``GLARE_LEVEL``）連通區域合計比例
    - ``measure_ms``：量測耗時（毫秒）
    """

    blur: float
    brightness: float
    dark_ratio: float
    bright_ratio: float
    contrast: float
    noise: float
    impulse_ratio: float
    illumination: float
    skew: float
    short_side: int
    glare_ratio: float
    measure_ms: float = 0.0

    def as_dict(self) -> dict[str, float]:
        """欄位名稱 → 數值（含 ``measure_ms``）。"""
        return {k: float(v) for k, v in asdict(self).items()}


# 可在規則中使用的量測值名稱（不含耗時）
FEATURE_NAMES: tuple[str, ...] = tuple(
    k for k in QualityFeatures.__dataclass_fields__ if k != "measure_ms"
)


def measure_features(img: Image, cfg: QualityConfig = QualityConfig()) -> QualityFeatures:
    """量測 ``img`` 的所有品質特徵；使用 ``cfg`` 的模糊與曝光設定。"""
    validate_image(img)
    start = time.perf_counter()
    small = resize_short_side(to_gray(img), cfg.blur_short_side)
    blur = blur_score(small, cfg)  # 已是 blur_short_side，不再縮放
    exposure = exposure_stats(small, cfg)

    p5, p95 = np.percentile(small, (5, 95))
    diff = cv2.absdiff(small, cv2.medianBlur(small, 3))
    tiny = resize_short_side(small, BACKGROUND_SHORT_SIDE).astype(np.float32)
    background = cv2.GaussianBlur(tiny, (0, 0), BACKGROUND_SIGMA * BACKGROUND_SHORT_SIDE)
    mean_bg = float(background.mean())
    illumination = float(background.std()) / mean_bg if mean_bg > 0 else 0.0

    bright = (small >= GLARE_LEVEL).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
    min_area = GLARE_MIN_AREA * small.size
    areas = stats[1:n, cv2.CC_STAT_AREA]  # 第 0 個是背景
    glare = float(areas[areas >= min_area].sum()) / small.size

    return QualityFeatures(
        blur=blur,
        brightness=exposure.mean,
        dark_ratio=exposure.dark_ratio,
        bright_ratio=exposure.bright_ratio,
        contrast=float(p95 - p5),
        noise=float(diff.mean()),
        impulse_ratio=float((diff > IMPULSE_DIFF).mean()),
        illumination=illumination,
        skew=abs(estimate_skew(small)),
        short_side=int(min(img.shape[:2])),
        glare_ratio=glare,
        measure_ms=(time.perf_counter() - start) * 1000,
    )
