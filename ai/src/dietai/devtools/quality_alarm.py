"""品質門檻與處理結果的對照（純邏輯；條碼與營養標示的參數掃描共用）。

掃描的每一列是一張退化影像，帶「品質通過」（bool）與「品質警告」（代碼串列），
另由呼叫端以 ``correct(列)`` 說明該列的處理結果是否正確（條碼讀對、標示四角在容許誤差內）。

品質檢查不通過（會請使用者重拍）而處理其實正確是「誤報」；品質檢查通過而處理不正確是「漏報」。
前處理定案後，門檻應落在兩者都低的位置。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from dietai.preprocess.quality import QUALITY_WARNINGS

Row = dict[str, Any]

# alarm_counts 的中文鍵 → 給前端的 JSON 英文鍵
ALARM_KEYS = {"該重拍": "retake", "誤報": "false_alarm", "漏報": "missed_alarm", "正常": "ok"}


def _by_level(rows: Sequence[Row]) -> dict[float, list[Row]]:
    by_level: dict[float, list[Row]] = {}
    for row in rows:
        by_level.setdefault(row["等級"], []).append(row)
    return by_level


def quality_rates(rows: Sequence[Row]) -> list[Row]:
    """依等級彙整品質檢查不通過的比例，回傳長表格（等級、不通過率）。"""
    return [
        {"等級": level, "不通過率": sum(not r["品質通過"] for r in group) / len(group)}
        for level, group in _by_level(rows).items()
    ]


def quality_triggers(rows: Sequence[Row]) -> dict[str, float | None]:
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


def alarm_counts(rows: Sequence[Row], correct: Callable[[Row], bool]) -> dict[str, int]:
    """品質檢查與處理結果的對照（四格）。

    - 該重拍：品質不通過，且處理結果不正確
    - 誤報：品質不通過，但處理結果其實正確（不必要地請使用者重拍）
    - 漏報：品質通過，但處理結果不正確
    - 正常：品質通過，處理結果正確
    """
    counts = dict.fromkeys(ALARM_KEYS, 0)
    for r in rows:
        ok = correct(r)
        if r["品質通過"]:
            counts["正常" if ok else "漏報"] += 1
        else:
            counts["誤報" if ok else "該重拍"] += 1
    return counts


def summary_json(rows: Sequence[Row], correct: Callable[[Row], bool]) -> dict[str, Any]:
    """給前端的品質對照欄位（英文鍵）：``quality_rates``、``quality_triggers``、``alarms``。"""
    return {
        "quality_rates": [{"level": r["等級"], "rate": r["不通過率"]} for r in quality_rates(rows)],
        "quality_triggers": quality_triggers(rows),
        "alarms": {ALARM_KEYS[k]: v for k, v in alarm_counts(rows, correct).items()},
    }
