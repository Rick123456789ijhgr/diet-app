"""營養標示前處理：表格定位、透視校正、光斑處理、對比增強。

流程為「定位＋校正 → 光斑 → 對比」，各段由 ``LabelConfig.enable_*`` 開關。
找不到表格框時不中斷：以原圖繼續後續步驟並附 ``LABEL_NOT_LOCATED``。
只做影像處理，不做 OCR 或欄位解析（屬模組二）。
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np
import numpy.typing as npt

from dietai.preprocess import ops
from dietai.preprocess.config import LabelConfig
from dietai.preprocess.types import Image, PreprocessWarning, Quad, StepRecord

# 找到表格四角的方法：``contour`` 為輪廓近似（主要），``hough`` 為直線交點（備援）
QuadMethod = Literal["contour", "hough"]


@dataclass(frozen=True)
class GlareResult:
    """``detect_glare`` 的結果：``mask`` 形狀為輸入的 ``(H, W)``，``ratio`` 為其面積比例。

    ``mask`` 與 ``ratio`` 皆為擴張（``glare_dilate_px``）之後的結果。
    """

    mask: npt.NDArray[np.bool_]
    ratio: float


@dataclass(frozen=True)
class LabelResult:
    """``preprocess_label`` 的結果。

    ``image`` 為處理後影像（校正後尺寸可能與輸入不同；``clahe_on_lab`` 關閉時為灰階）。
    ``quad`` 為找到的表格四角（原圖座標，左上起順時針），``quad_method`` 為找到它的方法；
    未啟用定位或找不到時皆為 ``None``。``glare`` 為光斑偵測結果（校正後座標），
    未啟用時為 ``None``。
    """

    image: Image
    quad: Quad | None
    quad_method: QuadMethod | None
    glare: GlareResult | None
    steps: tuple[StepRecord, ...]
    warnings: tuple[PreprocessWarning, ...]


def label_edges(img: Image, cfg: LabelConfig = LabelConfig()) -> Image:
    """定位用的邊緣圖（0／255 灰階），也是 ``locate_label_quad`` 的中間結果。

    影像先縮小到短邊 ``cfg.detect_short_side``（較小則不放大），高斯平滑後做
    Canny（``cfg.canny_low``、``cfg.canny_high``），再以 3×3 膨脹接上斷開的細縫。
    回傳的尺寸為縮小後的尺寸。
    """
    # 與 _locate 走同一條路徑（_detect_scale → _edges），工作台顯示的邊緣圖才與實際定位一致
    small, _ = _detect_scale(img, cfg)
    return _edges(small, cfg)


def locate_label_quad(img: Image, cfg: LabelConfig = LabelConfig()) -> Quad | None:
    """找出營養標示表格的四邊形，回傳原圖座標的四角（左上起順時針）；找不到時回傳 ``None``。

    先在 ``label_edges`` 上找面積最大、可近似成凸四邊形的輪廓（``cfg.approx_eps_ratio``）；
    找不到時改以 HoughLinesP（``cfg.hough_*``）找出最外側的上下左右四條直線並求交點。
    面積比例不在 ``cfg.min_quad_area_ratio``–``cfg.max_quad_area_ratio`` 之間的四邊形不採用。
    輸入不會被修改。
    """
    # 公開介面只回傳四角；找到的方法（contour／hough）由 preprocess_label 記錄在結果中
    quad, _ = _locate(img, cfg)
    return quad


def rectify(img: Image, quad: npt.ArrayLike, cfg: LabelConfig = LabelConfig()) -> Image:
    """以單應性轉換把 ``quad`` 圍出的區域拉成正視的矩形。

    四角先以 ``ops.order_quad`` 排序，因此順序不拘。四角視為角落像素的中心（OpenCV 慣例），
    對應到輸出的 ``(0, 0)``–``(w − 1, h − 1)``，四條邊上的像素都保留在輸出內。
    輸出寬為上下兩邊較長者加 1、高為左右兩邊較長者加 1（像素數）；長邊超過
    ``cfg.rectify_max_side`` 時等比縮小。
    """
    ops.validate_image(img)
    q = ops.order_quad(quad)
    tl, tr, br, bl = q
    # 透視下對邊長度不同，取較長者作為輸出尺寸，避免較長那一側被壓縮而損失解析度
    width = max(float(np.linalg.norm(tr - tl)), float(np.linalg.norm(br - bl)))
    height = max(float(np.linalg.norm(bl - tl)), float(np.linalg.norm(br - tr)))
    # 長邊像素數 = 邊長 × shrink + 1，因此以 (max_side − 1) 推算，確保輸出長邊不超過上限；
    # 分母至少為 1，避免四角重合（邊長 0）時除以零
    shrink = min(1.0, (cfg.rectify_max_side - 1) / max(width, height, 1.0))
    # 至少 2×2，退化的四邊形也能產生合法的輸出尺寸
    w, h = max(2, round(width * shrink) + 1), max(2, round(height * shrink) + 1)
    # 目標四角依序為左上、右上、右下、左下，與 order_quad 的順序對應
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(q, dst)
    # BORDER_REPLICATE：四角落在影像外（直線法允許少量出界）時以邊緣像素填補，
    # 而不是填入固定的黑色
    out = cv2.warpPerspective(
        img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
    return np.asarray(out, dtype=np.uint8)


def detect_glare(img: Image, cfg: LabelConfig = LabelConfig()) -> GlareResult:
    """偵測反光光斑：HSV 中亮度 ≥ ``cfg.glare_v_min`` 且飽和度 ≤ ``cfg.glare_s_max`` 的像素。

    灰階影像沒有飽和度，只以亮度判斷。遮罩再向外擴張 ``cfg.glare_dilate_px`` 像素，
    以涵蓋光斑邊緣的漸層。
    """
    ops.validate_image(img)
    if img.ndim == 2:
        # 灰階值即亮度，等同 HSV 的 V
        raw = img >= cfg.glare_v_min
    else:
        # OpenCV 的 8 位元 HSV：S、V 範圍皆為 0–255（H 為 0–179，這裡不用）
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        raw = (hsv[..., 2] >= cfg.glare_v_min) & (hsv[..., 1] <= cfg.glare_s_max)
    mask = raw.astype(np.uint8)
    # 沒有任何光斑時略過膨脹，省下一次卷積
    if cfg.glare_dilate_px > 0 and mask.any():
        # 半徑 r 的圓形核心邊長為 2r + 1；圓形比方形更貼近光斑的形狀
        size = 2 * cfg.glare_dilate_px + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
        mask = np.asarray(cv2.dilate(mask, kernel), dtype=np.uint8)
    result = mask.astype(bool)
    # 布林陣列的平均值即為 True 像素的面積比例
    return GlareResult(mask=result, ratio=float(result.mean()))


def remove_glare(
    img: Image, mask: npt.NDArray[np.bool_], cfg: LabelConfig = LabelConfig()
) -> tuple[Image, PreprocessWarning | None]:
    """修補光斑：遮罩面積比例超過 ``cfg.glare_max_ratio`` 時不處理並回傳 ``GLARE_RETAKE``；
    否則以 ``cv2.inpaint``（Telea，半徑 ``cfg.inpaint_radius``）修補。

    回傳（影像, 警告或 ``None``），影像一律為新陣列。``mask`` 形狀須與影像的 ``(H, W)`` 相同。
    """
    ops.validate_image(img)
    if mask.shape != img.shape[:2]:
        raise ValueError(f"遮罩形狀 {mask.shape} 與影像 {img.shape[:2]} 不符")
    # 光斑太大時 inpaint 只會以周圍像素「編造」內容，蓋住的文字無法還原，
    # 因此保留原樣並請使用者重拍，而不是產生看似乾淨但數字錯誤的影像
    if float(mask.mean()) > cfg.glare_max_ratio:
        return img.copy(), PreprocessWarning.GLARE_RETAKE
    if not mask.any():
        return img.copy(), None
    # cv2.inpaint 的遮罩須為 8 位元單通道，非 0 處為待修補區域
    out = cv2.inpaint(img, mask.astype(np.uint8) * 255, cfg.inpaint_radius, cv2.INPAINT_TELEA)
    return np.asarray(out, dtype=np.uint8), None


def enhance_contrast(img: Image, cfg: LabelConfig = LabelConfig()) -> Image:
    """CLAHE 局部對比增強（``cfg.clahe_clip``、``cfg.clahe_tile``）。

    ``cfg.clahe_on_lab`` 開啟且輸入為彩色時，只處理 LAB 的 L 通道並保留色彩（輸出 BGR）；
    否則轉灰階後處理（輸出灰階）。
    """
    ops.validate_image(img)
    if img.ndim == 3 and cfg.clahe_on_lab:
        # 只增強亮度（L），a／b 色彩通道不動，避免直接對 BGR 各通道均衡化造成色偏
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        # lab[..., 0] 是非連續的切片視圖，先複製成連續陣列再交給 OpenCV
        lab[..., 0] = ops.clahe(np.ascontiguousarray(lab[..., 0]), cfg.clahe_clip, cfg.clahe_tile)
        return np.asarray(cv2.cvtColor(lab, cv2.COLOR_LAB2BGR), dtype=np.uint8)
    return ops.clahe(ops.to_gray(img), cfg.clahe_clip, cfg.clahe_tile)


def preprocess_label(img: Image, cfg: LabelConfig = LabelConfig()) -> LabelResult:
    """營養標示前處理：定位＋校正 → 光斑 → 對比，各段由 ``cfg.enable_*`` 開關。

    輸入為 BGR 或灰階 ``uint8`` 影像，不會被修改；三段全部關閉時輸出等於輸入（副本）。
    找不到表格框時以原圖繼續並附 ``LABEL_NOT_LOCATED``；光斑過大時不修補並附
    ``GLARE_RETAKE``，但對比增強照常執行。每段的參數與耗時記錄在 ``steps``。
    """
    ops.validate_image(img)
    # out 為逐段傳遞的「目前影像」；先複製，確保三段全關時也回傳新陣列而非輸入本身
    out = img.copy()
    steps: list[StepRecord] = []
    warnings: list[PreprocessWarning] = []
    quad: Quad | None = None
    method: QuadMethod | None = None
    glare: GlareResult | None = None

    # ---- 第一段：定位＋透視校正（共用 enable_rectify 開關）
    if cfg.enable_rectify:
        start = time.perf_counter()
        quad, method = _locate(img, cfg)
        # 記下定位用的全部參數，供消融實驗與工作台回溯「這次結果是用哪組參數得到的」
        steps.append(
            StepRecord(
                "locate_label_quad",
                _ms_since(start),
                {
                    "method": method or "none",
                    "detect_short_side": cfg.detect_short_side,
                    "canny_low": cfg.canny_low,
                    "canny_high": cfg.canny_high,
                    "approx_eps_ratio": cfg.approx_eps_ratio,
                    "min_quad_area_ratio": cfg.min_quad_area_ratio,
                    "max_quad_area_ratio": cfg.max_quad_area_ratio,
                    "hough_threshold": cfg.hough_threshold,
                    "hough_min_line_ratio": cfg.hough_min_line_ratio,
                    "hough_max_gap": cfg.hough_max_gap,
                    "hough_collinear_ratio": cfg.hough_collinear_ratio,
                    "hough_min_side_gap_ratio": cfg.hough_min_side_gap_ratio,
                    "hough_corner_margin_ratio": cfg.hough_corner_margin_ratio,
                },
            )
        )
        if quad is None:
            # 不中斷：out 維持原圖副本，後續光斑與對比照常執行
            warnings.append(PreprocessWarning.LABEL_NOT_LOCATED)
        else:
            start = time.perf_counter()
            out = rectify(img, quad, cfg)
            steps.append(
                StepRecord(
                    "rectify",
                    _ms_since(start),
                    # shape[1::-1] 取 (W, H)，彩色與灰階皆適用
                    {"rectify_max_side": cfg.rectify_max_side, "size": out.shape[1::-1]},
                )
            )

    # ---- 第二段：光斑偵測與修補（作用在校正後影像上，因此遮罩為校正後座標）
    if cfg.enable_glare:
        start = time.perf_counter()
        glare = detect_glare(out, cfg)
        out, warning = remove_glare(out, glare.mask, cfg)
        # action 記錄實際採取的處理：retake（過大不修補）、inpaint（已修補）、none（無光斑）
        if warning is not None:
            action = "retake"
            warnings.append(warning)
        else:
            action = "inpaint" if glare.ratio > 0 else "none"
        steps.append(
            StepRecord(
                "glare",
                _ms_since(start),
                {
                    "ratio": round(glare.ratio, 4),
                    "action": action,
                    "glare_v_min": cfg.glare_v_min,
                    "glare_s_max": cfg.glare_s_max,
                    "glare_dilate_px": cfg.glare_dilate_px,
                    "glare_max_ratio": cfg.glare_max_ratio,
                    "inpaint_radius": cfg.inpaint_radius,
                },
            )
        )

    # ---- 第三段：對比增強（在光斑之後，因此光斑的亮度門檻是套用在未增強的影像上）
    if cfg.enable_contrast:
        start = time.perf_counter()
        out = enhance_contrast(out, cfg)
        steps.append(
            StepRecord(
                "enhance_contrast",
                _ms_since(start),
                {
                    "clahe_clip": cfg.clahe_clip,
                    "clahe_tile": cfg.clahe_tile,
                    "clahe_on_lab": cfg.clahe_on_lab,
                },
            )
        )

    return LabelResult(
        image=out,
        quad=quad,
        quad_method=method,
        glare=glare,
        steps=tuple(steps),
        warnings=tuple(warnings),
    )


# ---------------------------------------------------------------- 定位的內部實作


def _detect_scale(img: Image, cfg: LabelConfig) -> tuple[Image, float]:
    """縮小到定位用短邊（不放大），回傳（灰階小圖, 縮放倍率）。"""
    gray = ops.to_gray(img)
    short = min(gray.shape)
    # 已經夠小就不放大：放大不會增加資訊，只會讓像素單位的參數失去意義
    if short <= cfg.detect_short_side:
        return gray, 1.0
    # 倍率 = 小圖 / 原圖（< 1）；_locate 以此把小圖座標除回原圖座標
    return ops.resize_short_side(gray, cfg.detect_short_side), cfg.detect_short_side / short


def _edges(gray: Image, cfg: LabelConfig) -> Image:
    """高斯平滑 → Canny → 3×3 膨脹，產生定位用的 0／255 邊緣圖。"""
    # 5×5 高斯（sigma 由核心大小自動推算）先壓掉紙張紋理與 JPEG 雜訊，減少零碎邊緣
    smooth = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(smooth, cfg.canny_low, cfg.canny_high)
    # 膨脹一圈接上外框的細小斷口，讓 findContours 能得到封閉輪廓
    return np.asarray(cv2.dilate(edges, np.ones((3, 3), np.uint8)), dtype=np.uint8)


def _locate(img: Image, cfg: LabelConfig) -> tuple[Quad | None, QuadMethod | None]:
    """在縮小圖上依序嘗試輪廓法與直線法，回傳（原圖座標的四角, 方法）或 ``(None, None)``。"""
    ops.validate_image(img)
    small, factor = _detect_scale(img, cfg)
    edges = _edges(small, cfg)
    # 面積門檻以「縮小圖」的總面積換算；比例與縮放無關，因此在小圖上判斷即可
    total = small.shape[0] * small.shape[1]
    area = (cfg.min_quad_area_ratio * total, cfg.max_quad_area_ratio * total)
    found: tuple[Quad | None, QuadMethod | None] = (None, None)
    # 先試輪廓法（表格外框通常是封閉輪廓），失敗才用直線法處理外框斷裂或被遮擋的情況
    quad = _quad_from_contours(edges, cfg, area)
    if quad is not None:
        found = (quad, "contour")
    else:
        quad = _quad_from_lines(edges, cfg, area)
        if quad is not None:
            found = (quad, "hough")
    if found[0] is None:
        return found
    # 小圖座標 ÷ 倍率 = 原圖座標（factor 為 1 時不變）
    return (found[0] / np.float32(factor)).astype(np.float32), found[1]


def _quad_from_contours(edges: Image, cfg: LabelConfig, area: tuple[float, float]) -> Quad | None:
    """面積在 ``area``（最小, 最大）之間、由大到小第一個可近似成凸四邊形的輪廓。"""
    # RETR_LIST：取所有輪廓、不建階層；表格外框不一定是最外層（可能在包裝外輪廓之內）。
    # CHAIN_APPROX_SIMPLE 壓縮直線段上的點，減少記憶體，後續 approxPolyDP 也較快
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        # 已依面積遞減排序：一旦低於下限，後面的輪廓都更小，可直接結束
        if cv2.contourArea(contour) < area[0]:
            break
        # 容差與輪廓周長成正比，使判斷與輪廓大小無關；True 表示輪廓為封閉
        eps = cfg.approx_eps_ratio * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, eps, True)
        # 上限檢查用近似後的四邊形面積：排除沿畫面邊緣形成的假輪廓（見 max_quad_area_ratio）
        if (
            len(approx) == 4
            and cv2.isContourConvex(approx)
            and area[0] <= cv2.contourArea(approx) <= area[1]
        ):
            return ops.order_quad(approx)
    return None


# 共線容許距離的下限：HoughLinesP 的距離解析度 1 像素，加上邊緣圖 3×3 膨脹的寬度
_MIN_COLLINEAR_PX = 2.0

# 直線：(點, 單位方向向量)
_Line = tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]


def _quad_from_lines(edges: Image, cfg: LabelConfig, area: tuple[float, float]) -> Quad | None:
    """HoughLinesP 備援：取最外側的上、下、左、右邊線求四個交點。

    線段依方向分為近水平與近垂直兩組。每組以線段延長後在影像中心處的位置排序，
    取兩端最外側的線段，收集與它共線（端點距離在 ``cfg.hough_collinear_ratio`` 內）的所有線段
    擬合一條直線；
    只收共線者是為了不把粗外框內側的另一條邊混進來，虛線外框的各段則會被收在一起。
    """
    h, w = edges.shape
    # 參數依序：距離解析度 1 像素、角度解析度 1°、累加器票數門檻；
    # 最短線長以短邊比例換算，使門檻與（縮小後的）影像尺寸成比例
    segments = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        cfg.hough_threshold,
        minLineLength=cfg.hough_min_line_ratio * min(h, w),
        maxLineGap=cfg.hough_max_gap,
    )
    if segments is None:
        return None
    # HoughLinesP 回傳形狀 (N, 1, 4) 的 (x1, y1, x2, y2)，攤平成 (N, 4)
    segs = segments.reshape(-1, 4).astype(np.float64)
    dx, dy = segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1]
    # 傾角 ≤ 45° 歸為近水平（恰為 45° 也算水平），其餘為近垂直
    horizontal = np.abs(dx) >= np.abs(dy)
    center = np.array([w / 2, h / 2])
    tol = max(_MIN_COLLINEAR_PX, cfg.hough_collinear_ratio * min(h, w))
    # 依序收集 top、bottom（水平組）、left、right（垂直組），與下方解包的順序對應
    sides: list[_Line] = []
    # axis=1：水平線比較中心處的 y；axis=0：垂直線比較中心處的 x
    for mask, axis in ((horizontal, 1), (~horizontal, 0)):
        group = segs[mask]
        # 一個方向至少要兩條線才可能構成對邊
        if len(group) < 2:
            return None
        # 每條線段各自轉成「點＋方向」的直線，延長到影像中心比較位置，
        # 避免只看端點時，傾斜線段因所在位置不同而排錯
        lines = [_fit_line(g[None, :]) for g in group]
        pos = np.array([_coord_at(line, center, axis) for line in lines])
        if pos.max() - pos.min() < cfg.hough_min_side_gap_ratio * min(h, w):  # 只有一條邊
            return None
        # argmin 為上（或左）邊、argmax 為下（或右）邊
        for extreme in (int(np.argmin(pos)), int(np.argmax(pos))):
            # 最外側線段本身距離約為 0，因此 near 至少含一個 True，擬合不會是空集合
            near = [_distance(lines[extreme], g) <= tol for g in group]
            sides.append(_fit_line(group[np.array(near)]))
    top, bottom, left, right = sides
    # 交點順序為左上、右上、右下、左下
    pairs = ((top, left), (top, right), (bottom, right), (bottom, left))
    corners = [_intersect(a, b) for a, b in pairs]
    if any(c is None for c in corners):
        return None
    quad = ops.order_quad(np.array(corners))
    # 外框可能有一角略超出畫面（拍攝時被切到），容許少量出界；
    # 交點離畫面太遠通常代表直線方向估錯
    margin = cfg.hough_corner_margin_ratio * max(h, w)
    inside = bool(((quad >= -margin) & (quad <= np.array([w, h]) + margin)).all())
    # isContourConvex／contourArea 需要 (N, 1, 2) 的輪廓格式
    contour = quad.reshape(-1, 1, 2)
    if not inside or not cv2.isContourConvex(contour):
        return None
    if not area[0] <= cv2.contourArea(contour) <= area[1]:
        return None
    return quad


def _coord_at(line: _Line, center: npt.NDArray[np.float64], axis: int) -> float:
    """直線在影像中心處的座標：近水平線取 x = 中心時的 y（``axis=1``），近垂直線反之。"""
    p, r = line
    other = 1 - axis
    # 方向在 other 軸的分量為 0 時，直線與該軸的中心線平行、無法求交，
    # 直接回傳直線上點的座標（對近水平／近垂直的分組而言，此情況只出現在退化輸入）
    if abs(r[other]) < 1e-9:
        return float(p[axis])
    # 參數式 p + t·r：先由 other 軸解出 t，再代入求 axis 軸座標
    t = (center[other] - p[other]) / r[other]
    return float(p[axis] + t * r[axis])


def _distance(line: _Line, seg: npt.NDArray[np.float64]) -> float:
    """線段兩端點到直線的最大距離。"""
    p, r = line
    ends = seg.reshape(2, 2) - p
    # r 為單位向量，二維外積 |v × r| 即為點到直線的垂直距離
    return float(np.abs(ends[:, 0] * r[1] - ends[:, 1] * r[0]).max())


def _fit_line(segs: npt.NDArray[np.float64]) -> _Line:
    """以一或多條線段的端點最小平方擬合一條直線，回傳（直線上一點, 單位方向向量）。"""
    points = segs.reshape(-1, 2).astype(np.float32)
    # DIST_L2 為一般最小平方；param=0 讓 OpenCV 自選，0.01 為半徑與角度的精度。
    # 回傳 (vx, vy) 為單位方向向量，(x0, y0) 為直線上一點
    vx, vy, x0, y0 = cv2.fitLine(points, cv2.DIST_L2, 0, 0.01, 0.01).ravel()
    return np.array([x0, y0], dtype=np.float64), np.array([vx, vy], dtype=np.float64)


def _intersect(a: _Line, b: _Line) -> npt.NDArray[np.float64] | None:
    """兩條直線的交點；近乎平行時回傳 ``None``。"""
    (p, r), (q, s) = a, b
    # 解 p + t·r = q + u·s：以二維外積消去 u，得 t = ((q − p) × s) / (r × s)
    cross = r[0] * s[1] - r[1] * s[0]
    if abs(cross) < 1e-6:  # 平行
        return None
    t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross
    return np.asarray(p + t * r, dtype=np.float64)


def _ms_since(start: float) -> float:
    """自 ``start``（``time.perf_counter()`` 的值）起經過的毫秒數。"""
    return (time.perf_counter() - start) * 1000
