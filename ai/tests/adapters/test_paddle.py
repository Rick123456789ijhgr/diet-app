"""PaddleOCR adapter：協定與錯誤處理；實際辨識只在 ai/.venv-paddle 存在時執行（CI 不安裝）。"""

import sys

import numpy as np
import pytest

from dietai.adapters.ocr import PaddleEngine, make_engine
from dietai.adapters.ocr.paddle import default_python


def test_rejects_bad_spec_and_size():
    with pytest.raises(ValueError, match="paddle"):
        make_engine("paddle:server:extra")
    with pytest.raises(ValueError, match="size"):
        PaddleEngine("large")


def test_missing_python_is_explained(tmp_path):
    with pytest.raises(RuntimeError, match="venv-paddle"):
        PaddleEngine(python=tmp_path / "nope.exe")


def test_worker_startup_failure_reports_log():
    # 主環境沒有 paddleocr：工作行程匯入失敗，錯誤訊息應帶出原因
    pytest.importorskip("cv2")
    try:
        import paddleocr  # noqa: F401
    except ImportError:
        pass
    else:
        pytest.skip("主環境裝了 paddleocr")
    with pytest.raises(RuntimeError, match="paddle"):
        PaddleEngine(python=sys.executable)


@pytest.fixture(scope="module")
def engine():
    if not default_python().is_file():
        pytest.skip("沒有 ai/.venv-paddle")
    with PaddleEngine("mobile") as eng:
        yield eng


@pytest.mark.slow
def test_reads_synthetic_label(engine):
    from dietai.label_parsing import group_lines
    from dietai.synthetic import nutrition_label

    img = nutrition_label()
    lines = group_lines(engine(img))
    assert any("Nutrition" in line for line in lines)
    assert engine.name.startswith("paddleocr ") and "PP-OCRv5_mobile_rec=" in engine.name
    # 灰階也可，且同一張影像結果穩定
    gray = np.ascontiguousarray(img[..., 0])
    assert engine(gray) == engine(gray)
