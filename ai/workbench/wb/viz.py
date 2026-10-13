"""前處理的視覺化。數值一律取自 ``dietai.preprocess`` 的結果與中間結果，不另行計算。"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import cv2
import numpy as np
import numpy.typing as npt

from dietai.devtools.views import gray_histogram_counts
from dietai.preprocess import (
    DecodeHit,
    QualityReport,
    RungAttempt,
    resize_for_vlm,
)
from dietai.preprocess.types import Box, Ellipse, Image, Quad

# BGR
HIT_COLORS = ((211, 38, 192), (230, 120, 0), (212, 182, 6))  # 紫、藍、青
FOUND_COLOR = (211, 38, 192)  # 紫：程式找到的結果
TRUTH_COLOR = (230, 120, 0)  # 藍：合成影像的真值
GLARE_COLOR = (0, 0, 255)


def gray_histogram(img: Image) -> list[dict[str, int]]:
    """灰階直方圖（0–255 每一階的像素數），欄位名稱供 Altair 使用。"""
    return [{"灰階": i, "像素數": c} for i, c in enumerate(gray_histogram_counts(img))]


def report_metrics(report: QualityReport) -> dict[str, Any]:
    """把報告攤平成一列，供批次表格使用。"""
    return {
        "模糊分數": round(report.blur_score, 2),
        "平均亮度": round(report.exposure.mean, 2),
        "過暗比例": round(report.exposure.dark_ratio, 4),
        "過亮比例": round(report.exposure.bright_ratio, 4),
        "解析度通過": report.resolution_ok,
        "通過": report.passed,
        "警告": ", ".join(w.value for w in report.warnings),
    }


def steps_rows(report: QualityReport) -> list[dict[str, Any]]:
    return step_rows(report.steps)


def draw_hits(img: Image, hits: Sequence[DecodeHit], labels: Sequence[str] | None = None) -> Image:
    """在影像上畫出每筆解碼結果的四角框與標籤（BGR）。左上角以實心圓標示方向。"""
    out = img.copy() if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    thickness = max(2, round(min(out.shape[:2]) / 250))
    for i, hit in enumerate(hits):
        color = HIT_COLORS[i % len(HIT_COLORS)]
        pts = np.array(hit.corners, dtype=np.float64).round().astype(np.int32)
        cv2.polylines(out, [pts], isClosed=True, color=color, thickness=thickness)
        cv2.circle(out, (int(pts[0][0]), int(pts[0][1])), thickness * 3, color, -1)
        text = labels[i] if labels is not None else hit.format.value
        x, y = int(pts[:, 0].min()), max(20, int(pts[:, 1].min()) - 8)
        cv2.putText(out, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, thickness / 3, color, thickness)
    return np.asarray(out, dtype=np.uint8)


def hex_preview(raw: bytes, limit: int = 48) -> str:
    """位元組的十六進位預覽，例如「41 42 FF …（共 80 bytes）」。"""
    head = " ".join(f"{b:02X}" for b in raw[:limit])
    return head + (f" …（共 {len(raw)} bytes）" if len(raw) > limit else "")


def ascii_preview(raw: bytes) -> str:
    """只顯示可列印的 ASCII，其他位元組以「·」表示（工作台不做中文解碼，由 Go 負責）。"""
    return "".join(chr(b) if 0x20 <= b < 0x7F else "·" for b in raw)


def hit_rows(hits: Sequence[DecodeHit]) -> list[dict[str, Any]]:
    return [
        {
            "格式": h.format.value,
            "文字": h.text,
            "位元組": len(h.raw),
            "中心": f"({h.center[0]:.0f}, {h.center[1]:.0f})",
            "面積": round(h.area),
        }
        for h in hits
    ]


def attempt_rows(
    attempts: Sequence[RungAttempt], rung_text: dict[str, str]
) -> list[dict[str, Any]]:
    """把階梯的嘗試紀錄攤平成表格列；``rung_text`` 為階代碼到顯示文字的對照。"""
    rows: list[dict[str, Any]] = []
    for i, a in enumerate(attempts):
        if a.skipped:
            status = "略過"
        elif a.hits:
            status = "成功"
        elif a.rejected:
            status = "檢查碼錯誤"
        else:
            status = "失敗"
        rows.append(
            {
                "#": i + 1,
                "階": rung_text.get(a.rung.value, a.rung.value),
                "結果": status,
                "找到": len(a.hits),
                "耗時（ms）": round(a.elapsed_ms, 2),
                "參數": ", ".join(f"{k}={v}" for k, v in a.params.items()),
            }
        )
    return rows


def draw_quads(img: Image, quads: Sequence[tuple[Quad, tuple[int, int, int], str]]) -> Image:
    """畫出四邊形（BGR）：每筆為（四角, 顏色, 標籤）。左上角以實心圓標示，四角以小圓點標示。"""
    out = img.copy() if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    thickness = max(2, round(min(out.shape[:2]) / 300))
    for n, (quad, color, text) in enumerate(quads):
        pts = np.asarray(quad, dtype=np.float64).round().astype(np.int32)
        cv2.polylines(out, [pts], isClosed=True, color=color, thickness=thickness)
        for i, (x, y) in enumerate(pts):
            cv2.circle(out, (int(x), int(y)), thickness * (3 if i == 0 else 2), color, -1)
        # 多個四邊形的左上角常重疊，標籤依序往上錯開
        x, y = int(pts[0][0]), max(20, int(pts[0][1]) - 10 - n * thickness * 12)
        cv2.putText(out, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, thickness / 3, color, thickness)
    return np.asarray(out, dtype=np.uint8)


def mask_overlay(img: Image, mask: npt.NDArray[np.bool_], alpha: float = 0.6) -> Image:
    """以紅色標出遮罩區域（BGR），例如光斑遮罩。"""
    base = img if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    out = base.astype(np.float32)
    color = np.array(GLARE_COLOR, dtype=np.float32)
    out[mask] = out[mask] * (1 - alpha) + color * alpha
    return out.astype(np.uint8)


def quad_errors(found: Quad, truth: Quad) -> list[float]:
    """四角各自的誤差（像素），順序為左上、右上、右下、左下。"""
    return [float(d) for d in np.linalg.norm(np.asarray(found) - np.asarray(truth), axis=1)]


def step_rows(steps: Sequence[Any]) -> list[dict[str, Any]]:
    """``StepRecord`` 序列攤平成表格列。"""
    return [
        {
            "步驟": s.name,
            "耗時（ms）": round(s.elapsed_ms, 3),
            "參數": ", ".join(f"{k}={v}" for k, v in s.params.items()),
        }
        for s in steps
    ]


def draw_boxes(img: Image, boxes: Sequence[tuple[Box, tuple[int, int, int], str]]) -> Image:
    """畫出矩形框（BGR）：每筆為（框, 顏色, 標籤）。標籤寫在框的左上角內側。"""
    out = img.copy() if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    thickness = max(2, round(min(out.shape[:2]) / 300))
    for box, color, text in boxes:
        cv2.rectangle(out, (box.x, box.y), (box.x1 - 1, box.y1 - 1), color, thickness)
        if text:
            org = (box.x + 2 * thickness, box.y + 12 * thickness)
            cv2.putText(out, text, org, cv2.FONT_HERSHEY_SIMPLEX, thickness / 2.5, color, thickness)
    return np.asarray(out, dtype=np.uint8)


def draw_ellipses(img: Image, ellipses: Sequence[tuple[Ellipse, tuple[int, int, int]]]) -> Image:
    """畫出橢圓與中心點（BGR）：每筆為（橢圓, 顏色）。"""
    out = img.copy() if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    thickness = max(2, round(min(out.shape[:2]) / 300))
    for e, color in ellipses:
        center = (round(e.cx), round(e.cy))
        axes = (round(e.major / 2), round(e.minor / 2))
        cv2.ellipse(out, center, axes, e.angle, 0, 360, color, thickness, cv2.LINE_AA)
        cv2.circle(out, center, thickness * 2, color, -1)
    return np.asarray(out, dtype=np.uint8)


def mask_on_small(img: Image, mask: npt.NDArray[np.bool_]) -> Image:
    """把縮小後算出的遮罩（如 ``food.dish_foreground``）疊在同尺寸的縮圖上（BGR）。"""
    h, w = mask.shape
    small = (
        img if img.shape[:2] == (h, w) else cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
    )
    return mask_overlay(np.asarray(small, dtype=np.uint8), mask)


def vlm_size_rows(img: Image, sides: Sequence[int], jpeg_quality: int) -> list[dict[str, Any]]:
    """不同 VLM 長邊下的輸出尺寸與 JPEG 大小（E2 的事前試算），全部由 ``resize_for_vlm`` 計算。"""
    rows: list[dict[str, Any]] = []
    for side in sides:
        out = resize_for_vlm(img, side, jpeg_quality)
        h, w = out.image.shape[:2]
        rows.append(
            {
                "長邊上限": side,
                "輸出尺寸": f"{w}×{h}",
                "JPEG（KB）": round(out.num_bytes / 1024, 1),
                "像素數（MP）": round(w * h / 1e6, 2),
            }
        )
    return rows
