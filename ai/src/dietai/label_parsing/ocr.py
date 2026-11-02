"""OCR 介面與文字框排版（與引擎無關）。

實際引擎（PaddleOCR、Tesseract 等）放在 ``dietai.adapters``，經快取層呼叫（ai/CLAUDE.md）；
核心邏輯只依賴這裡的 ``OcrEngine`` 介面，測試使用假實作。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from dietai.preprocess.types import Image


@dataclass(frozen=True)
class OcrBox:
    """OCR 找到的一段文字：內容、外接框（``x``、``y`` 為左上角，像素）與信心值（0–1）。"""

    text: str
    x: float
    y: float
    w: float
    h: float
    score: float = 1.0

    @property
    def cy(self) -> float:
        """垂直中心。"""
        return self.y + self.h / 2


class OcrEngine(Protocol):
    """OCR 引擎：輸入 BGR 或灰階 ``uint8`` 影像，回傳所有文字框（不保證順序）。

    ``name`` 寫入實驗紀錄，須含引擎、版本、模型與語言包（實驗設計 7.2 節）。
    """

    name: str

    def __call__(self, img: Image) -> list[OcrBox]: ...


def group_lines(boxes: Sequence[OcrBox], overlap: float = 0.5) -> list[str]:
    """把文字框排成由上到下的文字行，同一行內由左到右以空白串接。

    兩個框的垂直範圍重疊超過較矮者高度的 ``overlap`` 倍時視為同一行。營養標示的欄位名稱在左、
    數值在右，OCR 常把它們切成不同的框，排成一行後 ``fields.parse_fields`` 才能對上。
    """
    if not 0 < overlap <= 1:
        raise ValueError(f"overlap 必須介於 0（不含）與 1，收到 {overlap}")
    rows: list[list[OcrBox]] = []
    for box in sorted(boxes, key=lambda b: (b.cy, b.x)):
        for row in rows:
            ref = row[0]
            top, bottom = max(ref.y, box.y), min(ref.y + ref.h, box.y + box.h)
            if bottom - top > overlap * min(ref.h, box.h):
                row.append(box)
                break
        else:
            rows.append([box])
    rows.sort(key=lambda r: min(b.cy for b in r))
    return [" ".join(b.text for b in sorted(r, key=lambda b: b.x)) for r in rows]
