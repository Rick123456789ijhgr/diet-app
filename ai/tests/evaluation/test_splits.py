"""以原始樣本為單位的 dev／test 切分（evaluation.splits）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from dietai.evaluation import read_manifest
from dietai.evaluation.splits import (
    apply_split,
    code_type,
    list_images,
    parse_fractions,
    plan_split,
    refresh_sources,
    select_sources,
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
    assert dev.tag_columns == ("category", "batch", "code_type")
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


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("4710088491374", "gtin"),
        ("2015922710171", "store"),  # 店內碼（EAN-13 開頭 2）
        ("0212345678903", "store"),  # UPC-A number system 2
        ("0012345678905", "gtin"),
        ("012345678905", "gtin"),  # 12 位 UPC-A
        ("20032906", "store"),  # EAN-8 開頭 2
        ("96385074", "gtin"),
        ("", "none"),
    ],
)
def test_code_type(code: str, expected: str) -> None:
    assert code_type(code) == expected


def test_refresh_rewrites_manifest_from_folders(tmp_path: Path) -> None:
    _books(tmp_path)
    root = tmp_path / "e1"
    plan = plan_split(list_images([tmp_path / "incoming" / "o_a01"]), {"o_a01": 0.5})
    manifest = apply_split(root, plan)
    before = manifest.read_bytes()
    manifest.write_text("id,image,truth\n", encoding="utf-8")  # 舊格式
    refresh_sources(root)
    assert manifest.read_bytes() == before
    # 檔案放錯資料夾會被擋下
    src = next((root / "splits" / "dev" / "o_a01").iterdir())
    (root / "splits" / "dev" / "f_a01").mkdir()
    src.rename(root / "splits" / "dev" / "f_a01" / src.name)
    with pytest.raises(ValueError, match="不符"):
        refresh_sources(root)


def test_select_sources_keeps_correct_dev_only(tmp_path: Path) -> None:
    _books(tmp_path)
    root = tmp_path / "e1"
    plan = plan_split(list_images([tmp_path / "incoming" / "o_a01"]), {"o_a01": 0.5})
    manifest = apply_split(root, plan)
    dev = [a.path.stem for a in plan if a.split == "dev"]
    test = [a.path.stem for a in plan if a.split == "test"]
    rows = [
        {"arm": "r0", "method": "raw", "source_id": dev[0], "outcome": "correct"},
        {"arm": "r0", "method": "raw", "source_id": dev[1], "outcome": "misread"},
        {"arm": "r1", "method": "raw", "source_id": dev[1], "outcome": "correct"},  # 別的實驗組
        {"arm": "r0", "method": "raw", "source_id": test[0], "outcome": "correct"},  # 測試集
    ]
    out = tmp_path / "other" / "variant_sources.csv"
    path, kept, total = select_sources(manifest, rows, out, arm="r0")
    assert (kept, total) == (1, len(dev))
    sel = read_manifest(path, include_test=True)
    assert [i.id for i in sel.items] == [dev[0]]
    assert sel.items[0].image.is_file()  # 相對路徑已改成相對新位置
    assert sel.tag_columns == ("category", "batch", "code_type")
    with pytest.raises(FileExistsError):
        select_sources(manifest, rows, out, arm="r0")


def test_select_sources_locks_test_path_and_strips_headers(tmp_path: Path) -> None:
    # split 欄被改成 dev、路徑仍在 splits/test 下的影像也要擋；手寫 CSV 的欄名前後有空白
    (tmp_path / "splits" / "test").mkdir(parents=True)
    (tmp_path / "splits" / "test" / "t.png").write_bytes(b"x")
    (tmp_path / "d.png").write_bytes(b"x")
    manifest = tmp_path / "sources.csv"
    manifest.write_text(
        " id, image, truth, split, batch\nt, splits/test/t.png, 1, dev, b\nd, d.png, 2, dev, b\n",
        encoding="utf-8",
    )
    rows = [{"arm": "r0", "method": "raw", "source_id": sid, "outcome": "correct"} for sid in "td"]
    path, kept, total = select_sources(manifest, rows, tmp_path / "o" / "v.csv", arm="r0")
    assert (kept, total) == (1, 1)
    sel = read_manifest(path)
    assert [(i.id, i.tags) for i in sel.items] == [("d", {"batch": "b"})]
    assert sel.items[0].image.is_file()


def test_undo_split_from_another_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 以相對路徑切分，再到別的目錄還原：搬移紀錄須為絕對路徑
    paths = _books(tmp_path)
    monkeypatch.chdir(tmp_path)
    plan = plan_split(list_images([Path("incoming") / "o_a01"]), {"o_a01": 0.5})
    apply_split(Path("e1"), plan)
    monkeypatch.chdir(tmp_path / "e1")
    restored, problems = undo_split(Path("."))
    assert (restored, problems) == (7, [])
    assert all(p.is_file() for p in paths)
