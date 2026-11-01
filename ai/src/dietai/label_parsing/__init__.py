"""營養標示解析與邏輯驗證（模組二）。"""

# 欄位解析：OCR 文字行 → 各欄位的數值與單位（規則式、確定性）
from dietai.label_parsing.fields import (
    FIELDS,
    HEADER_FIELDS,
    NUTRIENT_FIELDS,
    Quantity,
    format_fields,
    normalize_text,
    parse_fields,
    parse_quantity,
)

# OCR 介面（實作在 dietai.adapters）與文字框排成文字行
from dietai.label_parsing.ocr import OcrBox, OcrEngine, group_lines

__all__ = [
    "FIELDS",
    "HEADER_FIELDS",
    "NUTRIENT_FIELDS",
    "OcrBox",
    "OcrEngine",
    "Quantity",
    "format_fields",
    "group_lines",
    "normalize_text",
    "parse_fields",
    "parse_quantity",
]
