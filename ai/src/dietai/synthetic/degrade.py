"""已知程度的影像退化，用來產生測試資料與在工作台模擬拍攝條件。

每個函式都回傳新陣列、不修改輸入；有隨機性的函式接受 ``seed``。
"""

from __future__ import annotations

import cv2
import numpy as np

from dietai.preprocess.ops import validate_image
from dietai.preprocess.types import Image


def gaussian_blur(img: Image, sigma: float) -> Image:
    """高斯模糊；``sigma`` 為 0 時回傳副本。"""
    validate_image(img)
    if sigma <= 0:
        return img.copy()
    return np.asarray(cv2.GaussianBlur(img, (0, 0), sigmaX=sigma), dtype=np.uint8)


def scale_brightness(img: Image, gain: float) -> Image:
    """整體亮度乘上 ``gain``（<1 變暗、>1 變亮），超出範圍截斷。"""
    validate_image(img)
    return np.clip(img.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def brightness_gradient(img: Image, strength: float) -> Image:
    """由左到右的亮度梯度：左側乘 ``1 - strength``、右側乘 ``1 + strength``。"""
    validate_image(img)
    w = img.shape[1]
    ramp = np.linspace(1 - strength, 1 + strength, w, dtype=np.float32)
    shape = (1, w, 1) if img.ndim == 3 else (1, w)
    return np.clip(img.astype(np.float32) * ramp.reshape(shape), 0, 255).astype(np.uint8)


def gaussian_noise(img: Image, std: float, seed: int = 0) -> Image:
    """加上標準差為 ``std`` 的高斯雜訊。"""
    validate_image(img)
    if std <= 0:
        return img.copy()
    noise = np.random.default_rng(seed).normal(0, std, img.shape)
    return np.clip(img.astype(np.float64) + noise, 0, 255).astype(np.uint8)


def rotate(img: Image, degrees: float, border: int = 255) -> Image:
    """以中心逆時針旋轉，畫布擴大以保留整張影像，空白處填 ``border``。"""
    validate_image(img)
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    new_w, new_h = int(round(h * sin + w * cos)), int(round(h * cos + w * sin))
    m[0, 2] += new_w / 2 - w / 2
    m[1, 2] += new_h / 2 - h / 2
    value = (border, border, border) if img.ndim == 3 else border
    out = cv2.warpAffine(img, m, (new_w, new_h), borderValue=value)
    return np.asarray(out, dtype=np.uint8)


def downscale(img: Image, factor: float) -> Image:
    """等比縮小為原尺寸的 ``factor`` 倍（0 < factor ≤ 1）。"""
    validate_image(img)
    if not 0 < factor <= 1:
        raise ValueError(f"factor 必須介於 0 與 1，收到 {factor}")
    if factor == 1:
        return img.copy()
    h, w = img.shape[:2]
    size = (max(1, round(w * factor)), max(1, round(h * factor)))
    return np.asarray(cv2.resize(img, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def add_glare(img: Image, radius_ratio: float, seed: int = 0) -> Image:
    """加上一塊白色光斑；半徑為短邊的 ``radius_ratio`` 倍，邊緣柔化。"""
    validate_image(img)
    if radius_ratio <= 0:
        return img.copy()
    h, w = img.shape[:2]
    rng = np.random.default_rng(seed)
    r = radius_ratio * min(h, w)
    cx, cy = rng.uniform(r, max(r, w - r)), rng.uniform(r, max(r, h - r))
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    alpha = np.clip((r - dist) / (0.2 * r) + 1, 0, 1).astype(np.float32)
    if img.ndim == 3:
        alpha = alpha[..., None]
    out = img.astype(np.float32) * (1 - alpha) + 255 * alpha
    result: Image = np.clip(out, 0, 255).astype(np.uint8)
    return result
