"""實驗分析用的統計方法（只用標準函式庫，結果可重現、不需隨機種子）。"""

from __future__ import annotations

import math
from collections.abc import Sequence


def wilson_interval(successes: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    """二項比例的 Wilson 信賴區間（預設 95%）。

    比常態近似適合小樣本與接近 0／1 的比例。``n`` 為 0 時回傳 ``(0.0, 1.0)``。
    """
    if not 0 <= successes <= n:
        raise ValueError(f"須滿足 0 <= successes <= n，收到 {successes}、{n}")
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def mcnemar_exact(b: int, c: int) -> float:
    """配對二元結果的 McNemar 精確檢定（雙尾 p 值）。

    ``b`` 為「基準成功、比較組失敗」的樣本數，``c`` 為相反情形；兩者皆為 0 時回傳 1。
    同一批影像比較兩組設定時使用，比兩個獨立比例的檢定更有檢定力。
    """
    if b < 0 or c < 0:
        raise ValueError(f"b、c 不得為負，收到 {b}、{c}")
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, i) for i in range(min(b, c) + 1)) / (1 << n)
    return min(1.0, 2 * tail)


def paired_counts(baseline: Sequence[bool], other: Sequence[bool]) -> tuple[int, int]:
    """配對結果中（基準成功且比較組失敗, 基準失敗且比較組成功）的數量。"""
    if len(baseline) != len(other):
        raise ValueError("配對的兩組長度必須相同")
    b = sum(x and not y for x, y in zip(baseline, other, strict=True))
    c = sum(y and not x for x, y in zip(baseline, other, strict=True))
    return b, c
