"""營養標示解析與邏輯驗證（模組二）。"""

# 營養標示讀取的設定（巢狀包含模組一的 LabelConfig）
from dietai.label_parsing.config import LabelReadConfig

# 欄位解析：OCR 文字行 → 各欄位的數值與單位（規則式、確定性）
from dietai.label_parsing.fields import (
    FIELDS,
    HEADER_FIELDS,
    NUTRIENT_FIELDS,
    Quantity,
    format_fields,
    normalize_line,
    normalize_text,
    parse_fields,
    parse_quantity,
)

# OCR 介面（實作在 dietai.adapters）與文字框排成文字行
from dietai.label_parsing.ocr import OcrBox, OcrEngine, group_lines

# 營養標示讀取：前處理 → OCR → 解析 → 欄基準 → 驗證（產品與 E2 共用的單一入口）
from dietai.label_parsing.reader import (
    BASES,
    LabelReading,
    LabelReadWarning,
    assign_cells,
    detect_columns,
    read_label,
    to_nutrition_label,
)

__all__ = [
    "BASES",
    "FIELDS",
    "HEADER_FIELDS",
    "NUTRIENT_FIELDS",
    "LabelReadConfig",
    "LabelReadWarning",
    "LabelReading",
    "OcrBox",
    "OcrEngine",
    "Quantity",
    "assign_cells",
    "detect_columns",
    "format_fields",
    "group_lines",
    "normalize_line",
    "normalize_text",
    "parse_fields",
    "parse_quantity",
    "read_label",
    "to_nutrition_label",
]
