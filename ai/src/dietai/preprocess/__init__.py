"""影像前處理（模組一）。

影像一律為 ``uint8`` 的 ``numpy.ndarray``，彩色為 BGR，灰階為 2 維。
所有門檻與參數由 ``dietai.preprocess.config`` 的 dataclass 傳入。

條碼與發票 QR 相關功能（``barcode``、``decoders``、``invoice_qr``）解碼時需要
zxing-cpp（``vision`` extra）。
"""

from dietai.preprocess.barcode import (
    LadderResult,
    RungAttempt,
    Variant,
    decode_with_ladder,
    ean13_check_digit,
    ean13_checksum_ok,
    ladder_variants,
)
from dietai.preprocess.config import (
    DEFAULT_RUNGS,
    InvoiceQrConfig,
    LadderConfig,
    QualityConfig,
    ZxingConfig,
)
from dietai.preprocess.decoders import (
    CodeFormat,
    DecodeHit,
    Decoder,
    PyzbarDecoder,
    ZxingDecoder,
)
from dietai.preprocess.invoice_qr import InvoiceQrResult, locate_invoice_qrs
from dietai.preprocess.quality import (
    ExposureStats,
    QualityReport,
    blur_score,
    check_quality,
    exposure_stats,
    resolution_check,
)
from dietai.preprocess.types import PreprocessWarning, Rung, StepRecord

__all__ = [
    "DEFAULT_RUNGS",
    "CodeFormat",
    "DecodeHit",
    "Decoder",
    "ExposureStats",
    "InvoiceQrConfig",
    "InvoiceQrResult",
    "LadderConfig",
    "LadderResult",
    "PreprocessWarning",
    "PyzbarDecoder",
    "QualityConfig",
    "QualityReport",
    "Rung",
    "RungAttempt",
    "StepRecord",
    "Variant",
    "ZxingConfig",
    "ZxingDecoder",
    "blur_score",
    "check_quality",
    "decode_with_ladder",
    "ean13_check_digit",
    "ean13_checksum_ok",
    "exposure_stats",
    "ladder_variants",
    "locate_invoice_qrs",
    "resolution_check",
]
