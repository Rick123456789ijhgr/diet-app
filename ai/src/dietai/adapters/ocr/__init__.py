"""OCR 引擎的實作（介面見 ``dietai.label_parsing.ocr``）。

- ``CachedOcr``：任何引擎外面包一層快取，鍵為引擎名稱（含版本與設定）＋影像雜湊。
- ``TesseractEngine``：Tesseract（需安裝系統程式與 ``ocr`` extra 的 pytesseract）。
- ``PaddleEngine``：PaddleOCR（PP-OCRv5），在獨立 venv 的子行程執行（OpenCV 版本衝突）。
- ``make_engine``：由命令列的引擎描述建立引擎（實驗腳本用）。

引擎套件在建構時才匯入，沒有安裝時只有建構會失敗，匯入本模組不受影響。
"""

from __future__ import annotations

from pathlib import Path

from dietai.adapters.ocr.cache import CachedOcr, image_digest
from dietai.adapters.ocr.paddle import PaddleEngine
from dietai.adapters.ocr.tesseract import TesseractEngine
from dietai.label_parsing.ocr import OcrEngine

ENGINE_KINDS = ("tesseract", "paddle")


def make_engine(spec: str, tessdata_dir: str | Path | None = None) -> OcrEngine:
    """由描述建立引擎：``tesseract[:語言[:psm]]``（例如 ``tesseract:chi_tra+eng:6``）或
    ``paddle[:server|mobile]``。未知種類或格式錯誤時丟 ``ValueError``。"""
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
    if kind == "paddle":
        if len(args) > 1:
            raise ValueError(f"paddle 的格式為 paddle[:server|mobile]，收到 {spec!r}")
        return PaddleEngine(args[0] if args and args[0] else "server")
    raise ValueError(f"未知的 OCR 引擎 {kind!r}；可用：{list(ENGINE_KINDS)}")


__all__ = [
    "ENGINE_KINDS",
    "CachedOcr",
    "PaddleEngine",
    "TesseractEngine",
    "image_digest",
    "make_engine",
]
