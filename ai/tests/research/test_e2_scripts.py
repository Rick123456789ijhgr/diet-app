"""research/experiments/e2_label 的腳本冒煙測試；沒有 Tesseract 時略過 run.py 的實際執行。"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

E2 = Path(__file__).resolve().parents[3] / "research" / "experiments" / "e2_label"


def _run(script: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(E2 / script), *args],
        capture_output=True,
        encoding="utf-8",
        check=False,
    )


def test_make_synthetic(tmp_path):
    proc = _run("make_synthetic.py", "--out", str(tmp_path / "d"), "--n", "2")
    assert proc.returncode == 0, proc.stderr
    assert (tmp_path / "d" / "manifest.csv").is_file()
    assert _run("make_synthetic.py", "--out", str(tmp_path / "x"), "--n", "0").returncode == 2


def test_run_rejects_unknown_engine_and_method(tmp_path):
    _run("make_synthetic.py", "--out", str(tmp_path / "d"), "--n", "1")
    manifest = str(tmp_path / "d" / "manifest.csv")
    bad = _run("run.py", "--manifest", manifest, "--engines", "nope", "--out", str(tmp_path / "r"))
    assert bad.returncode == 2 and "未知的 OCR 引擎" in bad.stderr
    bad = _run("run.py", "--manifest", manifest, "--only", "l9", "--out", str(tmp_path / "r"))
    assert bad.returncode == 2 and "找不到前處理方法" in bad.stderr


def test_run_end_to_end_with_tesseract(tmp_path):
    pytest.importorskip("pytesseract")
    tessdata = Path(os.environ.get("LOCALAPPDATA", "~"), "dietai", "tessdata")
    if not (tessdata / "eng.traineddata").is_file():
        pytest.skip("沒有 Tesseract 語言包")
    _run("make_synthetic.py", "--out", str(tmp_path / "d"), "--n", "1")
    args = ["--manifest", str(tmp_path / "d" / "manifest.csv"), "--engines", "tesseract:eng"]
    args += [
        "--tessdata",
        str(tessdata),
        "--cache",
        str(tmp_path / "c"),
        "--out",
        str(tmp_path / "r"),
    ]
    proc = _run("run.py", *args)
    if proc.returncode != 0 and "tesseract" in proc.stderr.lower():
        pytest.skip(f"沒有可用的 tesseract：{proc.stderr[-200:]}")
    assert proc.returncode == 0, proc.stderr
    (run_dir,) = (tmp_path / "r").iterdir()
    meta = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    assert list(meta["methods"]) == ["l0_raw", "l1_rectify", "l2_default"]
    assert meta["engines"]["tesseract:eng"].startswith("tesseract ")
    assert "## 整體 · Overall" in (run_dir / "summary.md").read_text(encoding="utf-8")
    # 第二次執行全部命中快取
    again = _run("run.py", *args[:-1], str(tmp_path / "r2"))
    assert "快取命中 3 次" in again.stdout
