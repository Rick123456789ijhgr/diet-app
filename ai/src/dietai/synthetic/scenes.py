"""合成場景。不使用真實照片；內容由程式繪製，供測試與工作台使用。"""

from __future__ import annotations

import cv2
import numpy as np

from dietai.preprocess.barcode import ean13_check_digit
from dietai.preprocess.ops import order_quad
from dietai.preprocess.types import Ellipse, Image, Quad

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


_LABEL_PAPER = (212, 218, 222)  # 白色包裝，亮度低於預設的光斑亮度下限
_LABEL_ROWS = [
    ("Serving size", "30 g"),
    ("Servings", "6"),
    ("Calories", "152 kcal"),
    ("Protein", "2.1 g"),
    ("Fat", "8.4 g"),
    ("  Saturated fat", "3.2 g"),
    ("  Trans fat", "0 g"),
    ("Carbohydrate", "17.0 g"),
    ("  Sugar", "1.5 g"),
    ("Sodium", "125 mg"),
]


def nutrition_label(height: int = 900, width: int = 640) -> Image:
    """營養標示表格（BGR）：黑色外框貼齊影像邊緣、標題、粗分隔線與 10 列「欄位 數值」。

    以 640×900 為基準繪製後縮放，外框的外緣就是影像邊界，因此四角為影像四角。
    """
    bw, bh = 640, 900
    img = np.full((bh, bw, 3), _LABEL_PAPER, dtype=np.uint8)
    ink, font = (25, 25, 25), cv2.FONT_HERSHEY_SIMPLEX
    cv2.rectangle(img, (0, 0), (bw - 1, bh - 1), ink, 16)  # 線寬一半在畫布外，可見 8 px
    cv2.putText(img, "Nutrition Facts", (40, 80), font, 1.6, ink, 3)
    cv2.line(img, (8, 110), (bw - 8, 110), ink, 8)
    row_h = (bh - 140) // len(_LABEL_ROWS)
    for i, (name, value) in enumerate(_LABEL_ROWS):
        y = 130 + i * row_h
        cv2.putText(img, name, (40, y + row_h - 25), font, 1.0, ink, 2)
        (tw, _), _ = cv2.getTextSize(value, font, 1.0, 2)
        cv2.putText(img, value, (bw - 40 - tw, y + row_h - 25), font, 1.0, ink, 2)
        if i < len(_LABEL_ROWS) - 1:
            cv2.line(img, (8, y + row_h), (bw - 8, y + row_h), ink, 2)
    if (height, width) != (bh, bw):
        interp = cv2.INTER_AREA if height * width < bh * bw else cv2.INTER_LINEAR
        return np.asarray(cv2.resize(img, (width, height), interpolation=interp), dtype=np.uint8)
    return img


