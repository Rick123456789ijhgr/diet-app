"""營養標示定位的掃描評估：合成場景的真實四角對照 ``preprocess_label`` 找到的四角（純邏輯）。

處理一律呼叫 ``dietai.preprocess.preprocess_label``；這裡只負責組合退化等級、樣本、
把真值四角換算到退化後的座標，以及判定與彙整。

判定（``judge``）：

- 找不到四邊形 → ``missed``（前處理會以原圖繼續並警告 ``LABEL_NOT_LOCATED``）
- 找到，且四角中最大的誤差不超過「真值四邊平均邊長 × 容許比例」→ ``correct``
- 找到但超過容許誤差 → ``off``：比找不到更糟，後續會把錯的區域拉正送去辨識，且沒有警告

同一批退化影像也跑品質檢查，與定位結果對照門檻（見 ``quality_alarm``）。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from enum import StrEnum
from typing import Any

import numpy as np

from dietai.devtools.degradations import Points
from dietai.preprocess import LabelConfig, QualityConfig, check_quality, preprocess_label
from dietai.preprocess.types import Image, PreprocessWarning, Quad

# 營養標示前處理自己的警告（品質檢查的警告另列）
LABEL_WARNINGS = (PreprocessWarning.LABEL_NOT_LOCATED, PreprocessWarning.GLARE_RETAKE)


class LocateOutcome(StrEnum):
    """一張影像的定位判定。"""

    CORRECT = "correct"
    OFF = "off"
    MISSED = "missed"


def corner_errors(found: Quad, truth: Points) -> list[float]:
    """四角誤差（像素），順序同 ``truth``。

    兩者都是左上起順時針，但旋轉超過 45° 時「左上」會換成另一個角；因此在四種循環對應中
    取平均誤差最小者，不因起點不同而把正確的四邊形判成錯。
    """
    f = np.asarray(found, dtype=np.float64).reshape(4, 2)
    t = np.asarray(truth, dtype=np.float64).reshape(4, 2)
    best = min(
        (np.linalg.norm(np.roll(f, k, axis=0) - t, axis=1) for k in range(4)),
        key=lambda e: float(e.mean()),
    )
    return [float(e) for e in best]


def mean_side(quad: Points) -> float:
    """四邊形四條邊的平均長度（像素），作為誤差的尺度。"""
    q = np.asarray(quad, dtype=np.float64).reshape(4, 2)
    return float(np.linalg.norm(q - np.roll(q, -1, axis=0), axis=1).mean())


def judge(found: Quad | None, truth: Points, tol: float) -> tuple[LocateOutcome, float | None]:
    """判定定位結果；回傳（判定, 最大誤差比）。找不到時誤差比為 ``None``。

    最大誤差比 = 四角中最大的誤差 ÷ 真值四邊平均邊長。
    """
    if found is None:
        return LocateOutcome.MISSED, None
    ratio = max(corner_errors(found, truth)) / mean_side(truth)
    return (LocateOutcome.CORRECT if ratio <= tol else LocateOutcome.OFF), ratio


def label_sweep(
    samples: Sequence[tuple[Image, Points]],
    degrade: Callable[[Image, float], Image],
    warp: Callable[[Points, tuple[int, ...], float], Points] | None,
    levels: Sequence[float],
    cfg: LabelConfig,
    quality: QualityConfig,
    tol: float,
) -> list[dict[str, Any]]:
    """每個（等級, 樣本）跑一次營養標示前處理與品質檢查，回傳明細列。

    ``samples`` 為（影像, 真值四角）；``warp`` 把真值四角換算到退化後的座標（不改變幾何的
    退化為 ``None``）。每列欄位：等級、樣本（索引）、判定（``LocateOutcome`` 的值）、
    最大誤差比（找不到為 ``None``）、方法（輪廓／直線，找不到為空字串）、標示警告、
    品質通過、品質警告。
    """
    rows: list[dict[str, Any]] = []
    for level in levels:
        for i, (sample, quad) in enumerate(samples):
            img = degrade(sample, level)
            truth = warp(quad, sample.shape, level) if warp else quad
            result = preprocess_label(img, cfg)
            outcome, ratio = judge(result.quad, truth, tol)
            q = check_quality(img, quality)
            rows.append(
                {
                    "等級": level,
                    "樣本": i,
                    "判定": outcome.value,
                    "最大誤差比": ratio,
                    "方法": result.quad_method or "",
                    "標示警告": [w.value for w in result.warnings],
                    "品質通過": q.passed,
                    "品質警告": [w.value for w in q.warnings],
                }
            )
    return rows


def _by_level(rows: Sequence[dict[str, Any]]) -> dict[float, list[dict[str, Any]]]:
    by_level: dict[float, list[dict[str, Any]]] = {}
    for row in rows:
        by_level.setdefault(row["等級"], []).append(row)
    return by_level


def level_rates(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """依等級彙整：成功率、偏移率（``off``）、誤差比中位數（只計找到的樣本，都沒找到為 ``None``），
    以及各標示警告的出現比例。"""
    out: list[dict[str, Any]] = []
    for level, group in _by_level(rows).items():
        ratios = [r["最大誤差比"] for r in group if r["最大誤差比"] is not None]
        out.append(
            {
                "等級": level,
                "成功率": sum(r["判定"] == LocateOutcome.CORRECT for r in group) / len(group),
                "偏移率": sum(r["判定"] == LocateOutcome.OFF for r in group) / len(group),
                "誤差比中位數": float(np.median(ratios)) if ratios else None,
                "警告比例": {
                    w.value: sum(w.value in r["標示警告"] for r in group) / len(group)
                    for w in LABEL_WARNINGS
                },
            }
        )
    return out


def overall(rows: Sequence[dict[str, Any]], outcome: LocateOutcome) -> float:
    """所有等級與樣本中判定為 ``outcome`` 的比例；沒有資料時為 0。"""
    return sum(r["判定"] == outcome for r in rows) / len(rows) if rows else 0.0


def first_failure(rows: Sequence[dict[str, Any]]) -> float | None:
    """成功率首次低於 100% 的等級（依等級排序）；全部成功則回傳 ``None``。"""
    for rate in sorted(level_rates(rows), key=lambda r: r["等級"]):
        if rate["成功率"] < 1:
            return float(rate["等級"])
    return None
