"""基本影像操作：無狀態純函式，不修改輸入陣列。

影像一律為 ``uint8`` 的 ``numpy.ndarray``：彩色為 BGR（OpenCV 慣例，形狀 ``(H, W, 3)``），
灰階為 2 維 ``(H, W)``。
"""

from __future__ import annotations

import cv2
import numpy as np

from dietai.preprocess.types import Image


def validate_image(img: object) -> None:
    """檢查影像格式，不符時丟 ``ValueError``。

    接受 ``uint8`` 的 2 維灰階或 ``(H, W, 3)`` BGR 影像，且寬高皆大於 0。
    """
    if not isinstance(img, np.ndarray):
        raise ValueError(f"影像必須是 numpy.ndarray，收到 {type(img).__name__}")
    if img.dtype != np.uint8:
        raise ValueError(f"影像 dtype 必須是 uint8，收到 {img.dtype}")
    if img.ndim == 3:
        if img.shape[2] != 3:
            raise ValueError(f"彩色影像必須是 3 通道 BGR，收到形狀 {img.shape}")
    elif img.ndim != 2:
        raise ValueError(f"影像必須是 2 維灰階或 3 維 BGR，收到形狀 {img.shape}")
    if img.shape[0] == 0 or img.shape[1] == 0:
        raise ValueError(f"影像寬高必須大於 0，收到形狀 {img.shape}")


def to_gray(img: Image) -> Image:
    """BGR 轉灰階；已是灰階則回傳副本。"""
    validate_image(img)
    if img.ndim == 2:
        return img.copy()
    return np.asarray(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), dtype=np.uint8)


def resize_short_side(img: Image, short_side: int) -> Image:
    """等比縮放，使短邊等於 ``short_side``（放大或縮小皆可）。

    縮小用 ``INTER_AREA``，放大用 ``INTER_LINEAR``。永遠回傳新陣列。
    """
    validate_image(img)
    if short_side <= 0:
        raise ValueError(f"short_side 必須為正整數，收到 {short_side}")
    h, w = img.shape[:2]
    current = min(h, w)
    if current == short_side:
        return img.copy()
    scale = short_side / current
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
    return np.asarray(cv2.resize(img, size, interpolation=interp), dtype=np.uint8)
