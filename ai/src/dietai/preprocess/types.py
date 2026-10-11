"""前處理共用型別。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, TypeAlias

import numpy as np
import numpy.typing as npt

# 影像：uint8，彩色為 (H, W, 3) BGR，灰階為 (H, W)。
Image: TypeAlias = npt.NDArray[np.uint8]

# 四邊形：float32，形狀 (4, 2) 的 (x, y)，順序為左上、右上、右下、左下（見 ops.order_quad）。
Quad: TypeAlias = npt.NDArray[np.float32]


@dataclass(frozen=True)
class StepRecord:
    """一個處理步驟的紀錄，供消融實驗分析。

    ``params`` 為該步驟實際使用的參數；``elapsed_ms`` 為耗時（毫秒）。
    """

    name: str
    elapsed_ms: float
    params: Mapping[str, Any] = field(default_factory=dict)


class PreprocessWarning(StrEnum):
    """給使用者的提示代碼。文字訊息由 APP 端對應，這裡只放代碼。"""

    TOO_BLURRY = "TOO_BLURRY"
    TOO_DARK = "TOO_DARK"
    TOO_BRIGHT = "TOO_BRIGHT"
    LOW_RESOLUTION = "LOW_RESOLUTION"
    BARCODE_NOT_FOUND = "BARCODE_NOT_FOUND"
    BARCODE_UNCONFIRMED = "BARCODE_UNCONFIRMED"  # 有解碼結果但未達 min_agree，建議靠近或重拍
    INVOICE_QR_PARTIAL = "INVOICE_QR_PARTIAL"
    INVOICE_QR_NOT_FOUND = "INVOICE_QR_NOT_FOUND"
    LABEL_NOT_LOCATED = "LABEL_NOT_LOCATED"  # 找不到營養標示的表格框，以原圖繼續
    GLARE_RETAKE = "GLARE_RETAKE"  # 反光面積過大，無法修補，建議重拍
    DISH_NOT_FOUND = "DISH_NOT_FOUND"  # 食物照片中切不出任何一道菜，以整張影像繼續


@dataclass(frozen=True)
class Box:
    """軸對齊的矩形框（原圖整數像素座標）：左上角 ``(x, y)``，寬 ``w``、高 ``h``。

    右下邊界 ``(x1, y1)`` 不含在框內，與 Python 切片一致。
    """

    x: int
    y: int
    w: int
    h: int

    def __post_init__(self) -> None:
        if self.w <= 0 or self.h <= 0:
            raise ValueError(f"框的寬高必須大於 0，收到 {self.w}×{self.h}")

    @property
    def x1(self) -> int:
        return self.x + self.w

    @property
    def y1(self) -> int:
        return self.y + self.h

    @property
    def area(self) -> int:
        return self.w * self.h

    def iou(self, other: Box) -> float:
        """與另一個框的交集除以聯集（0–1）。"""
        iw = min(self.x1, other.x1) - max(self.x, other.x)
        ih = min(self.y1, other.y1) - max(self.y, other.y)
        if iw <= 0 or ih <= 0:
            return 0.0
        inter = iw * ih
        return inter / (self.area + other.area - inter)

    def contains(self, other: Box) -> bool:
        """``other`` 是否完全落在本框內。"""
        return (
            self.x <= other.x and self.y <= other.y and other.x1 <= self.x1 and other.y1 <= self.y1
        )

    def crop(self, img: Image) -> Image:
        """裁出框內影像（副本）；超出影像的部分自動截掉。"""
        return img[max(0, self.y) : self.y1, max(0, self.x) : self.x1].copy()


@dataclass(frozen=True)
class Ellipse:
    """橢圓（原圖浮點像素座標）：中心 ``(cx, cy)``、長軸與短軸的**全長**、長軸相對於 x 軸的角度。

    ``angle`` 以度為單位、範圍 [0, 180)，影像 y 軸向下，因此正角度為順時針（與 OpenCV 一致）。
    """

    cx: float
    cy: float
    major: float
    minor: float
    angle: float

    def __post_init__(self) -> None:
        if not 0 < self.minor <= self.major:
            raise ValueError(f"須滿足 0 < minor <= major，收到 {self.minor}、{self.major}")

    def normalized_radius(self, x: npt.ArrayLike, y: npt.ArrayLike) -> npt.NDArray[np.float64]:
        """點到中心的「正規化半徑」：1 在橢圓上、小於 1 在內部。"""
        t = np.radians(self.angle)
        dx = np.asarray(x, dtype=np.float64) - self.cx
        dy = np.asarray(y, dtype=np.float64) - self.cy
        u = dx * np.cos(t) + dy * np.sin(t)
        v = -dx * np.sin(t) + dy * np.cos(t)
        return np.asarray(np.hypot(u / (self.major / 2), v / (self.minor / 2)), dtype=np.float64)

    def bbox(self) -> Box:
        """外接的軸對齊矩形（向外取整）。"""
        a, b, t = self.major / 2, self.minor / 2, np.radians(self.angle)
        hx = float(np.hypot(a * np.cos(t), b * np.sin(t)))
        hy = float(np.hypot(a * np.sin(t), b * np.cos(t)))
        x0, y0 = int(np.floor(self.cx - hx)), int(np.floor(self.cy - hy))
        x1, y1 = int(np.ceil(self.cx + hx)), int(np.ceil(self.cy + hy))
        return Box(x0, y0, max(1, x1 - x0), max(1, y1 - y0))


class CodeFormat(StrEnum):
    """條碼格式（與解碼套件無關的代碼）。"""

    EAN13 = "EAN13"
    EAN8 = "EAN8"
    UPCA = "UPCA"
    UPCE = "UPCE"
    CODE128 = "CODE128"
    QR_CODE = "QR_CODE"
    OTHER = "OTHER"


class Rung(StrEnum):
    """條碼逐步升級（``barcode.decode_with_ladder``）的一階。

    每一階都由原圖獨立產生一個影像版本，不疊加前一階的結果，
    以便 E1 消融實驗判斷「是哪一個步驟救回來的」。
    """

    RAW = "raw"  # 原圖
    GRAY = "gray"  # 灰階
    BINARIZE = "binarize"  # 自適應二值化
    SHARPEN = "sharpen"  # 反銳化遮罩
    DENOISE = "denoise"  # 中值濾波
    DESKEW = "deskew"  # 估計傾斜角後旋轉校正
    MULTISCALE = "multiscale"  # 依設定的倍率逐一縮放
