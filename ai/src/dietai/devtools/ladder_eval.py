"""條碼逐步升級的掃描評估：比較「只用原圖」與完整階梯對真值的結果（純邏輯）。

解碼一律呼叫 ``dietai.preprocess.decode_with_ladder``，判定沿用 E1 的
``dietai.evaluation.barcode.judge``（正確／誤讀／漏讀）；這裡只負責組合退化等級、
樣本與彙整。成功率只計「正確」：誤讀雖然解出了號碼，但號碼是錯的，不算成功。

同一批退化影像也跑一次品質檢查，用來比對門檻：品質檢查不通過（會請使用者重拍）而階梯
其實讀對了是「誤報」；品質檢查通過而階梯讀不對是「漏報」。前處理定案後，門檻應落在
兩者都低的位置。
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
from dietai.preprocess.quality import QUALITY_WARNINGS
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


def quality_rates(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """依等級彙整品質檢查不通過的比例，回傳長表格（等級、不通過率）。"""
    return [
        {"等級": level, "不通過率": sum(not r["品質通過"] for r in group) / len(group)}
        for level, group in _by_level(rows).items()
    ]


def quality_triggers(rows: Sequence[dict[str, Any]]) -> dict[str, float | None]:
    """各品質警告首次在「至少半數樣本」出現的等級；整個範圍都沒有則為 ``None``。

    以半數為準而不是「任一樣本」：單一樣本的偶發警告不代表門檻落在這裡。
    每個品質警告代碼都列出，前端的欄位因此固定。
    """
    by_level = sorted(_by_level(rows).items())
    out: dict[str, float | None] = {}
    for code in QUALITY_WARNINGS:
        out[code.value] = next(
            (
                float(level)
                for level, group in by_level
                if 2 * sum(code.value in r["品質警告"] for r in group) >= len(group)
            ),
            None,
        )
    return out


def alarm_counts(rows: Sequence[dict[str, Any]]) -> dict[str, int]:
    """品質檢查與逐步升級結果的對照（四格）。

    - 該重拍：品質不通過，且逐步升級讀不對（漏讀或誤讀）
    - 誤報：品質不通過，但逐步升級其實讀對了（不必要地請使用者重拍）
    - 漏報：品質通過，但逐步升級讀不對
    - 正常：品質通過，逐步升級讀對
    """
    counts = {"該重拍": 0, "誤報": 0, "漏報": 0, "正常": 0}
    for r in rows:
        correct = r[LADDER] == Outcome.CORRECT
        if r["品質通過"]:
            counts["正常" if correct else "漏報"] += 1
        else:
            counts["誤報" if correct else "該重拍"] += 1
    return counts
