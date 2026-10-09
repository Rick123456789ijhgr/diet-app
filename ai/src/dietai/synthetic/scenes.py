"""合成場景。不使用真實照片；內容由程式繪製，供測試與工作台使用。"""

from __future__ import annotations

import cv2
import numpy as np

from dietai.preprocess.barcode import ean13_check_digit
from dietai.preprocess.types import Image

_BASE_H, _BASE_W = 1080, 1920


def label_scene(height: int = 1080, width: int = 1920, seed: int = 0) -> Image:
    """紙色底上的格線、文字與色塊，模擬包裝標示，提供足夠的邊緣供模糊分數計算。

    以 1080p 為基準繪製後再縮放到指定尺寸，使不同解析度的內容一致。
    """
    rng = np.random.default_rng(seed)
    img = np.full((_BASE_H, _BASE_W, 3), (190, 200, 205), dtype=np.uint8)  # 一般光線下的紙張
    for y in range(120, _BASE_H - 80, 60):
        cv2.line(img, (100, y), (_BASE_W - 100, y), (0, 0, 0), 2)
    for x in (100, 900, _BASE_W - 100):
        cv2.line(img, (x, 120), (x, _BASE_H - 140), (0, 0, 0), 2)
    for i, y in enumerate(range(160, _BASE_H - 80, 60)):
        cv2.putText(img, f"Item {i} 12.{i}g", (130, y), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2)
    for _ in range(8):
        x, y = int(rng.integers(950, _BASE_W - 250)), int(rng.integers(150, _BASE_H - 300))
        color = tuple(int(c) for c in rng.integers(0, 200, 3))
        cv2.rectangle(img, (x, y), (x + 150, y + 150), color, -1)
    if (height, width) != (_BASE_H, _BASE_W):
        return np.asarray(
            cv2.resize(img, (width, height), interpolation=cv2.INTER_AREA), dtype=np.uint8
        )
    return img


_PAPER = (235, 240, 242)  # 白色包裝／感熱紙


def _symbol(content: str | bytes, fmt_name: str, module_px: int) -> Image:
    """以 zxing-cpp 產生條碼影像（灰階，含靜區），每個模組 ``module_px`` 像素。"""
    import zxingcpp

    fmt = getattr(zxingcpp.BarcodeFormat, fmt_name)
    symbol = zxingcpp.create_barcode(content, fmt).to_image(scale=module_px)
    return np.asarray(symbol, dtype=np.uint8)


def _paste(canvas: Image, symbol: Image, x: int, y: int) -> None:
    h, w = symbol.shape
    region = canvas[y : y + h, x : x + w]
    ink = symbol[..., None].astype(np.float32) / 255  # 白色處保留紙色、黑色處印上墨色
    paper = region.astype(np.float32)
    canvas[y : y + h, x : x + w] = (paper * ink + 20 * (1 - ink)).astype(np.uint8)


def ean13_codes(n: int, seed: int = 0, prefix: str = "471") -> list[str]:
    """產生 ``n`` 個互不相同、檢查碼正確的 EAN-13（預設以台灣的 471 開頭）。"""
    if not prefix.isascii() or not prefix.isdigit() or len(prefix) > 12:
        raise ValueError(f"prefix 須為至多 12 個數字，收到 {prefix!r}")
    if n > 10 ** (12 - len(prefix)):
        raise ValueError(f"prefix {prefix!r} 之下不足 {n} 個不同的條碼")
    rng = np.random.default_rng(seed)
    codes: dict[str, None] = {}  # 保留產生順序
    while len(codes) < n:
        body = prefix + "".join(str(d) for d in rng.integers(0, 10, 12 - len(prefix)))
        codes.setdefault(body + str(ean13_check_digit(body)), None)
    return list(codes)


def ean13_scene(
    code: str = "4710088410108",
    module_px: int = 4,
    height: int = 600,
    width: int = 900,
) -> Image:
    """紙色底上置中的一個 EAN-13 條碼，上下有干擾文字（BGR）。

    ``code`` 須為檢查碼正確的 13 位數字。條碼本身寬約 ``113 × module_px`` 像素，
    畫布太小放不下時丟 ``ValueError``。
    """
    symbol = _symbol(code, "EAN13", module_px)
    sh, sw = symbol.shape
    if sh > height or sw > width:
        raise ValueError(f"畫布 {width}×{height} 放不下 {sw}×{sh} 的條碼，請調小 module_px")
    img = np.full((height, width, 3), _PAPER, dtype=np.uint8)
    x, y = (width - sw) // 2, (height - sh) // 2
    _paste(img, symbol, x, y)
    font, size = cv2.FONT_HERSHEY_SIMPLEX, max(0.4, module_px / 5)
    cv2.putText(img, "NET WT 350g", (20, max(20, y - 20)), font, size, (40, 40, 40), 1)
    cv2.putText(img, code, (x, min(height - 10, y + sh + 30)), font, size, (40, 40, 40), 1)
    return img


def invoice_qr_scene(
    left: bytes,
    right: bytes,
    module_px: int = 4,
    gap_px: int = 60,
) -> Image:
    """模擬電子發票證明聯：上方文字、下方並排的左右兩個 QR（BGR）。

    內容以原始位元組寫入 QR（可含非 ASCII 位元組，例如 Big5 中文），
    供驗證解碼後的 ``raw`` 與產生時一致。
    """
    qr_left, qr_right = (_symbol(c, "QRCode", module_px) for c in (left, right))
    qh = max(qr_left.shape[0], qr_right.shape[0])
    margin, header = 40, 220
    width = qr_left.shape[1] + qr_right.shape[1] + gap_px + 2 * margin
    height = header + qh + margin
    img = np.full((height, width, 3), _PAPER, dtype=np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX
    for i, line in enumerate(["E-INVOICE", "2026-10 / 11", "AB-12345678", "TOTAL 120"]):
        cv2.putText(img, line, (margin, 45 + 45 * i), font, 1.0, (30, 30, 30), 2)
    _paste(img, qr_left, margin, header)
    _paste(img, qr_right, margin + qr_left.shape[1] + gap_px, header)
    return img
