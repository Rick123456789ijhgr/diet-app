"""基本影像操作：無狀態純函式，不修改輸入陣列。

影像一律為 ``uint8`` 的 ``numpy.ndarray``：彩色為 BGR（OpenCV 慣例，形狀 ``(H, W, 3)``），
灰階為 2 維 ``(H, W)``。
"""

from __future__ import annotations

import cv2
import numpy as np
import numpy.typing as npt

from dietai.preprocess.types import Image, Quad


class InvalidImageError(ValueError):
    """影像格式不符（``validate_image``）。

    屬呼叫端的輸入問題，gRPC 外殼對應為 ``INVALID_ARGUMENT``。
    """


def validate_image(img: object) -> None:
    """檢查影像格式，不符時丟 ``InvalidImageError``（``ValueError`` 的子類別）。

    接受 ``uint8`` 的 2 維灰階或 ``(H, W, 3)`` BGR 影像，且寬高皆大於 0。
    """
    if not isinstance(img, np.ndarray):
        raise InvalidImageError(f"影像必須是 numpy.ndarray，收到 {type(img).__name__}")
    if img.dtype != np.uint8:
        raise InvalidImageError(f"影像 dtype 必須是 uint8，收到 {img.dtype}")
    if img.ndim == 3:
        if img.shape[2] != 3:
            raise InvalidImageError(f"彩色影像必須是 3 通道 BGR，收到形狀 {img.shape}")
    elif img.ndim != 2:
        raise InvalidImageError(f"影像必須是 2 維灰階或 3 維 BGR，收到形狀 {img.shape}")
    if img.shape[0] == 0 or img.shape[1] == 0:
        raise InvalidImageError(f"影像寬高必須大於 0，收到形狀 {img.shape}")


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
    # cv2.resize 的尺寸參數為 (寬, 高)；長邊四捨五入，至少 1 像素
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    # INTER_AREA 縮小時以面積平均取樣，可避免疊頻（摩爾紋）；放大時效果近似最近鄰，
    # 故改用 INTER_LINEAR
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
    # 每個像素與其 block_size × block_size 鄰域的高斯加權平均減 c 比較：
    # 大於者設為 255（THRESH_BINARY），否則為 0；局部門檻可承受光照不均
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
    # getRotationMatrix2D：正角度為逆時針，縮放倍率 1.0
    m = np.asarray(cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0), dtype=np.float64)
    # 縮放為 1 時 m[0, 0] = cos θ、m[0, 1] = sin θ；取絕對值以涵蓋任意象限的角度
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    # 旋轉後矩形的外接框尺寸
    new_w, new_h = int(round(h * sin + w * cos)), int(round(h * cos + w * sin))
    # 平移量加上新舊畫布中心的差，使旋轉後的影像置中於擴大的畫布
    m[0, 2] += new_w / 2 - w / 2
    m[1, 2] += new_h / 2 - h / 2
    return m, (new_w, new_h)


def rotate(img: Image, degrees: float, border: int = 255) -> Image:
    """以中心逆時針旋轉，畫布擴大以保留整張影像，空白處填 ``border``。

    矩陣見 ``rotation_matrix``。
    """
    validate_image(img)
    m, size = rotation_matrix(img.shape, degrees)
    # 彩色影像的 borderValue 需給三個通道的值；預設 255 為白色，接近紙張／包裝背景
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
    # 放大用 INTER_CUBIC（比 INTER_LINEAR 保留更銳利的邊緣，代價是較慢）
    interp = cv2.INTER_AREA if factor < 1 else cv2.INTER_CUBIC
    return np.asarray(cv2.resize(img, size, interpolation=interp), dtype=np.uint8)


def unsharp_mask(img: Image, sigma: float, amount: float) -> Image:
    """反銳化遮罩：``img + amount × (img − 高斯模糊(img, sigma))``，超出範圍截斷。"""
    validate_image(img)
    if sigma <= 0 or amount < 0:
        raise ValueError(f"須滿足 sigma > 0、amount ≥ 0，收到 sigma={sigma}、amount={amount}")
    # 核心大小 (0, 0) 表示由 sigma 自動推算
    blurred = cv2.GaussianBlur(img, (0, 0), sigmaX=sigma)
    # (1 + amount)·img − amount·blurred 即上式展開；uint8 輸入時 addWeighted 會飽和截斷到 0–255
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
    # 3×3 Sobel 求 x、y 方向梯度；用 float32 輸出保留負值
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    # 全圖加總的結構張量 [[sxx, sxy], [sxy, syy]]
    sxx, syy, sxy = float((gx * gx).sum()), float((gy * gy).sum()), float((gx * gy).sum())
    # 完全沒有梯度（均勻影像）時方向無定義
    if sxx + syy == 0:
        return 0.0
    # 結構張量主特徵向量的角度為 0.5·atan2(2·sxy, sxx − syy)（梯度方向為雙向，故取半角）
    # 影像 y 軸向下，主梯度角取負號才是一般的逆時針角度
    theta = -0.5 * np.degrees(np.arctan2(2 * sxy, sxx - syy))
    # 把 -90 映到 90，使回傳範圍為 (-90, 90]
    return float(theta + 180 if theta <= -90 else theta)


def order_quad(points: npt.ArrayLike) -> Quad:
    """把四個點排成左上、右上、右下、左下（影像座標，y 軸向下）。

    先依相對於重心的角度排成順時針，再把 ``x + y`` 最小者轉到第一個；
    與只看 ``x + y``／``y − x`` 的做法不同，四邊形旋轉接近 45° 時仍不會重複選到同一點。
    輸入須可轉成形狀 ``(4, 2)``，否則丟 ``ValueError``。
    """
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    if pts.shape != (4, 2):
        raise ValueError(f"四邊形必須有 4 個 (x, y) 點，收到形狀 {pts.shape}")
    center = pts.mean(axis=0)
    # y 軸向下時，arctan2 角度遞增在畫面上是順時針方向
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    clockwise = pts[np.argsort(angles)]
    # 以 x + y 最小者（最靠左上）為起點，循環平移保持順時針順序
    start = int(np.argmin(clockwise.sum(axis=1)))
    return np.roll(clockwise, -start, axis=0)


def clahe(img: Image, clip: float, tile: int) -> Image:
    """對灰階影像做 CLAHE（限制對比的自適應直方圖均衡化），``tile × tile`` 格。

    只接受 2 維影像；彩色影像請先轉灰階或取出亮度通道。
    """
    validate_image(img)
    if img.ndim != 2:
        raise ValueError(f"clahe 只接受灰階影像，收到形狀 {img.shape}")
    if clip <= 0 or tile <= 0:
        raise ValueError(f"須滿足 clip > 0、tile > 0，收到 clip={clip}、tile={tile}")
    # clipLimit 限制每格直方圖的高度，超出部分平均分配，以免放大雜訊；
    # tileGridSize 為把影像切成幾格（格數，不是每格的像素數）
    op = cv2.createCLAHE(clipLimit=clip, tileGridSize=(tile, tile))
    return np.asarray(op.apply(img), dtype=np.uint8)
