"""已知程度的影像退化，用來產生測試資料與在工作台模擬拍攝條件。

每個函式都回傳新陣列、不修改輸入；有隨機性的函式接受 ``seed``。
"""

from __future__ import annotations

import cv2
import numpy as np

from dietai.preprocess import ops
from dietai.preprocess.ops import validate_image
from dietai.preprocess.types import Image


def gaussian_blur(img: Image, sigma: float) -> Image:
    """高斯模糊；``sigma`` 為 0 時回傳副本。"""
    validate_image(img)
    if sigma <= 0:
        return img.copy()
    # 核大小設 (0, 0) 由 OpenCV 依 sigma 自動決定；sigmaY 省略時等於 sigmaX（各向同性）
    return np.asarray(cv2.GaussianBlur(img, (0, 0), sigmaX=sigma), dtype=np.uint8)


def scale_brightness(img: Image, gain: float) -> Image:
    """整體亮度乘上 ``gain``（<1 變暗、>1 變亮），超出範圍截斷。"""
    validate_image(img)
    # 先轉 float32 再相乘，避免 uint8 溢位繞回；截斷後再轉回 uint8
    return np.clip(img.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def brightness_gradient(img: Image, strength: float) -> Image:
    """由左到右的亮度梯度：左側乘 ``1 - strength``、右側乘 ``1 + strength``。"""
    validate_image(img)
    w = img.shape[1]
    # 每一欄一個增益，線性變化；整張平均增益約為 1，只改變左右的明暗差
    # （``strength`` > 1 時左側增益為負，截斷後變成全黑）
    ramp = np.linspace(1 - strength, 1 + strength, w, dtype=np.float32)
    # 依彩色／灰階調整形狀，靠廣播套用到每一列（與每個色版）
    shape = (1, w, 1) if img.ndim == 3 else (1, w)
    return np.clip(img.astype(np.float32) * ramp.reshape(shape), 0, 255).astype(np.uint8)


def gaussian_noise(img: Image, std: float, seed: int = 0) -> Image:
    """加上標準差為 ``std`` 的高斯雜訊。"""
    validate_image(img)
    if std <= 0:
        return img.copy()
    # 每次呼叫以 ``seed`` 建立獨立的產生器，不動全域亂數狀態；相同參數得到相同雜訊。
    # 雜訊逐像素、逐色版獨立（彩色影像會出現色彩雜訊），加上後截斷到 0–255。
    noise = np.random.default_rng(seed).normal(0, std, img.shape)
    return np.clip(img.astype(np.float64) + noise, 0, 255).astype(np.uint8)


def rotate(img: Image, degrees: float, border: int = 255) -> Image:
    """以中心逆時針旋轉，畫布擴大以保留整張影像，空白處填 ``border``（同 ``ops.rotate``）。"""
    return ops.rotate(img, degrees, border)


def downscale(img: Image, factor: float) -> Image:
    """等比縮小為原尺寸的 ``factor`` 倍（0 < factor ≤ 1）。"""
    validate_image(img)
    if not 0 < factor <= 1:
        raise ValueError(f"factor 必須介於 0 與 1，收到 {factor}")
    if factor == 1:
        return img.copy()
    h, w = img.shape[:2]
    # cv2.resize 的尺寸為（寬, 高）；至少 1 px，避免極小倍率得到空影像。
    # 縮小用 INTER_AREA（面積平均），模擬遠拍時解析度不足，不會產生鋸齒狀假影。
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
    # 光斑中心由 seed 決定，盡量讓整個半徑 r 落在畫面內；
    # 半徑超過半邊長時區間退化為單點（中心固定在 r，光斑會超出畫面）
    cx, cy = rng.uniform(r, max(r, w - r)), rng.uniform(r, max(r, h - r))
    # 距中心 1.2r 以外 alpha 為 0、像素不變，只計算光斑的外接框（結果與整張計算逐像素相同）
    reach = 1.2 * r
    x0, x1 = max(0, int(np.floor(cx - reach))), min(w, int(np.ceil(cx + reach)) + 1)
    y0, y1 = max(0, int(np.floor(cy - reach))), min(h, int(np.ceil(cy + reach)) + 1)
    result: Image = img.copy()
    if x0 >= x1 or y0 >= y1:
        return result
    yy, xx = np.mgrid[y0:y1, x0:x1]
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    # 柔化邊緣：距離 ≤ r 時 alpha = 1（全白），r 到 1.2r 之間線性降到 0
    alpha = np.clip((r - dist) / (0.2 * r) + 1, 0, 1).astype(np.float32)
    if img.ndim == 3:
        alpha = alpha[..., None]
    # 依 alpha 混合原像素與白色（255），模擬反光把局部內容洗成白色
    patch = img[y0:y1, x0:x1].astype(np.float32) * (1 - alpha) + 255 * alpha
    result[y0:y1, x0:x1] = np.clip(patch, 0, 255).astype(np.uint8)
    return result


def motion_blur(img: Image, length: float, angle_deg: float = 0.0) -> Image:
    """手震模糊：沿 ``angle_deg``（度，0 為水平、正值逆時針）方向、長 ``length`` 像素的線性核。

    ``length`` ≤ 1 時回傳副本。核為該方向上的一條等權重線段（面積和為 1），亮度不變。
    """
    validate_image(img)
    if length <= 1:
        return img.copy()
    # 核邊長取不小於 length 的奇數，中心在正中；在核上畫一條穿過中心、長 length 的線段
    k = int(np.ceil(length)) | 1
    c = (k - 1) / 2
    t = np.radians(angle_deg)
    # 影像 y 軸向下，逆時針角度的 y 分量取負號
    dx, dy = np.cos(t) * (length - 1) / 2, -np.sin(t) * (length - 1) / 2
    # 以 16 倍子像素精度畫抗鋸齒線，斜向的核才不會因取整而偏向某一側
    kernel = np.zeros((k, k), dtype=np.float32)
    shift = 4
    p0 = (round((c - dx) * 16), round((c - dy) * 16))
    p1 = (round((c + dx) * 16), round((c + dy) * 16))
    cv2.line(kernel, p0, p1, 1.0, thickness=1, lineType=cv2.LINE_AA, shift=shift)
    kernel /= kernel.sum()
    return np.asarray(
        cv2.filter2D(img, -1, kernel, borderType=cv2.BORDER_REPLICATE), dtype=np.uint8
    )


def salt_pepper(img: Image, amount: float, seed: int = 0) -> Image:
    """椒鹽雜訊：隨機 ``amount`` 比例（0–1）的像素變成全黑或全白（各半）。

    彩色影像的同一像素三個色版一起改變（模擬感光元件壞點，而非色彩雜訊）。
    """
    validate_image(img)
    if not 0 <= amount <= 1:
        raise ValueError(f"amount 必須介於 0 與 1，收到 {amount}")
    out: Image = img.copy()
    if amount == 0:
        return out
    rng = np.random.default_rng(seed)
    u = rng.random(img.shape[:2])
    # u < amount/2 為黑點、amount/2 ≤ u < amount 為白點，其餘不變
    out[u < amount / 2] = 0
    out[(u >= amount / 2) & (u < amount)] = 255
    return out


def reduce_contrast(img: Image, factor: float) -> Image:
    """以整張影像的平均值為中心壓縮灰階動態範圍：``平均 + (像素 − 平均) × factor``。

    ``factor`` 介於 0 與 1（1 為不變、0 為整張變成平均灰）；以平均值為中心，整體亮度不變，
    與 ``scale_brightness`` 的「變暗」分開控制。
    """
    validate_image(img)
    if not 0 <= factor <= 1:
        raise ValueError(f"factor 必須介於 0 與 1，收到 {factor}")
    if factor == 1:
        return img.copy()
    f = img.astype(np.float32)
    mean = float(f.mean())
    return np.clip(mean + (f - mean) * factor, 0, 255).round().astype(np.uint8)


def jpeg(img: Image, quality: int) -> Image:
    """以 JPEG 品質 ``quality``（1–100）重新壓縮再解碼，模擬通訊軟體或相簿的壓縮。"""
    validate_image(img)
    if not 1 <= quality <= 100:
        raise ValueError(f"quality 必須介於 1 與 100，收到 {quality}")
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, int(quality)])
    if not ok:  # 正常的 uint8 影像不會失敗；防禦性檢查
        raise ValueError("JPEG 編碼失敗")
    flag = cv2.IMREAD_COLOR if img.ndim == 3 else cv2.IMREAD_GRAYSCALE
    return np.asarray(cv2.imdecode(buf, flag), dtype=np.uint8)


