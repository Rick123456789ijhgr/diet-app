"""基本影像操作：無狀態純函式，不修改輸入陣列。

影像一律為 ``uint8`` 的 ``numpy.ndarray``：彩色為 BGR（OpenCV 慣例，形狀 ``(H, W, 3)``），
灰階為 2 維 ``(H, W)``。
"""

from __future__ import annotations

import cv2
import numpy as np
import numpy.typing as npt

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


def adaptive_threshold(img: Image, block_size: int, c: float) -> Image:
    """自適應二值化（高斯加權局部平均），回傳 0／255 的灰階影像。

    ``block_size`` 為鄰域邊長（奇數、≥ 3），``c`` 為從局部平均扣除的常數。
    彩色輸入先轉灰階。
    """
    if block_size < 3 or block_size % 2 == 0:
        raise ValueError(f"block_size 必須為 ≥ 3 的奇數，收到 {block_size}")
    gray = to_gray(img)
    out = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block_size, c
    )
    return np.asarray(out, dtype=np.uint8)


def rotation_matrix(
    shape: tuple[int, ...], degrees: float
) -> tuple[npt.NDArray[np.float64], tuple[int, int]]:
    """以影像中心逆時針旋轉 ``degrees`` 度、並擴大畫布保留整張影像的仿射矩陣。

    回傳（2×3 矩陣, (新寬, 新高)）。矩陣把原圖座標映射到旋轉後座標，
    可用 ``cv2.invertAffineTransform`` 把旋轉後找到的座標回推到原圖。
    """
    h, w = shape[:2]
    m = np.asarray(cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0), dtype=np.float64)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    new_w, new_h = int(round(h * sin + w * cos)), int(round(h * cos + w * sin))
    m[0, 2] += new_w / 2 - w / 2
    m[1, 2] += new_h / 2 - h / 2
    return m, (new_w, new_h)


def rotate(img: Image, degrees: float, border: int = 255) -> Image:
    """以中心逆時針旋轉，畫布擴大以保留整張影像，空白處填 ``border``。

    矩陣見 ``rotation_matrix``。
    """
    validate_image(img)
    m, size = rotation_matrix(img.shape, degrees)
    value = (border, border, border) if img.ndim == 3 else border
    out = cv2.warpAffine(img, m, size, flags=cv2.INTER_LINEAR, borderValue=value)
    return np.asarray(out, dtype=np.uint8)


def scale(img: Image, factor: float) -> Image:
    """等比縮放為 ``factor`` 倍（> 0）。縮小用 ``INTER_AREA``，放大用 ``INTER_CUBIC``。

    實際倍率因取整數像素可能略有差異；需要精確座標換算時以輸出尺寸計算。
    """
    validate_image(img)
    if factor <= 0:
        raise ValueError(f"factor 必須大於 0，收到 {factor}")
    if factor == 1:
        return img.copy()
    h, w = img.shape[:2]
    size = (max(1, round(w * factor)), max(1, round(h * factor)))
    interp = cv2.INTER_AREA if factor < 1 else cv2.INTER_CUBIC
    return np.asarray(cv2.resize(img, size, interpolation=interp), dtype=np.uint8)


def unsharp_mask(img: Image, sigma: float, amount: float) -> Image:
    """反銳化遮罩：``img + amount × (img − 高斯模糊(img, sigma))``，超出範圍截斷。"""
    validate_image(img)
    if sigma <= 0 or amount < 0:
        raise ValueError(f"須滿足 sigma > 0、amount ≥ 0，收到 sigma={sigma}、amount={amount}")
    blurred = cv2.GaussianBlur(img, (0, 0), sigmaX=sigma)
    out = cv2.addWeighted(img, 1 + amount, blurred, -amount, 0)
    return np.asarray(out, dtype=np.uint8)


def median_blur(img: Image, ksize: int) -> Image:
    """中值濾波（去除椒鹽雜訊），``ksize`` 為奇數、≥ 3。"""
    validate_image(img)
    if ksize < 3 or ksize % 2 == 0:
        raise ValueError(f"ksize 必須為 ≥ 3 的奇數，收到 {ksize}")
    return np.asarray(cv2.medianBlur(img, ksize), dtype=np.uint8)


def estimate_skew(img: Image) -> float:
    """估計影像主要紋理方向相對於「線條垂直」的傾斜角（度，範圍 (-90, 90]）。

    以梯度的結構張量求主梯度方向：一維條碼的線條垂直時主梯度為水平，回傳 0。
    回傳值與 ``rotate`` 的方向一致：影像內容被逆時針旋轉了 θ 度時回傳約 θ，
    因此 ``rotate(img, -estimate_skew(img))`` 可把線條轉回垂直。
    沒有明顯梯度（例如全白）時回傳 0。
    """
    gray = to_gray(img).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    sxx, syy, sxy = float((gx * gx).sum()), float((gy * gy).sum()), float((gx * gy).sum())
    if sxx + syy == 0:
        return 0.0
    # 影像 y 軸向下，主梯度角取負號才是一般的逆時針角度
    theta = -0.5 * np.degrees(np.arctan2(2 * sxy, sxx - syy))
    return float(theta + 180 if theta <= -90 else theta)
