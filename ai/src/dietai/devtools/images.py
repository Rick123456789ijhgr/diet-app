"""影像讀寫與資料來源防護。

本機路徑一律經過 test split 檢查（根目錄 CLAUDE.md 規則 7）：
工作台用於調整門檻與觀察行為，不得讀取 ``splits/test`` 中的資料。
判定規則與實驗腳本共用 ``dietai.evaluation.manifest.is_test_split``。
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from dietai.evaluation.manifest import SplitLockedError, is_test_split
from dietai.preprocess.types import Image

__all__ = [
    "IMAGE_SUFFIXES",
    "PathNotFoundError",
    "SplitLockedError",
    "decode_image",
    "encode_jpeg",
    "encode_png",
    "guard_path",
    "is_test_split",
    "list_images",
    "load_image",
]

IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"})


class PathNotFoundError(FileNotFoundError):
    """使用者指定的本機路徑不存在或不是預期的種類（回應 ``PATH_NOT_FOUND``）。

    與程式內部缺檔（設定檔遺失等）區分：後者仍以 ``INTERNAL`` 回報並記錄 traceback。
    """


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
        raise PathNotFoundError(f"找不到檔案：{resolved}")
    return decode_image(resolved.read_bytes())


def list_images(
    folder: str | Path, recursive: bool = False, limit: int | None = None
) -> list[Path]:
    """列出資料夾中的影像檔（依路徑排序），自動略過 test split 下的檔案。"""
    root = guard_path(folder)
    if not root.is_dir():
        raise PathNotFoundError(f"不是資料夾：{root}")
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


def encode_jpeg(img: Image, quality: int = 90) -> bytes:
    """編碼為 JPEG 位元組，供工作台顯示（比 PNG 快且小；需要逐像素一致時改用 PNG）。"""
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("JPEG 編碼失敗")
    return bytes(buf.tobytes())