def cylinder_warp(img: Image, strength: float, border: int = 255) -> Image:
    """曲面：把影像當成貼在直立圓柱（瓶身、罐身）上的標籤，從正前方看的樣子。

    ``strength`` 介於 0 與 1（不含 1）：影像左右邊緣在圓柱上的角度為 ``strength × 90°``，
    越大彎得越厲害、兩側壓縮越多；0 時回傳副本。以正投影近似，弧長 s 處的內容落在
    ``x = R·sin(s / R)``，輸出寬度為 ``2R·sin(θ)``（R 為圓柱半徑、θ 為邊緣角度）。
    高度不變；空白處填 ``border``。
    """
    validate_image(img)
    if not 0 <= strength < 1:
        raise ValueError(f"strength 必須介於 0 與 1（不含 1），收到 {strength}")
    if strength == 0:
        return img.copy()
    h, w = img.shape[:2]
    theta = strength * np.pi / 2
    radius = (w / 2) / theta  # 半寬的弧長 w/2 對應角度 θ
    out_w = max(1, round(2 * radius * np.sin(theta)))
    # 反向映射：輸出 x' 對應圓柱上的角度 asin(x'/R)，弧長 s = R·asin(x'/R) 即原圖的水平位置
    xs = (np.arange(out_w, dtype=np.float64) + 0.5) - out_w / 2
    src_x = radius * np.arcsin(np.clip(xs / radius, -1, 1)) + w / 2 - 0.5
    map_x = np.tile(src_x.astype(np.float32), (h, 1))
    map_y = np.tile(np.arange(h, dtype=np.float32)[:, None], (1, out_w))
    value = (border,) * 3 if img.ndim == 3 else border
    return np.asarray(
        cv2.remap(
            img,
            map_x,
            map_y,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=value,
        ),
        dtype=np.uint8,
    )
