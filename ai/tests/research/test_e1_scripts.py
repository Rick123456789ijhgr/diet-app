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

    report = _run("analyze.py", str(run_dir), "--by", "condition", "--primary", "a6_full")
    assert "依 `condition` 分組" in report
    assert "| a6_full（主要比較） |" in report
    assert (run_dir / "summary_source.csv").is_file()
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


def _fail(script: str, *args: str) -> str:
    """執行預期失敗的腳本：應以 p.error 結束（代碼 2、中文訊息），而不是印出 traceback。"""
    proc = subprocess.run(
        [sys.executable, str(E1 / script), *args],
        capture_output=True,
        encoding="utf-8",
        check=False,
    )
    assert proc.returncode == 2, proc.stderr
    assert "Traceback" not in proc.stderr
    return proc.stderr


def test_make_synthetic_rejects_zero_codes(tmp_path):
    assert "n_codes 至少為 1" in _fail("make_synthetic.py", "--out", str(tmp_path), "--codes", "0")


def test_analyze_reports_broken_run_json(tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "results.csv").write_text("id,arm,outcome\n1,a,correct\n", encoding="utf-8")
    (run_dir / "run.json").write_text("{bad", encoding="utf-8")
    assert "讀不到執行結果" in _fail("analyze.py", str(run_dir))
    (run_dir / "run.json").write_text('{"arms": []}', encoding="utf-8")  # 缺 manifest 鍵
    assert "格式不符" in _fail("analyze.py", str(run_dir))


def test_run_reports_tag_column_shadowing_result_column(tmp_path):
    manifest = tmp_path / "m.csv"
    manifest.write_text("image,truth,outcome\na.png,4710088410108,x\n", encoding="utf-8")
    stderr = _fail(
        "run.py", "--manifest", str(manifest), "--only", "a0_raw", "--out", str(tmp_path / "r")
    )
    assert "同名" in stderr


def test_e1_methods_end_to_end(tmp_path):
    data, runs = tmp_path / "data", tmp_path / "runs"
    _run("make_synthetic.py", "--out", str(data), "--codes", "1")
    out = _run(
        "run_methods.py",
        "--manifest",
        str(data / "manifest.csv"),
        "--only",
        "a6_full,p1_full_pyzbar",
        "--out",
        str(runs),
        "--label",
        "methods",
    )
    assert "完成" in out
    (run_dir,) = runs.iterdir()
    for name in ("methods.csv", "run.json", "summary.md"):
        assert (run_dir / name).is_file(), name
    summary = (run_dir / "summary.md").read_text(encoding="utf-8")
    assert "## 引擎比較（皆不做前處理）" in summary

    # 不指定資料夾時取最新一次 run_methods.py 的結果（這裡用 --out 以外的預設位置，故明確指定）
    report = _run(
        "analyze_methods.py",
        str(run_dir),
        "--by",
        "condition",
        "--max-new-wrong",
        "1",
        "--order",
        "short=raw,gray",
    )
    assert "## a6_full：貪婪選擇" in report and "- short：raw > gray" in report
    for name in ("methods_a6_full.csv", "greedy_a6_full.csv", "greedy_p1_full_pyzbar.csv"):
        assert (run_dir / name).is_file(), name


def test_analyze_methods_rejects_bad_order(tmp_path):
    proc = subprocess.run(
        [sys.executable, str(E1 / "analyze_methods.py"), str(tmp_path), "--order", "x"],
        capture_output=True,
        encoding="utf-8",
        check=False,
    )
    assert proc.returncode == 2


def test_make_variants_then_run_methods(tmp_path):
    # 以合成條碼的 clean 影像當「真實照片」，產生變體後接著跑每個方法都執行
    data = tmp_path / "data"
    _run("make_synthetic.py", "--out", str(data), "--codes", "2")
    sources = tmp_path / "sources.csv"
    lines = (data / "manifest.csv").read_text(encoding="utf-8").splitlines()
    clean = [ln for ln in lines[1:] if "_clean," in ln]
    rows = ["id,image,truth,split"]
    for i, ln in enumerate(clean):
        id_, image, truth, _ = ln.split(",")[:4]
        rows.append(f"{id_},{data / image},{truth},{'test' if i else 'dev'}")
    sources.write_text("\n".join(rows) + "\n", encoding="utf-8")

    out = _run(
        "make_variants.py",
        "--sources",
        str(sources),
        "--out",
        str(tmp_path / "variants"),
        "--conditions",
        "motion,jpeg",
    )
    assert "測試集已鎖定：排除 1 張原圖" in out and "9 張變體" in out
    runs = tmp_path / "runs"
    report = _run(
        "run_methods.py",
        "--manifest",
        str(tmp_path / "variants" / "manifest.csv"),
        "--only",
        "a0_raw",
        "--out",
        str(runs),
    )
    assert "9 張影像" in report
    (run_dir,) = runs.iterdir()
    summary = (run_dir / "summary.md").read_text(encoding="utf-8")
    # 依標籤分組不含 source_id、seed
    assert "依 `condition` 分組" in summary and "依 `source_id` 分組" not in summary
    # 輸出資料夾已存在時拒絕
    proc = subprocess.run(
        [
            sys.executable,
            str(E1 / "make_variants.py"),
            "--sources",
            str(sources),
            "--out",
            str(tmp_path / "variants"),
        ],
        capture_output=True,
        encoding="utf-8",
        check=False,
    )
    assert proc.returncode == 2 and "不覆寫" in proc.stderr


def test_adaptive_end_to_end(tmp_path):
    data, runs = tmp_path / "data", tmp_path / "runs"
    _run("make_synthetic.py", "--out", str(data), "--codes", "1")
    _run("run_methods.py", "--manifest", str(data / "manifest.csv"), "--out", str(runs))
    (run_dir,) = runs.iterdir()
    report = _run("adaptive.py", str(run_dir), "--tune", "--gate", "blur<100")
    assert "## 規則" in report and "## 門檻調整（dev）" in report and "`blur < 100`" in report
    assert "| greedy |" in report  # 預設以同一份結果貪婪選出的逐步升級為基準
    for name in (
        "features.csv",
        "adaptive_r0_default_tuned.csv",
        "feature_bins.csv",
        "summary_adaptive_r0_default_tuned.md",
        "policy_r0_default_tuned.json",
    ):
        assert (run_dir / name).is_file(), name
    # 沿用調整後的策略與已量測的品質，以凍結的順序比較
    tuned = run_dir / "policy_r0_default_tuned.json"
    again = _run("adaptive.py", str(run_dir), "--policy", str(tuned), "--order", "f=raw,deskew")
    assert "量測" not in again.splitlines()[0] and "| f |" in again
    assert "--gate" in _fail("adaptive.py", str(run_dir), "--gate", "blur<=1")
    assert "multiscale@9" in _fail("adaptive.py", str(run_dir), "--order", "x=raw,multiscale@9")
