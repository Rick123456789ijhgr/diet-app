"""影像前處理（模組一）。

影像一律為 ``uint8`` 的 ``numpy.ndarray``，彩色為 BGR，灰階為 2 維。
所有門檻與參數由 ``dietai.preprocess.config`` 的 dataclass 傳入。

條碼與發票 QR 相關功能（``barcode``、``decoders``、``invoice_qr``）解碼時需要
zxing-cpp（``vision`` extra）。營養標示（``label``）與食物照片（``food``）只需 OpenCV。
"""

# 以下依子模組分組匯入公開介面：
# barcode／decoders（條碼）、config（各流程的參數 dataclass）、food（食物照片）、
# invoice_qr（電子發票 QR）、label（營養標示）、quality（影像品質檢查）、types（共用型別）。
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
    RETAIL_FORMATS,
    FoodConfig,
    InvoiceQrConfig,
    LabelConfig,
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
from dietai.preprocess.food import (
    FoodResult,
    VlmImage,
    crop_dishes,
    detect_plate_ellipse,
    dish_foreground,
    preprocess_food,
    resize_for_vlm,
)
from dietai.preprocess.invoice_qr import InvoiceQrResult, locate_invoice_qrs
from dietai.preprocess.label import (
    GlareResult,
    LabelResult,
    detect_glare,
    enhance_contrast,
    label_edges,
    locate_label_quad,
    preprocess_label,
    rectify,
    remove_glare,
)
from dietai.preprocess.quality import (
    ExposureStats,
    QualityReport,
    blur_score,
    check_quality,
    exposure_stats,
    resolution_check,
)
from dietai.preprocess.types import Box, Ellipse, PreprocessWarning, Quad, Rung, StepRecord

# 對外公開的名稱；新增公開介面時，上方的 import 與此清單兩處都要加
__all__ = [
    "DEFAULT_RUNGS",
    "Box",
    "CodeFormat",
    "DecodeHit",
    "Decoder",
    "Ellipse",
    "ExposureStats",
    "FoodConfig",
    "FoodResult",
    "GlareResult",
    "InvoiceQrConfig",
    "InvoiceQrResult",
    "LabelConfig",
    "LabelResult",
    "LadderConfig",
    "LadderResult",
    "PreprocessWarning",
    "PyzbarDecoder",
    "Quad",
    "QualityConfig",
    "QualityReport",
    "RETAIL_FORMATS",
    "Rung",
    "RungAttempt",
    "StepRecord",
    "Variant",
    "VlmImage",
    "ZxingConfig",
    "ZxingDecoder",
    "blur_score",
    "check_quality",
    "crop_dishes",
    "decode_with_ladder",
    "detect_glare",
    "detect_plate_ellipse",
    "dish_foreground",
    "ean13_check_digit",
    "ean13_checksum_ok",
    "enhance_contrast",
    "exposure_stats",
    "label_edges",
    "ladder_variants",
    "locate_invoice_qrs",
    "locate_label_quad",
    "preprocess_food",
    "preprocess_label",
    "rectify",
    "remove_glare",
    "resize_for_vlm",
    "resolution_check",
]
