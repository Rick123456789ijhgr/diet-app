"""research/experiments/e1_barcode 的腳本端到端冒煙測試：合成資料 → run.py → analyze.py。"""

import json
import subprocess
import sys
from pathlib import Path

E1 = Path(__file__).resolve().parents[3] / "research" / "experiments" / "e1_barcode"


def _run(script: str, *args: str) -> str:
    proc = subprocess.run(
        [sys.executable, str(E1 / script), *args],
        capture_output=True,
        encoding="utf-8",
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    return proc.stdout


def test_e1_end_to_end(tmp_path):
    data, runs = tmp_path / "data", tmp_path / "runs"
    _run("make_synthetic.py", "--out", str(data), "--codes", "1")
    manifest = data / "manifest.csv"
    assert manifest.is_file()

    out = _run(
        "run.py",
        "--manifest",
        str(manifest),
        "--only",
        "a0_raw,a6_full",
        "--out",
        str(runs),
        "--label",
        "smoke",
    )
    (run_dir,) = runs.iterdir()
    assert run_dir.name.endswith("_smoke")
    assert "完成" in out
    for name in ("results.csv", "attempts.csv", "run.json", "summary.md"):
        assert (run_dir / name).is_file(), name
    meta = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    assert [a["name"] for a in meta["arms"]] == ["a0_raw", "a6_full"]

    report = _run("analyze.py", str(run_dir), "--by", "condition")
    assert "依 `condition` 分組" in report
    assert (run_dir / "summary.csv").is_file()
    assert (run_dir / "summary_condition.csv").is_file()


def test_run_rejects_unknown_arm(tmp_path):
    proc = subprocess.run(
        [
            sys.executable,
            str(E1 / "run.py"),
            "--manifest",
            str(tmp_path / "m.csv"),
            "--only",
            "nope",
        ],
        capture_output=True,
        encoding="utf-8",
        check=False,
    )
    assert proc.returncode != 0
    assert "找不到實驗組" in proc.stderr


def test_run_rejects_manifest_with_only_test_split(tmp_path):
    manifest = tmp_path / "m.csv"
    manifest.write_text("image,truth,split\na.png,4710088410108,test\n", encoding="utf-8")
    runs = tmp_path / "runs"
    proc = subprocess.run(
        [sys.executable, str(E1 / "run.py"), "--manifest", str(manifest), "--out", str(runs)],
        capture_output=True,
        encoding="utf-8",
        check=False,
    )
    assert proc.returncode != 0
    assert "沒有可執行的影像" in proc.stderr
    assert not runs.exists()
