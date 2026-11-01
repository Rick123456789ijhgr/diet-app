"""Tesseract adapter 的實機測試；沒有 pytesseract、tesseract 程式或語言包時略過（CI 不安裝）。"""

import os
from pathlib import Path

import pytest

pytesseract = pytest.importorskip("pytesseract")


@pytest.fixture(scope="module")
def engine():
    from dietai.adapters.ocr import TesseractEngine

    tessdata = os.environ.get("DIETAI_TESSDATA") or str(
        Path(os.environ.get("LOCALAPPDATA", "~"), "dietai", "tessdata")
    )
    try:
        return TesseractEngine("eng", tessdata_dir=tessdata if Path(tessdata).is_dir() else None)
    except (pytesseract.TesseractNotFoundError, FileNotFoundError) as e:
        pytest.skip(f"沒有可用的 tesseract：{e}")


def test_reads_rectified_synthetic_label(engine):
    from dietai.label_parsing import group_lines
    from dietai.synthetic import nutrition_label

    lines = group_lines(engine(nutrition_label()))
    assert any("Nutrition" in line for line in lines)
    assert engine.name.startswith("tesseract ") and "lang=eng" in engine.name


def test_rejects_tessdata_path_with_spaces(tmp_path):
    from dietai.adapters.ocr import TesseractEngine

    spaced = tmp_path / "with space"
    spaced.mkdir()
    with pytest.raises(ValueError, match="空白"):
        TesseractEngine("eng", tessdata_dir=spaced)
