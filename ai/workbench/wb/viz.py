"""前處理的視覺化。數值一律取自 ``dietai.preprocess`` 的結果與中間結果，不另行計算。"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import cv2
import numpy as np

from dietai.preprocess import DecodeHit, QualityConfig, QualityReport, RungAttempt
from dietai.preprocess.ops import to_gray
from dietai.preprocess.quality import exposure_masks, laplacian_map
from dietai.preprocess.types import Image

# BGR
DARK_COLOR = (255, 80, 0)
BRIGHT_COLOR = (0, 0, 255)
HIT_COLORS = ((40, 180, 40), (230, 120, 0), (0, 140, 255))


def laplacian_heatmap(img: Image, cfg: QualityConfig) -> Image:
    """拉普拉斯響應強度熱度圖（BGR）。以第 99 百分位正規化，避免少數強邊緣壓暗整張圖。"""
    mag = np.abs(laplacian_map(img, cfg))
    top = float(np.percentile(mag, 99)) or 1.0
    norm = np.clip(mag / top * 255, 0, 255).astype(np.uint8)
    return np.asarray(cv2.applyColorMap(norm, cv2.COLORMAP_INFERNO), dtype=np.uint8)


def exposure_overlay(img: Image, cfg: QualityConfig, alpha: float = 0.6) -> Image:
    """在原圖上以藍色標出過暗、紅色標出過亮像素（BGR）。"""
    dark, bright = exposure_masks(img, cfg)
    base = img if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    out = base.astype(np.float32)
    for mask, color in ((dark, DARK_COLOR), (bright, BRIGHT_COLOR)):
        out[mask] = out[mask] * (1 - alpha) + np.array(color, dtype=np.float32) * alpha
    return out.astype(np.uint8)


def gray_histogram(img: Image) -> list[dict[str, int]]:
    """灰階直方圖（0–255 每一階的像素數）。"""
    counts = np.bincount(to_gray(img).ravel(), minlength=256)
    return [{"灰階": i, "像素數": int(c)} for i, c in enumerate(counts)]


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
    return [
        {
            "步驟": s.name,
            "耗時（ms）": round(s.elapsed_ms, 3),
            "參數": ", ".join(f"{k}={v}" for k, v in s.params.items()),
        }
        for s in report.steps
    ]


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
