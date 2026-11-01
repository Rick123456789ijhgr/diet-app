"""OCR 引擎的實作（介面見 ``dietai.label_parsing.ocr``）。

- ``CachedOcr``：任何引擎外面包一層快取，鍵為引擎名稱（含版本與設定）＋影像雜湊。
- ``TesseractEngine``：Tesseract（需安裝系統程式與 ``ocr`` extra 的 pytesseract）。
- ``make_engine``：由命令列的引擎描述建立引擎（實驗腳本用）。

引擎套件在建構時才匯入，沒有安裝時只有建構會失敗，匯入本模組不受影響。
"""

from __future__ import annotations

from pathlib import Path

from dietai.adapters.ocr.cache import CachedOcr, image_digest
from dietai.adapters.ocr.tesseract import TesseractEngine
from dietai.label_parsing.ocr import OcrEngine

ENGINE_KINDS = ("tesseract",)


def make_engine(spec: str, tessdata_dir: str | Path | None = None) -> OcrEngine:
    """由描述建立引擎：``種類[:語言[:psm]]``，例如 ``tesseract``、``tesseract:eng``、
    ``tesseract:chi_tra+eng:6``。未知種類或格式錯誤時丟 ``ValueError``。"""
    kind, *args = spec.split(":")
    if kind == "tesseract":
        if len(args) > 2:
            raise ValueError(f"tesseract 的格式為 tesseract[:語言[:psm]]，收到 {spec!r}")
        lang = args[0] if args and args[0] else "chi_tra+eng"
        try:
            psm = int(args[1]) if len(args) > 1 else 3
        except ValueError as e:
            raise ValueError(f"psm 須為整數，收到 {spec!r}") from e
        return TesseractEngine(lang, psm, tessdata_dir=tessdata_dir)
    raise ValueError(f"未知的 OCR 引擎 {kind!r}；可用：{list(ENGINE_KINDS)}")


__all__ = ["ENGINE_KINDS", "CachedOcr", "TesseractEngine", "image_digest", "make_engine"]