def label_perspective_scene(
    strength: float = 0.15,
    seed: int = 0,
    height: int = 1080,
    width: int = 1440,
) -> tuple[Image, Quad]:
    """把 ``nutrition_label`` 以隨機透視變形貼到桌面背景上，回傳（影像, 真實四角）。

    標示約佔畫面高或寬的 60%，置中後四角各自隨機位移最多 ``strength`` 倍的標示邊長
    （0–0.3，0 為正視），並限制在畫面內。標示外接框之外有幾個小色塊作為干擾。
    四角為原圖座標，左上起順時針。
    """
    if not 0 <= strength <= 0.3:
        raise ValueError(f"strength 必須介於 0 與 0.3，收到 {strength}")
    rng = np.random.default_rng(seed)
    img = np.full((height, width, 3), (120, 140, 155), dtype=np.uint8)  # 木紋色桌面

    label = nutrition_label()
    lh, lw = label.shape[:2]
    scale = min(0.6 * height / lh, 0.6 * width / lw)
    qw, qh = lw * scale, lh * scale
    x0, y0 = (width - qw) / 2, (height - qh) / 2
    base = np.array([[x0, y0], [x0 + qw, y0], [x0 + qw, y0 + qh], [x0, y0 + qh]])
    jitter = rng.uniform(-strength, strength, (4, 2)) * np.array([qw, qh])
    pad = 0.02 * min(height, width)  # 四角留在畫面內
    corners = np.clip(base + jitter, [pad, pad], [width - pad, height - pad])
    quad = order_quad(corners)

    # 干擾色塊只放在標示外接框之外，避免與外框相連而改變真實四角
    bx0, by0 = quad.min(axis=0) - pad
    bx1, by1 = quad.max(axis=0) + pad
    placed = 0
    for _ in range(200):
        if placed == 6:
            break
        size = int(rng.integers(20, max(21, min(height, width) // 10)))
        x, y = (
            int(rng.integers(0, max(1, width - size))),
            int(rng.integers(0, max(1, height - size))),
        )
        if x + size > bx0 and x < bx1 and y + size > by0 and y < by1:
            continue
        color = tuple(int(c) for c in rng.integers(40, 220, 3))
        cv2.rectangle(img, (x, y), (x + size, y + size), color, -1)
        placed += 1

    src = np.array([[0, 0], [lw, 0], [lw, lh], [0, lh]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, quad)
    warped = cv2.warpPerspective(label, m, (width, height), flags=cv2.INTER_LINEAR)
    cover = cv2.warpPerspective(np.full((lh, lw), 255, np.uint8), m, (width, height))
    alpha = (cover.astype(np.float32) / 255)[..., None]
    out = img.astype(np.float32) * (1 - alpha) + warped.astype(np.float32) * alpha
    return out.astype(np.uint8), quad


_TABLE = (70, 105, 150)  # 木紋色餐桌（BGR）
_PLATE = (236, 238, 240)
_PLATE_RIM = (196, 202, 208)


def food_scene(
    n_dishes: int = 3,
    seed: int = 0,
    height: int = 720,
    width: int = 960,
    tilt: float = 0.3,
) -> tuple[Image, list[Ellipse]]:
    """餐桌上的 ``n_dishes`` 個盤子（BGR），回傳（影像, 各盤緣的真實橢圓）。

    桌面有淡淡的木紋與雜訊；盤子為白色橢圓、內圈有一道淺灰盤緣，盤中是幾個重疊的
    彩色圓組成的不規則食物。短長軸比隨機介於 ``1 - tilt`` 與 1（模擬俯拍角度，0–0.6），
    長軸角度在水平 ±15° 內。盤子之間至少相隔短邊的 4%，放不下時丟 ``ValueError``。
    另有一雙細長筷子作為干擾（面積很小，應被切菜過濾）。
    """
    if not 0 <= tilt <= 0.6:
        raise ValueError(f"tilt 必須介於 0 與 0.6，收到 {tilt}")
    if n_dishes < 0:
        raise ValueError(f"n_dishes 不得為負，收到 {n_dishes}")
    rng = np.random.default_rng(seed)
    short = min(height, width)
    rows = np.arange(height, dtype=np.float32)[:, None, None]
    grain = 6 * np.sin(rows / 9 + rng.uniform(0, np.pi)) + rng.normal(0, 3, (height, width, 1))
    img = np.clip(np.array(_TABLE, np.float32) + grain, 0, 255).astype(np.uint8)

    gap = 0.04 * short
    major_range = (0.28 * short, 0.4 * short) if n_dishes <= 4 else (0.2 * short, 0.3 * short)
    plates: list[Ellipse] = []
    boxes: list[tuple[float, float, float, float]] = []
    for _ in range(2000):
        if len(plates) == n_dishes:
            break
        major = float(rng.uniform(*major_range))
        e = Ellipse(
            float(rng.uniform(0, width)),
            float(rng.uniform(0, height)),
            major,
            major * float(rng.uniform(1 - tilt, 1)),
            float(rng.uniform(-15, 15) % 180),
        )
        b = e.bbox()
        if b.x < gap or b.y < gap or b.x1 > width - gap or b.y1 > height - gap:
            continue
        if any(
            b.x < x1 + gap and x0 < b.x1 + gap and b.y < y1 + gap and y0 < b.y1 + gap
            for x0, y0, x1, y1 in boxes
        ):
            continue
        plates.append(e)
        boxes.append((b.x, b.y, b.x1, b.y1))
    if len(plates) < n_dishes:
        raise ValueError(f"{width}×{height} 的畫面放不下 {n_dishes} 個盤子")

    for e in plates:
        center = (round(e.cx), round(e.cy))
        axes = (round(e.major / 2), round(e.minor / 2))
        cv2.ellipse(img, center, axes, e.angle, 0, 360, _PLATE, -1, cv2.LINE_AA)
        inner = (round(0.82 * e.major / 2), round(0.82 * e.minor / 2))
        cv2.ellipse(img, center, inner, e.angle, 0, 360, _PLATE_RIM, 2, cv2.LINE_AA)
        color = tuple(int(c) for c in rng.integers(20, 230, 3))
        t = np.radians(e.angle)
        for _ in range(5):  # 幾個重疊的圓組成不規則食物（留在內圈之內），不應被當成盤緣橢圓
            r = float(rng.uniform(0.25, 0.4)) * e.minor / 2
            rho, phi = 0.35 * np.sqrt(rng.uniform()), rng.uniform(0, 2 * np.pi)
            u, v = rho * np.cos(phi) * e.major / 2, rho * np.sin(phi) * e.minor / 2
            fc = (
                round(e.cx + u * np.cos(t) - v * np.sin(t)),
                round(e.cy + u * np.sin(t) + v * np.cos(t)),
            )
            cv2.circle(img, fc, round(r), color, -1, cv2.LINE_AA)

    length, thick = round(0.18 * width), max(2, round(0.006 * short))
    for _ in range(200):  # 筷子：放在不碰到盤子的位置，放不下就省略
        x, y = int(rng.integers(0, width - length)), int(rng.integers(0, height - 3 * thick))
        if any(
            x < x1 + gap and x0 < x + length + gap and y < y1 + gap and y0 < y + 3 * thick + gap
            for x0, y0, x1, y1 in boxes
        ):
            continue
        for dy in (0, 2 * thick):
            cv2.line(img, (x, y + dy), (x + length, y + dy), (40, 60, 90), thick)
        break
    return img, plates
