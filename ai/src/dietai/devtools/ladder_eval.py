"""條碼逐步升級的掃描評估：比較「只用原圖」與完整階梯對真值的結果（純邏輯）。

解碼一律呼叫 ``dietai.preprocess.decode_with_ladder``，判定沿用 E1 的
``dietai.evaluation.barcode.judge``（正確／誤讀／漏讀）；這裡只負責組合退化等級、
樣本與彙整。成功率只計「正確」：誤讀雖然解出了號碼，但號碼是錯的，不算成功。

同一批退化影像也跑一次品質檢查，與逐步升級的結果對照門檻（見 ``quality_alarm``）。
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import replace
from typing import Any

from dietai.evaluation.barcode import Outcome, first_rung, judge
from dietai.preprocess import (
    Decoder,
    LadderConfig,
    QualityConfig,
    Rung,
    check_quality,
    decode_with_ladder,
)
from dietai.preprocess.types import Image

# 明細列以中文為鍵；給前端的 JSON 由 sweep.barcode_sweep 轉成英文鍵（raw／ladder）
RAW = "只用原圖"
LADDER = "逐步升級"
METHODS = (RAW, LADDER)


def ladder_sweep(
    samples: Sequence[Image],
    truths: Sequence[str],
    degrade: Callable[[Image, float], Image],
    levels: Sequence[float],
    decoder: Decoder,
    cfg: LadderConfig,
    quality: QualityConfig,
) -> list[dict[str, Any]]:
    """每個（等級, 樣本）各跑一次只用原圖、完整階梯與品質檢查，回傳明細列。

    每列欄位：等級、樣本（索引）、真值、只用原圖與逐步升級（``Outcome`` 的值）、
    解出內容（逐步升級採用的號碼，以「|」串接）、成功階（逐步升級第一次解出採用內容的階，
    正確與誤讀都填，漏讀為空字串）、嘗試次數、品質通過（bool）、品質警告（代碼串列）。
    """
    if len(samples) != len(truths):
        raise ValueError(f"樣本數 {len(samples)} 與真值數 {len(truths)} 不一致")
    # 對照組只保留 raw 階、其餘設定相同，兩者的差異就只在「有沒有逐步升級」
    raw_cfg = replace(cfg, rungs=(Rung.RAW,))
    rows: list[dict[str, Any]] = []
    for level in levels:
        for i, (sample, truth) in enumerate(zip(samples, truths, strict=True)):
            # 同一張退化影像同時餵給兩種方法與品質檢查，比較才公平
            img = degrade(sample, level)
            raw = decode_with_ladder(img, decoder, raw_cfg)
            full = decode_with_ladder(img, decoder, cfg)
            q = check_quality(img, quality)
            rung = first_rung(full)
            rows.append(
                {
                    "等級": level,
                    "樣本": i,
                    "真值": truth,
                    RAW: judge(raw, truth).value,
                    LADDER: judge(full, truth).value,
                    "解出內容": "|".join(h.text for h in full.hits),
                    "成功階": rung.value if rung else "",
                    "嘗試次數": len(full.attempts),
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


def _rate(group: Sequence[dict[str, Any]], method: str, outcome: Outcome) -> float:
    return sum(r[method] == outcome for r in group) / len(group) if group else 0.0


def success_rates(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """依等級彙整，回傳長表格（等級、方法、成功率、誤讀率），供折線圖使用。"""
    out: list[dict[str, Any]] = []
    for level, group in _by_level(rows).items():
        for method in METHODS:
            out.append(
                {
                    "等級": level,
                    "方法": method,
                    "成功率": _rate(group, method, Outcome.CORRECT),
                    "誤讀率": _rate(group, method, Outcome.MISREAD),
                }
            )
    return out


def rung_counts(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """依等級統計完整階梯正確解出於哪一階，回傳長表格（等級、階、次數）。

    只計正確：誤讀雖然也有成功階，但不算「救回」（與 E1 的 ``rescue_counts`` 相同）。
    """
    counts: Counter[tuple[float, str]] = Counter(
        (r["等級"], r["成功階"]) for r in rows if r[LADDER] == Outcome.CORRECT
    )
    return [{"等級": level, "階": rung, "次數": n} for (level, rung), n in counts.items()]


def overall(
    rows: Sequence[dict[str, Any]], method: str, outcome: Outcome = Outcome.CORRECT
) -> float:
    """所有等級與樣本中判定為 ``outcome`` 的比例；沒有資料時為 0。"""
    return _rate(rows, method, outcome)


def first_failure(rows: Sequence[dict[str, Any]], method: str) -> float | None:
    """成功率首次低於 100% 的等級（依等級排序）；全部成功則回傳 ``None``。"""
    for rate in sorted(success_rates(rows), key=lambda r: r["等級"]):
        if rate["方法"] == method and rate["成功率"] < 1:
            return float(rate["等級"])
    return None
