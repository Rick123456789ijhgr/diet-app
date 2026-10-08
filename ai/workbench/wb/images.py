"""影像讀寫與資料來源防護。

本機路徑一律經過 test split 檢查（根目錄 CLAUDE.md 規則 7）：
工作台用於調整門檻與觀察行為，不得讀取 ``splits/test`` 中的資料。
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from dietai.preprocess.types import Image

IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"})


class SplitLockedError(ValueError):
    """嘗試讀取鎖定的測試集。"""


def is_test_split(path: str | Path) -> bool:
    """路徑中是否含有連續的 ``splits/test`` 目錄（不分大小寫）。"""
    parts = [p.lower() for p in Path(path).parts]
    return any(a == "splits" and b == "test" for a, b in zip(parts, parts[1:], strict=False))


def guard_path(path: str | Path) -> Path:
    """回傳解析後的路徑；屬於 test split 時丟 ``SplitLockedError``。"""
    resolved = Path(path).expanduser().resolve()
    if is_test_split(path) or is_test_split(resolved):
        raise SplitLockedError(f"測試集已鎖定，工作台不得讀取：{path}")
    return resolved


def decode_image(data: bytes) -> Image:
    """把影像檔位元組解碼為 BGR ``uint8``；無法解碼時丟 ``ValueError``。"""
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("無法解碼影像，請確認檔案格式")
    return np.asarray(img, dtype=np.uint8)


def load_image(path: str | Path) -> Image:
    """讀取本機影像（支援含中文的 Windows 路徑）。"""
    resolved = guard_path(path)
    if not resolved.is_file():
        raise FileNotFoundError(f"找不到檔案：{resolved}")
    return decode_image(resolved.read_bytes())


def list_images(
    folder: str | Path, recursive: bool = False, limit: int | None = None
) -> list[Path]:
    """列出資料夾中的影像檔（依路徑排序），自動略過 test split 下的檔案。"""
    root = guard_path(folder)
    if not root.is_dir():
        raise NotADirectoryError(f"不是資料夾：{root}")
    pattern = "**/*" if recursive else "*"
    found = sorted(
        p
        for p in root.glob(pattern)
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and not is_test_split(p)
    )
    return found[:limit] if limit is not None else found


def encode_png(img: Image) -> bytes:
    """編碼為 PNG 位元組，供下載。"""
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("PNG 編碼失敗")
    return bytes(buf.tobytes())
