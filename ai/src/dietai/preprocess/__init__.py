"""影像前處理（模組一）。

影像一律為 ``uint8`` 的 ``numpy.ndarray``，彩色為 BGR，灰階為 2 維。
所有門檻與參數由 ``dietai.preprocess.config`` 的 dataclass 傳入。
"""

from dietai.preprocess.config import QualityConfig
from dietai.preprocess.pipeline import PipelineResult, register, run_pipeline
from dietai.preprocess.quality import (
    ExposureStats,
    QualityReport,
    blur_score,
    check_quality,
    exposure_stats,
    resolution_check,
)
from dietai.preprocess.types import PreprocessWarning, StepRecord

__all__ = [
    "ExposureStats",
    "PipelineResult",
    "PreprocessWarning",
    "QualityConfig",
    "QualityReport",
    "StepRecord",
    "blur_score",
    "check_quality",
    "exposure_stats",
    "register",
    "resolution_check",
    "run_pipeline",
]
