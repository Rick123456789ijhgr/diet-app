"""依找最佳流程的真值把原始照片改名（dietai.devtools.rename_by_truth 與 research 的命令列）。"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from dietai.devtools import rename_by_truth as rbt
from dietai.devtools.best_flow import MARKER
from dietai.devtools.images import SplitLockedError
from dietai.evaluation import write_manifest
from dietai.evaluation.best_flow import TruthSource, write_truth

A, B = "4710088410108", "4712612300015"
SCRIPT = Path(__file__).resolve().parents[3] / "research/experiments/e1_barcode/rename_by_truth.py"


def make_run(root: Path, source: str, images: dict[str, str], truths: dict) -> Path:
    """假的已完成執行：manifest（id → image）、truth.csv 與完成標記。"""
    run = root / "runs" / "20261110-000000_bestflow"
    rows = [{"id": i, "image": img, "split": "dev"} for i, img in images.items()]
    write_manifest(run / "inputs" / "manifest.csv", rows)
    write_truth(run, truths)
    (run / MARKER).write_text(json.dumps({"source": source}), encoding="utf-8")
    return run


def touch(folder: Path, *names: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for n in names:
        (folder / n).write_bytes(n.encode())


@pytest.fixture
def upload_run(tmp_path):
    """上傳來源：圖片 ID 為上傳時的檔名；照片在另一個資料夾。"""
    photos = tmp_path / "photos"
    touch(photos, "IMG_1.JPG", "IMG_2.jpg", "IMG_3.jpg", "IMG_4.jpg", f"{B}.jpg")
    ids = [
        "IMG_1.JPG",
        "IMG_2.jpg",
        "IMG_3.jpg",
        "IMG_4.jpg",
        "gone.jpg",
        f"{B}.jpg",
        "IMG_1.JPG#2",
    ]
    m, a = TruthSource.MANUAL, TruthSource.AUTO
    truths = {
        "IMG_1.JPG": (A, m),
        "IMG_2.jpg": (A, a),
        "IMG_3.jpg": ("", m),
        "gone.jpg": (A, m),
        f"{B}.jpg": (B, a),
        "IMG_1.JPG#2": (A, m),
    }
    images = {i: f"images/{n:03d}.png" for n, i in enumerate(ids, start=1)}
    return make_run(tmp_path, "upload", images, truths), photos


def test_plan_for_an_upload_run(upload_run):
    run, photos = upload_run
    by_id = {r.id: r for r in rbt.plan(str(run), photos, include_auto=True)}
    assert by_id["IMG_1.JPG"].dst == photos / f"{A}.jpg"  # 副檔名改小寫
    assert by_id["IMG_2.jpg"].dst == photos / f"{A}_2.jpg"  # 同號碼第二張加序號
    assert by_id["IMG_3.jpg"].dst == photos / "沒有條碼_IMG_3.jpg"
    assert by_id["IMG_4.jpg"].status == "undecided"
    assert by_id["gone.jpg"].status == "missing"
    assert by_id[f"{B}.jpg"].status == "same"
    assert by_id["IMG_1.JPG#2"].status == "ambiguous"
    # 預覽不動任何檔案
    assert (photos / "IMG_1.JPG").is_file()


def test_inferred_truths_are_skipped_by_default(upload_run):
    run, photos = upload_run
    by_id = {r.id: r for r in rbt.plan(str(run), photos)}
    assert by_id["IMG_2.jpg"].status == "undecided"
    assert by_id[f"{B}.jpg"].status == "undecided"
    assert by_id["IMG_1.JPG"].status == "rename"


def test_apply_then_undo(upload_run):
    run, photos = upload_run
    before = sorted(p.name for p in photos.iterdir())
    assert rbt.apply(str(run), rbt.plan(str(run), photos, include_auto=True)) == 3
    after = sorted(p.name for p in photos.iterdir())
    assert after == sorted(
        [f"{A}.jpg", f"{A}_2.jpg", "沒有條碼_IMG_3.jpg", "IMG_4.jpg", f"{B}.jpg"]
    )
    assert (photos / f"{A}.jpg").read_bytes() == b"IMG_1.JPG"
    # 再規劃一次：已改好的都是「已正確」
    again = {r.id: r.status for r in rbt.plan(str(run), photos, include_auto=True)}
    assert again["IMG_1.JPG"] == "missing"  # 原檔名已不存在
    assert rbt.undo(str(run)) == (3, [])
    assert sorted(p.name for p in photos.iterdir()) == before
    assert rbt.undo(str(run)) == (0, [])


def test_never_overwrites_existing_files(tmp_path):
    """資料夾來源：直接改原檔；目標檔名已被占用時加序號。"""
    photos = tmp_path / "photos"
    touch(photos, "x.jpg", f"{A}.jpg")
    run = make_run(
        tmp_path,
        str(photos),
        {"x.jpg": str(photos / "x.jpg"), "other": str(photos / f"{A}.jpg")},
        {"x.jpg": (A, TruthSource.MANUAL)},
    )
    (r, undecided) = rbt.plan(str(run))
    assert r.dst == photos / f"{A}_2.jpg"
    assert undecided.status == "undecided"
    assert rbt.apply(str(run), [r]) == 1
    assert (photos / f"{A}.jpg").read_bytes() == f"{A}.jpg".encode()


def test_upload_run_requires_a_folder(upload_run):
    run, _ = upload_run
    with pytest.raises(ValueError, match="--folder"):
        rbt.plan(str(run))


def test_test_split_is_locked(upload_run, tmp_path):
    run, _ = upload_run
    locked = tmp_path / "data" / "splits" / "test"
    locked.mkdir(parents=True)
    with pytest.raises(SplitLockedError):
        rbt.plan(str(run), locked)


@pytest.mark.parametrize(
    ("name", "code"),
    [
        (f"{A}.jpg", A),
        (f"{A}_2.png", A),
        ("036000291452 (1).jpg", "0036000291452"),
        ("沒有條碼_IMG_1.jpg", ""),
        ("4710088410109.jpg", None),
        ("IMG_1.jpg", None),
    ],
)
def test_code_from_name(name, code):
    assert rbt.code_from_name(name) == code


def test_command_line_preview_apply_undo(upload_run):
    run, photos = upload_run

    def cli(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(run), *args],
            capture_output=True,
            encoding="utf-8",
            check=False,
        )

    preview = cli("--folder", str(photos), "--include-auto")
    assert preview.returncode == 0, preview.stderr
    assert "3 個檔案會改名" in preview.stdout
    assert (photos / "IMG_1.JPG").is_file()
    done = cli("--folder", str(photos), "--include-auto", "--apply")
    assert done.returncode == 0, done.stderr
    assert (photos / f"{A}.jpg").is_file()
    assert cli("--undo").returncode == 0
    assert (photos / "IMG_1.JPG").is_file()
    missing = cli()
    assert missing.returncode == 2
    assert "--folder" in missing.stderr
