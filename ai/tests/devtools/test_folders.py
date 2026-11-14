"""資料夾瀏覽（devtools.folders）：子資料夾、影像張數、測試集鎖定。"""

import os

import pytest

from dietai.devtools import folders
from dietai.devtools.images import PathNotFoundError, SplitLockedError


def touch(folder, *names):
    folder.mkdir(parents=True, exist_ok=True)
    for n in names:
        (folder / n).write_bytes(b"x")


def test_lists_subfolders_with_image_counts(tmp_path):
    touch(tmp_path, "a.jpg", "b.PNG", "notes.txt")
    touch(tmp_path / "food", "1.jpg", "2.jpg")
    touch(tmp_path / "img10")
    touch(tmp_path / "img2", "x.webp")
    touch(tmp_path / ".git")
    touch(tmp_path / "$RECYCLE.BIN")
    out = folders.list_folders_json(str(tmp_path))
    assert out["path"] == str(tmp_path.resolve())
    assert out["parent"] == str(tmp_path.resolve().parent)
    assert out["images"] == 2
    assert out["truncated"] is False
    # 自然排序；隱藏與系統資料夾略過；檔案不列
    assert [(f["name"], f["images"], f["locked"]) for f in out["folders"]] == [
        ("food", 2, False),
        ("img2", 1, False),
        ("img10", 0, False),
    ]
    assert out["folders"][0]["path"] == str(tmp_path.resolve() / "food")


def test_test_split_is_listed_as_locked_but_cannot_be_opened(tmp_path):
    touch(tmp_path / "data" / "splits" / "test", "a.jpg")
    touch(tmp_path / "data" / "splits" / "dev", "a.jpg")
    out = folders.list_folders_json(str(tmp_path / "data" / "splits"))
    assert [(f["name"], f["images"], f["locked"]) for f in out["folders"]] == [
        ("dev", 1, False),
        ("test", None, True),
    ]
    with pytest.raises(SplitLockedError):
        folders.list_folders_json(str(tmp_path / "data" / "splits" / "test"))


def test_roots_and_drive_root_parent():
    start = folders.list_folders_json("")
    assert start["path"] == "" and start["parent"] is None
    assert start["folders"], "至少要有一個起點"
    root = start["folders"][0]["path"]
    # 在磁碟機根目錄時，上一層回到起點
    assert folders.list_folders_json(root)["parent"] == ""


def test_missing_folder(tmp_path):
    with pytest.raises(PathNotFoundError):
        folders.list_folders_json(str(tmp_path / "nope"))
    (tmp_path / "file.jpg").write_bytes(b"x")
    with pytest.raises(PathNotFoundError):
        folders.list_folders_json(str(tmp_path / "file.jpg"))


def test_truncates_long_listings(tmp_path, monkeypatch):
    monkeypatch.setattr(folders, "MAX_FOLDERS", 2)
    for n in ("a", "b", "c"):
        os.mkdir(tmp_path / n)
    out = folders.list_folders_json(str(tmp_path))
    assert [f["name"] for f in out["folders"]] == ["a", "b"]
    assert out["truncated"] is True
