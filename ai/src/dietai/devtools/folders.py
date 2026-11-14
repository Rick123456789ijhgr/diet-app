"""工作台的資料夾瀏覽：列出某個資料夾底下的子資料夾與影像張數，給「瀏覽…」彈窗選路徑。

瀏覽器基於安全規定拿不到使用者選的資料夾在硬碟上的完整路徑，而批次、找最佳流程、
圖片批次命名都由本機的 Python 讀寫檔案，因此由這裡提供資料夾清單。

- ``path`` 空字串：列出起點（Windows 為各磁碟機，其他系統為 ``/``）。
- 只列資料夾名稱與直接位於其中的影像張數（``images.IMAGE_SUFFIXES``），不讀檔案內容。
- test split 的資料夾照列但標為 ``locked``（不計張數）；要進入時 ``guard_path`` 丟
  ``SplitLockedError``。名稱以 ``.`` 或 ``$`` 開頭的隱藏／系統資料夾、無權限讀取的資料夾略過。
"""

from __future__ import annotations

import os
import re
import string
from pathlib import Path
from typing import Any

from dietai.devtools.images import IMAGE_SUFFIXES, PathNotFoundError, guard_path
from dietai.evaluation.manifest import is_test_split

# 一個資料夾最多列幾個子資料夾；超過時截斷並標示 truncated
MAX_FOLDERS = 1000


def roots() -> list[Path]:
    """瀏覽的起點：Windows 為存在的磁碟機（``C:\\``、``D:\\``…），其他系統為 ``/``。"""
    if os.name != "nt":
        return [Path("/")]
    return [Path(f"{d}:\\") for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]


def _natural_key(name: str) -> list[Any]:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _count_images(folder: Path) -> int | None:
    """直接位於資料夾中的影像檔數；無法讀取時回傳 ``None``。"""
    try:
        with os.scandir(folder) as it:
            return sum(
                1
                for e in it
                if e.is_file(follow_symlinks=False)
                and os.path.splitext(e.name)[1].lower() in IMAGE_SUFFIXES
            )
    except OSError:
        return None


def _entry(folder: Path, name: str | None = None) -> dict[str, Any]:
    locked = is_test_split(folder)
    return {
        "name": name or str(folder),
        "path": str(folder),
        "images": None if locked else _count_images(folder),
        "locked": locked,
    }


def list_folders_json(path: str = "") -> dict[str, Any]:
    """列出 ``path`` 底下的子資料夾（自然排序）與 ``path`` 本身的影像張數。

    回傳 ``path``（解析後的絕對路徑；起點為空字串）、``parent``（上一層；已在磁碟機根目錄時
    為空字串＝回到起點；在起點時為 ``None``）、``folders``（``name``、``path``、``images``、
    ``locked``）、``images`` 與 ``truncated``。
    """
    if not path:
        return {
            "path": "",
            "parent": None,
            "folders": [_entry(r) for r in roots()],
            "images": 0,
            "truncated": False,
        }
    base = guard_path(path)
    if not base.is_dir():
        raise PathNotFoundError(f"找不到資料夾：{base}")
    try:
        with os.scandir(base) as it:
            names = [
                e.name
                for e in it
                if not e.name.startswith((".", "$")) and e.is_dir(follow_symlinks=False)
            ]
    except PermissionError as e:
        raise PathNotFoundError(f"沒有權限讀取資料夾：{base}") from e
    names.sort(key=_natural_key)
    truncated = len(names) > MAX_FOLDERS
    parent = base.parent
    return {
        "path": str(base),
        "parent": "" if parent == base else str(parent),
        "folders": [_entry(base / n, n) for n in names[:MAX_FOLDERS]],
        "images": _count_images(base) or 0,
        "truncated": truncated,
    }
