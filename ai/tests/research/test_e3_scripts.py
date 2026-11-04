"""research/experiments/e3_invoice_qr 的腳本端到端冒煙測試：合成發票 → run.py。"""

import json
import subprocess
import sys
from pathlib import Path

E3 = Path(__file__).resolve().parents[3] / "research" / "experiments" / "e3_invoice_qr"


def _run(script: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(E3 / script), *args],
        capture_output=True,
        encoding="utf-8",
        check=False,
    )


def test_e3_end_to_end(tmp_path):
    data, runs = tmp_path / "data", tmp_path / "runs"
    made = _run("make_synthetic.py", "--out", str(data), "--n", "1", "--conditions", "blur")
    assert made.returncode == 0, made.stderr
    manifest = data / "variants" / "manifest.csv"
    proc = _run("run.py", "--manifest", str(manifest), "--out", str(runs), "--label", "t")
    assert proc.returncode == 0, proc.stderr
    (run_dir,) = runs.iterdir()
    meta = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    assert list(meta["methods"]) == ["q0_raw", "q1_all_methods"]
    summary = (run_dir / "summary.md").read_text(encoding="utf-8")
    assert "## 單一方法" in summary and "## 逐步升級" in summary


def test_scripts_reject_bad_arguments(tmp_path):
    assert _run("make_synthetic.py", "--out", str(tmp_path / "x"), "--n", "0").returncode == 2
    bad = _run("make_synthetic.py", "--out", str(tmp_path / "y"), "--conditions", "nope")
    assert bad.returncode == 2 and "沒有這些劣化條件" in bad.stderr
    _run("make_synthetic.py", "--out", str(tmp_path / "d"), "--n", "1", "--conditions", "blur")
    manifest = str(tmp_path / "d" / "variants" / "manifest.csv")
    bad = _run("run.py", "--manifest", manifest, "--only", "nope", "--out", str(tmp_path / "r"))
    assert bad.returncode == 2
