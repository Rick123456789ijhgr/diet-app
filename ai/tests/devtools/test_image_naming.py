"""實驗圖片的命名規則與批次命名工具（evaluation.image_names、devtools.image_naming、命令列）。"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from dietai.devtools import image_naming as naming
from dietai.devtools import rename_by_truth as rbt
from dietai.devtools.best_flow import names_truth
from dietai.devtools.scenes import SceneError
from dietai.evaluation import ManifestItem
from dietai.evaluation.image_names import ImageName, parse_name, truth_from_name

A, B = "4710088410108", "4712612300015"
UPC = "036000291452"  # UPC-A，補成 13 位為 0036000291452
EAN8 = "96385074"
SCRIPT = Path(__file__).resolve().parents[3] / "research/experiments/e1_barcode/name_images.py"


def touch(folder: Path, *names: str, mtime: dict[str, int] | None = None) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for n in names:
        (folder / n).write_bytes(n.encode())
    for n, t in (mtime or {}).items():
        os.utime(folder / n, (t, t))


def names(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.iterdir() if p.suffix != ".csv")


# ── 命名規則 ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("food_b01_001.jpg", ImageName("food", "b01", 1, 3, None)),
        (f"food_b01_001_{A}.JPG", ImageName("food", "b01", 1, 3, A)),
        ("other_b02_0015_nocode.png", ImageName("other", "b02", 15, 4, "")),
        (
            f"dir/snack-bar_2026-11_123_{UPC}.jpg",
            ImageName("snack-bar", "2026-11", 123, 3, "0" + UPC),
        ),
        (f"food_b01_001_{EAN8}.jpg", ImageName("food", "b01", 1, 3, EAN8)),
    ],
)
def test_parse_name(name, expected):
    assert parse_name(name) == expected


@pytest.mark.parametrize(
    "name",
    [
        "IMG_20261101_123456.jpg",
        "Food_b01_001.jpg",  # 大寫
        "food_b01_01.jpg",  # 序號太短
        "food_b01_001_4710088410109.jpg",  # 檢查碼錯
        "food_b01_001_12345.jpg",
        "food__001.jpg",
        f"{A}.jpg",
    ],
)
def test_parse_name_rejects(name):
    assert parse_name(name) is None


def test_format_round_trip():
    n = ImageName("food", "b01", 7)
    assert n.filename(".JPG") == "food_b01_007.jpg"
    assert n.with_code(A).filename(".jpg") == f"food_b01_007_{A}.jpg"
    assert n.with_code("").stem() == "food_b01_007_nocode"
    assert parse_name(n.with_code(A).filename(".jpg")) == n.with_code(A)


def test_truth_from_name():
    assert truth_from_name(f"food_b01_001_{A}.jpg") == A
    assert truth_from_name("food_b01_001_nocode.jpg") == ""
    assert truth_from_name("food_b01_001.jpg") is None
    assert truth_from_name(f"{A}.jpg") is None  # 舊式檔名仍要人確認


def test_names_truth_from_manifest_ids():
    def item(i: str) -> ManifestItem:
        return ManifestItem(id=i, image=Path("x"), truth="", split="dev", tags={})

    ids = [
        f"food_b01_001_{A}.jpg",
        "sub/food_b01_002_nocode.jpg",
        f"food_b01_001_{A}.jpg#2",
        "food_b01_003.jpg",
        "IMG_1.jpg",
    ]
    got = names_truth([item(i) for i in ids])
    assert {k: v[0] for k, v in got.items()} == {
        f"food_b01_001_{A}.jpg": A,
        "sub/food_b01_002_nocode.jpg": "",
        f"food_b01_001_{A}.jpg#2": A,
    }
    assert all(v[1] == "manual" for v in got.values())


def test_rename_by_truth_keeps_scheme():
    assert rbt._target_name("food_b01_001.jpg", A) == f"food_b01_001_{A}.jpg"
    assert rbt._target_name("food_b01_001.JPG", "") == "food_b01_001_nocode.jpg"
    assert rbt.code_from_name(f"food_b01_001_{A}.jpg") == A
    assert rbt.code_from_name("food_b01_001_nocode.jpg") == ""


# ── 批次命名 ──────────────────────────────────────────────


def test_plan_keeps_codes_and_orders_by_mtime(tmp_path):
    touch(
        tmp_path,
        f"{A}.jpg",
        f"{A}_2.JPG",
        f"{UPC} (1).jpg",
        "沒有條碼_IMG_9.jpg",
        "IMG_5.jpg",
        mtime={
            f"{A}.jpg": 300,
            f"{A}_2.JPG": 100,
            f"{UPC} (1).jpg": 200,
            "沒有條碼_IMG_9.jpg": 400,
        },
    )
    planned = naming.plan(tmp_path, "food", "b01")
    assert [(p.src.name, p.dst.name) for p in planned if p.status == "rename"] == [
        (f"{A}_2.JPG", f"food_b01_001_{A}.jpg"),
        (f"{UPC} (1).jpg", f"food_b01_002_0{UPC}.jpg"),
        (f"{A}.jpg", f"food_b01_003_{A}.jpg"),
        ("沒有條碼_IMG_9.jpg", "food_b01_004_nocode.jpg"),
    ]
    skipped = [(p.src.name, p.note) for p in planned if p.status == "skip"]
    assert skipped == [("IMG_5.jpg", "檔名看不出條碼")]
    assert f"{A}.jpg" in names(tmp_path)  # 預覽不動檔案


def test_plan_continues_numbering_and_skips_other_batches(tmp_path):
    touch(tmp_path, f"food_b01_001_{A}.jpg", f"food_b01_003_{B}.jpg", f"other_b02_001_{A}.jpg")
    touch(tmp_path, f"{B}.jpg", "IMG_5.jpg", mtime={f"{B}.jpg": 1, "IMG_5.jpg": 2})
    planned = naming.plan(tmp_path, "food", "b01", include_unknown=True)
    status = {p.src.name: (p.status, p.dst.name if p.dst else None) for p in planned}
    assert status[f"food_b01_001_{A}.jpg"][0] == "same"
    assert status[f"other_b02_001_{A}.jpg"] == ("skip", None)
    assert status[f"{B}.jpg"] == ("rename", f"food_b01_004_{B}.jpg")
    assert status["IMG_5.jpg"] == ("rename", "food_b01_005.jpg")


def test_plan_by_name_start_and_width(tmp_path):
    touch(tmp_path, f"{B}.jpg", f"{A}.jpg")
    planned = naming.plan(tmp_path, "other", "b02", order="name", start=50, width=4)
    assert [p.dst.name for p in planned] == [f"other_b02_0050_{A}.jpg", f"other_b02_0051_{B}.jpg"]


@pytest.mark.parametrize(
    ("category", "batch", "kwargs", "match"),
    [
        ("Food", "b01", {}, "類別"),
        ("food", "b_01", {}, "批次"),
        ("food", "b01", {"width": 2}, "位數"),
        ("food", "b01", {"start": 999}, "序號超過"),
    ],
)
def test_plan_rejects_bad_arguments(tmp_path, category, batch, kwargs, match):
    touch(tmp_path, f"{A}.jpg", f"{B}.jpg")
    with pytest.raises(ValueError, match=match):
        naming.plan(tmp_path, category, batch, **kwargs)


def test_apply_and_undo(tmp_path):
    touch(tmp_path, f"{A}.jpg", "沒有條碼_IMG_1.jpg", mtime={f"{A}.jpg": 1})
    assert naming.apply(tmp_path, naming.plan(tmp_path, "food", "b01")) == 2
    assert names(tmp_path) == [f"food_b01_001_{A}.jpg", "food_b01_002_nocode.jpg"]
    # 再跑一次：全部不變
    assert {p.status for p in naming.plan(tmp_path, "food", "b01")} == {"same"}
    assert naming.undo(tmp_path) == (2, [])
    assert names(tmp_path) == [f"{A}.jpg", "沒有條碼_IMG_1.jpg"]


def test_test_split_is_locked(tmp_path):
    locked = tmp_path / "data" / "splits" / "test"
    touch(locked, f"{A}.jpg")
    with pytest.raises(Exception, match="test"):
        naming.plan(locked, "food", "b01")


# ── 命令列 ────────────────────────────────────────────────


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def test_cli_preview_apply_undo(tmp_path):
    touch(tmp_path, f"{A}.jpg", f"{B}.jpg", mtime={f"{A}.jpg": 1, f"{B}.jpg": 2})
    base = [str(tmp_path), "--category", "food", "--batch", "b01"]
    r = run_cli(*base)
    assert r.returncode == 0, r.stderr
    assert f"{A}.jpg  →  food_b01_001_{A}.jpg" in r.stdout
    assert names(tmp_path) == [f"{A}.jpg", f"{B}.jpg"]

    r = run_cli(*base, "--apply")
    assert r.returncode == 0, r.stdout + r.stderr
    assert names(tmp_path) == [f"food_b01_001_{A}.jpg", f"food_b01_002_{B}.jpg"]

    r = run_cli(str(tmp_path), "--undo")
    assert r.returncode == 0 and "已還原 2 個檔案" in r.stdout
    assert names(tmp_path) == [f"{A}.jpg", f"{B}.jpg"]


@pytest.mark.parametrize(
    ("args", "message"),
    [
        (["--category", "Food", "--batch", "b01"], "類別"),
        (["--category", "food"], "--batch"),
    ],
)
def test_cli_usage_errors(tmp_path, args, message):
    touch(tmp_path, f"{A}.jpg")
    r = run_cli(str(tmp_path), *args)
    assert r.returncode == 2 and message in r.stderr


# ── 自訂標記與工作台 JSON ─────────────────────────────────


def test_single_letter_category_and_custom_no_code(tmp_path):
    touch(
        tmp_path, f"{A}.jpg", "沒有條碼_IMG_1.jpg", mtime={f"{A}.jpg": 1, "沒有條碼_IMG_1.jpg": 2}
    )
    planned = naming.plan(tmp_path, "o", "a01", start=7, no_code="xxxxxxxxxxxxx")
    assert [p.dst.name for p in planned] == [f"o_a01_007_{A}.jpg", "o_a01_008_xxxxxxxxxxxxx.jpg"]
    # 任何全為小寫字母的條碼欄都表示沒有條碼
    assert truth_from_name("o_a01_008_xxxxxxxxxxxxx.jpg") == ""
    assert truth_from_name("o_a01_008_none.jpg") == ""


@pytest.mark.parametrize(
    ("kwargs", "field"),
    [
        ({"category": "F"}, "category"),
        ({"batch": "a 01"}, "batch"),
        ({"no_code": "no-code"}, "no_code"),
        ({"width": 9}, "width"),
        ({"start": -1}, "start"),
    ],
)
def test_plan_errors_carry_the_field(tmp_path, kwargs, field):
    touch(tmp_path, f"{A}.jpg")
    args = {"category": "f", "batch": "a01", **kwargs}
    with pytest.raises(SceneError) as e:
        naming.plan_json(str(tmp_path), **args)
    assert e.value.field == field


def test_json_preview_apply_undo(tmp_path):
    touch(tmp_path, f"{A}.jpg", EAN8 + ".jpg", "IMG_1.jpg", mtime={f"{A}.jpg": 1})
    preview = naming.plan_json(str(tmp_path), category="f", batch="a01")
    assert preview["categories"]["f"] == "食物包裝"
    assert preview["counts"] == {"rename": 2, "same": 0, "skip": 1}
    assert preview["stem_lengths"] == [18, 23]  # EAN-8 比 EAN-13 短，介面提示長度不一致
    assert preview["can_undo"] is False
    assert {i["src"]: i["dst"] for i in preview["items"]}[f"{A}.jpg"] == f"f_a01_001_{A}.jpg"

    done = naming.apply_json(str(tmp_path), category="f", batch="a01")
    assert done["renamed"] == 2
    assert done["counts"] == {"rename": 0, "same": 2, "skip": 1}
    assert done["can_undo"] is True

    assert naming.undo_json(str(tmp_path)) == {"restored": 2, "problems": []}
    assert naming.plan_json(str(tmp_path), category="f", batch="a01")["can_undo"] is False
