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
from dietai.preprocess.ops import order_quad, to_gray, validate_image
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
        """四角座標的平均（像素）。``invoice_qr`` 依其 x 分左右。"""
        xs, ys = zip(*self.corners, strict=True)
        return (sum(xs) / 4, sum(ys) / 4)

    @property
    def area(self) -> float:
        """四角圍成的多邊形面積（平方像素，鞋帶公式）。"""
        pts = self.corners
        # 鞋帶公式：Σ (x_i·y_{i+1} − x_{i+1}·y_i) / 2；取絕對值，與四角的繞行方向無關
        s = sum(pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1] for i in range(4))
        return abs(s) / 2


class Decoder(Protocol):
    """解碼器：輸入 BGR 或灰階 ``uint8`` 影像，回傳找到的所有條碼（找不到時為空串列）。"""

    def __call__(self, img: Image) -> list[DecodeHit]: ...


class ZxingDecoder:
    """以 zxing-cpp 解碼。``cfg`` 控制 zxing-cpp 內建的旋轉、縮小、反色嘗試。"""

    def __init__(self, cfg: ZxingConfig = ZxingConfig()) -> None:
        # 延遲 import：未安裝 zxing-cpp 的環境仍可 import 本模組（例如只用 PyzbarDecoder）
        import zxingcpp

        self._zx = zxingcpp
        self.cfg = cfg
        fmt = zxingcpp.BarcodeFormat
        # zxing-cpp 格式 → 專案的 ``CodeFormat``；未列出的格式在 __call__ 中歸為 OTHER
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
        # zxing-cpp 直接接受灰階或 BGR 的 numpy 陣列，但需連續記憶體；切片等非連續的視圖
        # 由 ascontiguousarray 複製一份（已連續時不複製）。未指定 formats，即嘗試所有格式，
        # 格式篩選由呼叫端（``LadderConfig.accept_formats``）負責
        results = self._zx.read_barcodes(
            np.ascontiguousarray(img),
            try_rotate=self.cfg.try_rotate,
            try_downscale=self.cfg.try_downscale,
            try_invert=self.cfg.try_invert,
        )
        hits: list[DecodeHit] = []
        for r in results:
            # zxing-cpp 的 position 依條碼本身的方向給四角，條碼倒置時 top_left 可能在影像右下
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
    電子發票的正式流程請用 ``ZxingDecoder``。四角取自 ZBar 多邊形的最小外接矩形
    （多邊形為空時改用 ``rect``），再依 ZBar 回報的閱讀方向輪轉成以條碼本身方向為準；
    沒有方向資訊時為影像方向。
    """

    # pyzbar 回傳的 ``type`` 字串 → 專案的 ``CodeFormat``；未列出者歸為 OTHER
    _FORMATS = {
        "EAN13": CodeFormat.EAN13,
        "EAN8": CodeFormat.EAN8,
        "UPCA": CodeFormat.UPCA,
        "UPCE": CodeFormat.UPCE,
        "CODE128": CodeFormat.CODE128,
        "QRCODE": CodeFormat.QR_CODE,
    }

    def __init__(self) -> None:
        # 延遲 import：pyzbar 只在實驗對照時需要（且需系統安裝 ZBar 函式庫）
        from pyzbar import pyzbar

        self._decode = pyzbar.decode

    # ZBar 的 orientation（條碼的閱讀方向）→ 影像方向四角（左上、右上、右下、左下）的起點位移：
    # RIGHT 表示由上往下讀（條碼順時針轉 90°），條碼本身的左上角落在影像的右上，依此類推。
    # 舊版 pyzbar 沒有此欄位、或 ZBar 回傳 UNKNOWN 時維持影像方向
    _ORIENT_SHIFT = {"UP": 0, "RIGHT": 1, "DOWN": 2, "LEFT": 3}

    def __call__(self, img: Image) -> list[DecodeHit]:
        gray = to_gray(img)  # ZBar 只接受 8 位元灰階
        hits: list[DecodeHit] = []
        for r in self._decode(gray):
            # ZBar 的 polygon 點數不固定（不一定是四點），
            # 先以 minAreaRect 求最小外接旋轉矩形，再由 boxPoints 取出其四個頂點
            poly = np.array([(p.x, p.y) for p in r.polygon], dtype=np.float32)
            if len(poly) == 0:
                # ZBar 偶爾回傳空 polygon（minAreaRect 會丟例外），改用軸對齊的 rect
                left, top, width, height = r.rect
                right, bottom = left + width, top + height
                poly = np.array(
                    [(left, top), (right, top), (right, bottom), (left, bottom)], dtype=np.float32
                )
            # order_quad 依角度排序：只看 x + y／x − y 時，旋轉 45° 的外接矩形會重複選到同一點
            box = order_quad(cv2.boxPoints(cv2.minAreaRect(poly)))
            corners = [(float(x), float(y)) for x, y in box.tolist()]
            # 依閱讀方向輪轉，使四角以條碼本身的方向為準（DecodeHit 的約定）
            shift = self._ORIENT_SHIFT.get(str(getattr(r, "orientation", None)), 0)
            tl, tr, br, bl = corners[shift:] + corners[:shift]
            raw = bytes(r.data)
            hits.append(
                DecodeHit(
                    format=self._FORMATS.get(r.type, CodeFormat.OTHER),
                    # 無法以 UTF-8 解碼的位元組以 U+FFFD 取代，避免例外；text 只供顯示與比對
                    text=raw.decode("utf-8", errors="replace"),
                    raw=raw,
                    corners=(tl, tr, br, bl),
                )
            )
        return hits
