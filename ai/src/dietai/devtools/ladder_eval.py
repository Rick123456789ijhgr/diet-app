"""條碼逐步升級的掃描評估：比較「只用原圖」與完整階梯的成功率（純邏輯）。

解碼一律呼叫 ``dietai.preprocess.decode_with_ladder``；這裡只負責組合退化等級、
樣本與彙整成功率。
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import replace
from typing import Any

from dietai.preprocess import Decoder, LadderConfig, Rung, decode_with_ladder
from dietai.preprocess.types import Image

# 明細列以中文為鍵；給前端的 JSON 由 sweep.barcode_sweep 轉成英文鍵（raw／ladder）
RAW = "只用原圖"
LADDER = "逐步升級"


def ladder_sweep(
    samples: Sequence[Image],
    degrade: Callable[[Image, float], Image],
    levels: Sequence[float],
    decoder: Decoder,
    cfg: LadderConfig,
) -> list[dict[str, Any]]:
    """每個（等級, 樣本）各跑一次只用原圖與完整階梯，回傳明細列。

    每列欄位：等級、樣本（索引）、只用原圖（bool）、逐步升級（bool）、
    成功階（階的代碼，失敗為空字串）、嘗試次數。
    """
    # 對照組只保留 raw 階、其餘設定相同，兩者的差異就只在「有沒有逐步升級」
    raw_cfg = replace(cfg, rungs=(Rung.RAW,))
    rows: list[dict[str, Any]] = []
    for level in levels:
        for i, sample in enumerate(samples):
            # 同一張退化影像同時餵給兩種方法，比較才公平
            img = degrade(sample, level)
            raw = decode_with_ladder(img, decoder, raw_cfg)
            full = decode_with_ladder(img, decoder, cfg)
            rows.append(
                {
                    "等級": level,
                    "樣本": i,
                    RAW: raw.success,
                    LADDER: full.success,
                    "成功階": full.success_rung.value if full.success_rung else "",
                    "嘗試次數": len(full.attempts),
                }
            )
    return rows


def success_rates(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """依等級彙整成功率，回傳長表格（等級、方法、成功率），供折線圖使用。"""
    by_level: dict[float, list[dict[str, Any]]] = {}
    for row in rows:
        by_level.setdefault(row["等級"], []).append(row)
    out: list[dict[str, Any]] = []
    for level, group in by_level.items():
        for method in (RAW, LADDER):
            rate = sum(bool(r[method]) for r in group) / len(group)
            out.append({"等級": level, "方法": method, "成功率": rate})
    return out


def rung_counts(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """依等級統計完整階梯成功於哪一階（失敗者不列），回傳長表格（等級、階、次數）。"""
    counts: Counter[tuple[float, str]] = Counter(
        (r["等級"], r["成功階"]) for r in rows if r["成功階"]
    )
    return [{"等級": level, "階": rung, "次數": n} for (level, rung), n in counts.items()]


def overall(rows: Sequence[dict[str, Any]], method: str) -> float:
    """所有等級與樣本的整體成功率；沒有資料時為 0。"""
    return sum(bool(r[method]) for r in rows) / len(rows) if rows else 0.0


def first_failure(rows: Sequence[dict[str, Any]], method: str) -> float | None:
    """成功率首次低於 100% 的等級（依等級排序）；全部成功則回傳 ``None``。"""
    for rate in sorted(success_rates(rows), key=lambda r: r["等級"]):
        if rate["方法"] == method and rate["成功率"] < 1:
            return float(rate["等級"])
    return None
