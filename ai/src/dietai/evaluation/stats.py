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
        return (0.0, 1.0)  # 沒有樣本時不提供任何資訊，回傳整個 [0, 1]
    # Wilson score 區間：解 |p̂ − p| ≤ z·√(p(1−p)/n) 得到的 p 範圍，
    #   center = (p̂ + z²/2n) / (1 + z²/n)
    #   half   = z·√(p̂(1−p̂)/n + z²/4n²) / (1 + z²/n)
    # 中心會往 0.5 收縮，因此 p̂ 為 0 或 1 時區間寬度不為 0（常態近似會退化成單點）。
    # z = 1.959964 為標準常態的 97.5% 分位數，對應雙尾 95%。
    p = successes / n
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    # 理論上已落在 [0, 1] 內；截斷只是防止浮點誤差略微超出
    return (max(0.0, center - half), min(1.0, center + half))


def mcnemar_exact(b: int, c: int) -> float:
    """配對二元結果的 McNemar 精確檢定（雙尾 p 值）。

    ``b`` 為「基準成功、比較組失敗」的樣本數，``c`` 為相反情形；兩者皆為 0 時回傳 1。
    同一批影像比較兩組設定時使用，比兩個獨立比例的檢定更有檢定力。
    """
    if b < 0 or c < 0:
        raise ValueError(f"b、c 不得為負，收到 {b}、{c}")
    # 只有不一致的配對（b + c 筆）帶有差異資訊；兩組都對或都錯的影像不影響檢定。
    # 虛無假設「兩組成功率相同」下，每筆不一致配對落在 b 或 c 的機率各 1/2，
    # 即 b ~ Binomial(b + c, 0.5)；取 min(b, c) 那一側的累積機率乘 2 得雙尾 p 值。
    # 使用精確二項分布而非卡方近似，b + c 很小（常見於少量影像）時仍有效。
    n = b + c
    if n == 0:
        return 1.0  # 沒有不一致的配對，無從判斷差異
    # 以整數計算組合數再除以 2^n（1 << n），避免浮點累加誤差
    tail = sum(math.comb(n, i) for i in range(min(b, c) + 1)) / (1 << n)
    # b == c 時兩側的尾機率重疊（中央項被算兩次），2 × tail 會超過 1，截斷為 1
    return min(1.0, 2 * tail)


def paired_counts(baseline: Sequence[bool], other: Sequence[bool]) -> tuple[int, int]:
    """配對結果中（基準成功且比較組失敗, 基準失敗且比較組成功）的數量。"""
    if len(baseline) != len(other):
        raise ValueError("配對的兩組長度必須相同")
    # 兩個序列須依同一順序對應同一批影像（呼叫端負責依 id 對齊）
    b = sum(x and not y for x, y in zip(baseline, other, strict=True))
    c = sum(y and not x for x, y in zip(baseline, other, strict=True))
    return b, c
