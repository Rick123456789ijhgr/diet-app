"""影像讀寫與資料來源防護。

本機路徑一律經過 test split 檢查（根目錄 CLAUDE.md 規則 7）：
工作台用於調整門檻與觀察行為，不得讀取 ``splits/test`` 中的資料。
判定規則與實驗腳本共用 ``dietai.evaluation.manifest.is_test_split``。

格式限制：列資料夾時只收 ``IMAGE_SUFFIXES`` 中的副檔名；解碼一律經 ``decode_image``，
無法解碼的檔案丟 ``ValueError``。本模組不檢查檔案大小或像素數（見 ``decode_image``）。
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

# 列資料夾時依副檔名（不分大小寫）篩選；實際能否讀取仍以 cv2.imdecode 為準
IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"})


class PathNotFoundError(FileNotFoundError):
    """使用者指定的本機路徑不存在或不是預期的種類（回應 ``PATH_NOT_FOUND``）。

    與程式內部缺檔（設定檔遺失等）區分：後者仍以 ``INTERNAL`` 回報並記錄 traceback。
    """


def guard_path(path: str | Path) -> Path:
    """回傳解析後的路徑；屬於 test split 時丟 ``SplitLockedError``。"""
    resolved = Path(path).expanduser().resolve()
    # 原始字串與解析後的路徑都檢查：解析後的路徑擋下以相對路徑、``..`` 或符號連結
    # 繞進測試集；原始字串則連「字面上經過 splits/test」的請求也保守地擋下
    if is_test_split(path) or is_test_split(resolved):
        raise SplitLockedError(f"測試集已鎖定，工作台不得讀取：{path}")
    return resolved


def decode_image(data: bytes) -> Image:
    """把影像檔位元組解碼為 BGR ``uint8``；無法解碼時丟 ``ValueError``。

    ``IMREAD_COLOR`` 一律輸出 3 通道（灰階擴成三通道、透明通道捨棄），後續前處理只需
    處理一種格式。這裡不限制位元組數或像素數；上傳的檔案大小由 gRPC 訊息上限
    （``server/app.py`` 的 ``MAX_MESSAGE_BYTES``）與 Go 端的上傳上限把關。
    """
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("無法解碼影像，請確認檔案格式")
    return np.asarray(img, dtype=np.uint8)


def load_image(path: str | Path) -> Image:
    """讀取本機影像（支援含中文的 Windows 路徑）。

    ``cv2.imread`` 在 Windows 上無法開啟非 ASCII 路徑，因此先以 Python 讀成位元組再解碼。
    檔案不存在時丟 ``PathNotFoundError``（回應 ``PATH_NOT_FOUND``）。
    """
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
    # 遞迴時資料夾底下可能有 splits/test，逐檔再檢查一次。先排序再截斷，
    # 同一資料夾每次取到的前 limit 張相同，結果可重現
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
