"""條碼／QR 解碼器介面與轉接。

前處理邏輯（``barcode``、``invoice_qr``）只依賴 ``Decoder`` 介面；
``ZxingDecoder`` 為預設實作，``PyzbarDecoder`` 供 E1 實驗對照。
兩者皆在建立時才 import 對應套件，未安裝時丟 ``ImportError``。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import cv2
import numpy as np

from dietai.preprocess.config import ZxingConfig
from dietai.preprocess.ops import to_gray, validate_image
from dietai.preprocess.types import CodeFormat as CodeFormat  # 定義在 types，此處沿用舊路徑
from dietai.preprocess.types import Image

Point = tuple[float, float]


@dataclass(frozen=True)
class DecodeHit:
    """一筆解碼結果。

    ``raw`` 為條碼內容的原始位元組（電子發票 QR 的中文由 Go 端解碼，這裡不轉換）；
    ``text`` 僅供顯示與一維條碼比對。``corners`` 為四角座標（左上、右上、右下、左下，
    以條碼本身的方向為準），單位為像素，座標系為傳入解碼器的影像。
    """

    format: CodeFormat
    text: str
    raw: bytes
    corners: tuple[Point, Point, Point, Point]

    @property
    def center(self) -> Point:
        xs, ys = zip(*self.corners, strict=True)
        return (sum(xs) / 4, sum(ys) / 4)

    @property
    def area(self) -> float:
        """四角圍成的多邊形面積（平方像素，鞋帶公式）。"""
        pts = self.corners
        s = sum(pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1] for i in range(4))
        return abs(s) / 2


class Decoder(Protocol):
    """解碼器：輸入 BGR 或灰階 ``uint8`` 影像，回傳找到的所有條碼（找不到時為空串列）。"""

    def __call__(self, img: Image) -> list[DecodeHit]: ...


class ZxingDecoder:
    """以 zxing-cpp 解碼。``cfg`` 控制 zxing-cpp 內建的旋轉、縮小、反色嘗試。"""

    def __init__(self, cfg: ZxingConfig = ZxingConfig()) -> None:
        import zxingcpp

        self._zx = zxingcpp
        self.cfg = cfg
        fmt = zxingcpp.BarcodeFormat
        self._formats: dict[Any, CodeFormat] = {
            fmt.EAN13: CodeFormat.EAN13,
            fmt.EAN8: CodeFormat.EAN8,
            fmt.UPCA: CodeFormat.UPCA,
            fmt.UPCE: CodeFormat.UPCE,
            fmt.Code128: CodeFormat.CODE128,
            fmt.QRCode: CodeFormat.QR_CODE,
        }

    def __call__(self, img: Image) -> list[DecodeHit]:
        validate_image(img)
        results = self._zx.read_barcodes(
            np.ascontiguousarray(img),
            try_rotate=self.cfg.try_rotate,
            try_downscale=self.cfg.try_downscale,
            try_invert=self.cfg.try_invert,
        )
        hits: list[DecodeHit] = []
        for r in results:
            p = r.position
            corners = tuple(
                (float(q.x), float(q.y))
                for q in (p.top_left, p.top_right, p.bottom_right, p.bottom_left)
            )
            hits.append(
                DecodeHit(
                    format=self._formats.get(r.format, CodeFormat.OTHER),
                    text=r.text,
                    raw=bytes(r.bytes),
                    corners=corners,  # type: ignore[arg-type]
                )
            )
        return hits


class PyzbarDecoder:
    """以 pyzbar（ZBar）解碼，供實驗對照。

    注意：ZBar 會猜測 QR 的字元編碼並轉成 UTF-8，``raw`` 不一定是原始位元組，
    電子發票的正式流程請用 ``ZxingDecoder``。四角取自 ZBar 多邊形的最小外接矩形。
    """

    _FORMATS = {
        "EAN13": CodeFormat.EAN13,
        "EAN8": CodeFormat.EAN8,
        "UPCA": CodeFormat.UPCA,
        "UPCE": CodeFormat.UPCE,
        "CODE128": CodeFormat.CODE128,
        "QRCODE": CodeFormat.QR_CODE,
    }

    def __init__(self) -> None:
        from pyzbar import pyzbar

        self._decode = pyzbar.decode

    def __call__(self, img: Image) -> list[DecodeHit]:
        gray = to_gray(img)  # ZBar 只接受 8 位元灰階
        hits: list[DecodeHit] = []
        for r in self._decode(gray):
            poly = np.array([(p.x, p.y) for p in r.polygon], dtype=np.float32)
            box = cv2.boxPoints(cv2.minAreaRect(poly))
            pts: list[list[float]] = np.asarray(box, dtype=np.float64).tolist()
            corners = _order_corners([(x, y) for x, y in pts])
            raw = bytes(r.data)
            hits.append(
                DecodeHit(
                    format=self._FORMATS.get(r.type, CodeFormat.OTHER),
                    text=raw.decode("utf-8", errors="replace"),
                    raw=raw,
                    corners=corners,
                )
            )
        return hits


def _order_corners(pts: list[Point]) -> tuple[Point, Point, Point, Point]:
    """把四點排成左上、右上、右下、左下（以影像座標為準）。"""
    by_sum = sorted(pts, key=lambda p: p[0] + p[1])
    by_diff = sorted(pts, key=lambda p: p[0] - p[1])
    return by_sum[0], by_diff[-1], by_sum[-1], by_diff[0]
