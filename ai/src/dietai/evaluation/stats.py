"""實驗分析用的統計方法（只用標準函式庫）。

Wilson、McNemar 為封閉解，不需隨機種子；集群 bootstrap 與置換檢定接受 ``seed``，結果可重現。
同一原始樣本的變體高度相關，信賴區間與檢定應以原始樣本（集群）為單位（ADR 0005 第 9 點）。
"""

from __future__ import annotations

import math
import random
from collections.abc import Sequence
from dataclasses import dataclass


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


@dataclass(frozen=True)
class ClusterComparison:
    """``cluster_bootstrap_diff`` 的結果。

    ``diff`` 為比較組成功率減基準成功率（所有配對合併計算）；``ci_low``／``ci_high`` 為
    集群 bootstrap 的百分位信賴區間；``p_value`` 為集群符號翻轉置換檢定的雙尾 p 值。
    """

    n_clusters: int
    n_pairs: int
    rate_baseline: float
    rate_other: float
    diff: float
    ci_low: float
    ci_high: float
    p_value: float


def cluster_bootstrap_diff(
    clusters: Sequence[Sequence[tuple[bool, bool]]],
    *,
    n_boot: int = 5000,
    level: float = 0.95,
    seed: int = 0,
) -> ClusterComparison:
    """以集群（原始樣本）為單位比較配對的兩組成功率。

    ``clusters`` 每個元素為一個原始樣本的所有配對（基準是否成功, 比較組是否成功），
    例如同一產品的各個劣化變體。空的集群會被忽略；沒有任何配對時丟 ``ValueError``。

    - 信賴區間：有放回地重抽 ``n_clusters`` 個集群（連同其所有配對），計算合併後的成功率差異，
      取 ``level`` 的百分位區間。
    - p 值：虛無假設為兩組可互換；每次隨機翻轉整個集群的兩組標籤（等於把該集群的差異變號），
      以 ``|Σ 差異|`` 為統計量，p = (1 + 不小於觀察值的次數) / (1 + ``n_boot``)。
      以集群為單位翻轉，變體間的相關不會讓 p 值偏小。
    """
    if n_boot < 1 or not 0 < level < 1:
        raise ValueError("須滿足 n_boot ≥ 1、0 < level < 1")
    # 每個集群只需要（配對數, 基準成功數, 比較組成功數），重抽時不必再走訪每個配對
    sums = [(len(c), sum(b for b, _ in c), sum(o for _, o in c)) for c in clusters if len(c) > 0]
    if not sums:
        raise ValueError("沒有任何配對")
    n = sum(s[0] for s in sums)
    kb = sum(s[1] for s in sums)
    ko = sum(s[2] for s in sums)
    rng = random.Random(seed)
    m = len(sums)

    diffs: list[float] = []
    for _ in range(n_boot):
        sample = [sums[rng.randrange(m)] for _ in range(m)]
        sn = sum(s[0] for s in sample)
        diffs.append((sum(s[2] for s in sample) - sum(s[1] for s in sample)) / sn)
    diffs.sort()
    alpha = (1 - level) / 2
    lo = diffs[min(n_boot - 1, int(alpha * n_boot))]
    hi = diffs[min(n_boot - 1, max(0, math.ceil((1 - alpha) * n_boot) - 1))]

    # 各集群的差異（比較組成功數 − 基準成功數）；翻轉標籤 = 差異變號
    d = [s[2] - s[1] for s in sums]
    observed = abs(sum(d))
    extreme = sum(
        abs(sum(x if rng.random() < 0.5 else -x for x in d)) >= observed for _ in range(n_boot)
    )
    return ClusterComparison(
        n_clusters=m,
        n_pairs=n,
        rate_baseline=kb / n,
        rate_other=ko / n,
        diff=(ko - kb) / n,
        ci_low=lo,
        ci_high=hi,
        p_value=(1 + extreme) / (1 + n_boot),
    )


def holm(p_values: Sequence[float]) -> list[float]:
    """Holm 逐步校正後的 p 值（依原順序回傳）。

    由小到大排序後第 i 個（從 0 起算）乘以 (m − i)，再取累計最大值使結果單調，上限為 1。
    控制整體型一錯誤率，比 Bonferroni 有檢定力，且不需假設檢定之間獨立。
    """
    if any(not 0 <= p <= 1 for p in p_values):
        raise ValueError("p 值須介於 0 與 1")
    m = len(p_values)
    order = sorted(range(m), key=lambda i: p_values[i])
    adjusted = [0.0] * m
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * p_values[i]))
        adjusted[i] = running
    return adjusted
