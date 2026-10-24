from pathlib import Path

import numpy as np
import pytest

from dietai.evaluation import (
    SplitLockedError,
    is_test_split,
    read_image,
    read_manifest,
    write_image,
    write_manifest,
)


def _write(path: Path, text: str, bom: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(("﻿" if bom else "").encode() + text.encode("utf-8"))
    return path


def test_reads_columns_tags_and_resolves_paths(tmp_path):
    m = read_manifest(
        _write(
            tmp_path / "m.csv",
            "image,truth,lighting,角度\nimgs/a.png,0012345678905,暗,30\nb.png,,亮,0\n",
            bom=True,
        )
    )
    assert m.tag_columns == ("lighting", "角度")
    a, b = m.items
    assert a.id == "imgs/a.png"  # 省略 id 時用 image 原文
    assert a.image == (tmp_path / "imgs" / "a.png").resolve()
    assert a.truth == "0012345678905"  # 前導 0 不遺失
    assert a.tags == {"lighting": "暗", "角度": "30"}
    assert b.truth == "" and b.split == ""
    assert len(m.sha256) == 64


def test_test_split_rows_are_excluded_by_default(tmp_path):
    text = (
        "id,image,truth,split\n"
        "1,a.png,1,train\n"
        "2,b.png,2,TEST\n"
        "3,data/splits/test/c.png,3,\n"
        "4,d.png,4,dev\n"
    )
    path = _write(tmp_path / "m.csv", text)
    locked = read_manifest(path)
    assert [i.id for i in locked.items] == ["1", "4"]
    assert locked.excluded_test == 2
    full = read_manifest(path, include_test=True)
    assert len(full.items) == 4 and full.excluded_test == 0


def test_manifest_inside_test_split_is_locked(tmp_path):
    path = _write(tmp_path / "splits" / "test" / "m.csv", "image,truth\na.png,1\n")
    with pytest.raises(SplitLockedError):
        read_manifest(path)
    assert len(read_manifest(path, include_test=True).items) == 1


@pytest.mark.parametrize(
    ("text", "match"),
    [
        ("image,label\na.png,1\n", "缺少欄位"),
        ("id,image,truth\nx,a.png,1\nx,b.png,2\n", "重複"),
        ("image,truth\n,1\n", "image 為空"),
    ],
)
def test_invalid_manifest(tmp_path, text, match):
    with pytest.raises(ValueError, match=match):
        read_manifest(_write(tmp_path / "m.csv", text))


def test_write_then_read_roundtrip(tmp_path):
    rows = [
        {"id": "a", "image": "a.png", "truth": "4710088410108", "split": "dev", "cond": "blur"},
        {"id": "b", "image": "b.png", "truth": "", "split": "dev", "cond": "clean"},
    ]
    path = write_manifest(tmp_path / "sub" / "m.csv", rows, ("cond",))
    m = read_manifest(path)
    assert [(i.id, i.truth, i.tags["cond"]) for i in m.items] == [
        ("a", "4710088410108", "blur"),
        ("b", "", "clean"),
    ]


def test_write_manifest_rejects_unlisted_columns(tmp_path):
    rows = [{"image": "a.png", "truth": "1", "cond": "blur"}]
    path = tmp_path / "m.csv"
    with pytest.raises(ValueError, match="tag_columns"):
        write_manifest(path, rows)  # cond 未列在 tag_columns
    assert not path.exists()  # 開檔前就檢查，不留下寫到一半的檔案


def test_image_io_supports_non_ascii_paths(tmp_path):
    img = np.zeros((20, 30, 3), dtype=np.uint8)
    img[5:10, 5:20] = (10, 200, 30)
    path = write_image(tmp_path / "中文資料夾" / "影像.png", img)
    np.testing.assert_array_equal(read_image(path), img)


def test_read_image_errors(tmp_path):
    with pytest.raises(FileNotFoundError):
        read_image(tmp_path / "missing.png")
    with pytest.raises(ValueError):
        read_image(_write(tmp_path / "bad.png", "not an image"))
    with pytest.raises(ValueError, match="空"):
        read_image(_write(tmp_path / "empty.png", ""))


@pytest.mark.parametrize(
    ("path", "expected"),
    [("data/splits/test/a.png", True), ("data/Splits/TEST", True), ("data/test/a.png", False)],
)
def test_is_test_split(path, expected):
    assert is_test_split(path) is expected
