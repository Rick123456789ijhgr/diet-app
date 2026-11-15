"""以原始樣本為單位的 dev／test 切分（evaluation.splits）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from dietai.evaluation import read_manifest
from dietai.evaluation.splits import (
    apply_split,
    list_images,
    parse_fractions,
    plan_split,
    summarize,
    undo_split,
)

# 檢查碼正確的 EAN-13
CODES = [
    "4710088491374",
    "4710320224272",
    "9786267806746",
    "9786263781764",
    "9786263527843",
    "4713213147856",
    "4710088442185",
    "4710467011148",
    "4901340228825",
]


def _touch(folder: Path, names: list[str]) -> list[Path]:
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for n in names:
        p = folder / n
        p.write_bytes(b"x")
        paths.append(p)
    return paths


def _books(tmp_path: Path) -> list[Path]:
    """o_a01：6 種條碼，其中 9786263781764 拍了兩張。"""
    names = [f"o_a01_{i:03d}_{c}.jpg" for i, c in enumerate(CODES[2:8], start=1)]
    names.append("o_a01_007_9786263781764.jpg")
    return _touch(tmp_path / "incoming" / "o_a01", names)


def test_parse_fractions() -> None:
    assert parse_fractions("o_a01=0.5, f_a02=1") == {"o_a01": 0.5, "f_a02": 1.0}
    assert parse_fractions("") == {}
    for bad in ("o_a01", "o_a01=x", "o_a01=1.5", "o_a01=0.1,o_a01=0.2", "=0.5"):
        with pytest.raises(ValueError):
            parse_fractions(bad)


def test_same_code_goes_to_same_split(tmp_path: Path) -> None:
    paths = _books(tmp_path)
    for seed in range(20):
        plan = plan_split(paths, {"o_a01": 0.5}, seed=seed)
        dup = {a.split for a in plan if a.group == "9786263781764"}
        assert len(dup) == 1
        # 6 組取一半
        assert len({a.group for a in plan if a.split == "test"}) == 3


def test_unlisted_batch_is_all_dev(tmp_path: Path) -> None:
    books = _books(tmp_path)
    food = _touch(tmp_path / "incoming" / "f_a01", ["f_a01_001_4710088491374.jpg"])
    plan = plan_split([*books, *food], {"o_a01": 0.5})
    assert [a.split for a in plan if a.label == "f_a01"] == ["dev"]
    rows = summarize(plan)
    assert rows[0] == {"label": "f_a01", "dev": 1, "test": 0, "dev_groups": 1, "test_groups": 0}
    assert rows[1]["dev"] + rows[1]["test"] == 7


def test_split_is_independent_of_order(tmp_path: Path) -> None:
    paths = _books(tmp_path)
    a = {x.path.name: x.split for x in plan_split(paths, {"o_a01": 0.5}, seed=3)}
    b = {x.path.name: x.split for x in plan_split(paths[::-1], {"o_a01": 0.5}, seed=3)}
    assert a == b


def test_rejects_undecided_and_bad_names(tmp_path: Path) -> None:
    paths = _touch(tmp_path, ["o_a01_001.jpg", "IMG_0001.jpg", "o_a01_002_4710088491375.jpg"])
    with pytest.raises(ValueError) as e:
        plan_split(paths, {})
    msg = str(e.value)
    assert "o_a01_001.jpg" in msg and "IMG_0001.jpg" in msg and "4710088491375" in msg


def test_rejects_unknown_batch_and_conflicting_fraction(tmp_path: Path) -> None:
    books = _books(tmp_path)
    with pytest.raises(ValueError, match="沒有的批次"):
        plan_split(books, {"o_a1": 0.5})
    other = _touch(tmp_path / "x", ["o_a02_001_9786267806746.jpg"])
    with pytest.raises(ValueError, match="比例不同"):
        plan_split([*books, *other], {"o_a01": 0.5})
    # 比例相同就可以，且整組同一邊
    plan = plan_split([*books, *other], {"o_a01": 1.0, "o_a02": 1.0})
    assert {a.split for a in plan} == {"test"}


def test_negative_samples_are_own_groups(tmp_path: Path) -> None:
    paths = _touch(tmp_path, ["o_a01_001_nocode.jpg", "o_a01_002_nocode.jpg"])
    plan = plan_split(paths, {"o_a01": 0.5})
    assert sorted(a.split for a in plan) == ["dev", "test"]


def test_apply_moves_files_and_locks_test(tmp_path: Path) -> None:
    paths = _books(tmp_path)
    root = tmp_path / "e1"
    plan = plan_split(list_images([tmp_path / "incoming" / "o_a01"]), {"o_a01": 0.5})
    manifest = apply_split(root, plan)

    assert not any(p.exists() for p in paths)
    for a in plan:
        assert (root / "splits" / a.split / "o_a01" / a.path.name).is_file()
    dev = read_manifest(manifest)
    assert dev.excluded_test in (3, 4)  # 6 組取 3 組；重複的那組分到 test 時是 4 張
    assert {i.split for i in dev.items} == {"dev"}
    assert dev.tag_columns == ("category", "batch")
    full = read_manifest(manifest, include_test=True)
    assert len(full.items) == 7
    assert all(i.truth.isdigit() and i.image.is_file() for i in full.items)

    # 不覆寫：再切一次會被擋下
    with pytest.raises(FileExistsError):
        apply_split(root, plan)

    restored, problems = undo_split(root)
    assert (restored, problems) == (7, [])
    assert all(p.is_file() for p in paths)
    assert not manifest.exists() and not (root / "split_moves.csv").exists()


def test_apply_checks_before_moving(tmp_path: Path) -> None:
    paths = _books(tmp_path)
    root = tmp_path / "e1"
    plan = plan_split(paths, {})
    _touch(root / "splits" / "dev" / "o_a01", [paths[0].name])  # 目標已被占用
    with pytest.raises(FileExistsError, match="目標已存在"):
        apply_split(root, plan)
    assert all(p.is_file() for p in paths)  # 一個都沒搬
