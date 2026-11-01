"""參數掃描：一種退化由弱到強，觀察品質檢查的指標，或條碼解碼、營養標示定位對真值的結果如何變化。

回傳可直接序列化成 JSON 的字典（英文鍵），另附幾個等級的縮圖供介面顯示。
解碼與檢查一律呼叫 ``dietai.preprocess``；成功率彙整沿用 ``ladder_eval``。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np

from dietai.devtools import label_eval, ladder_eval, quality_alarm
from dietai.devtools.degradations import SWEEP_AXES, SweepAxis, first_trigger, sweep_levels
from dietai.devtools.scenes import SceneError
from dietai.evaluation.barcode import Outcome
from dietai.preprocess import (
    LabelConfig,
    LadderConfig,
    QualityConfig,
    ZxingConfig,
    ZxingDecoder,
    check_quality,
)
from dietai.preprocess.ops import resize_short_side
from dietai.preprocess.quality import QUALITY_WARNINGS
from dietai.preprocess.types import Image
from dietai.synthetic import ean13_codes, ean13_scene, label_perspective_scene

THUMB_SHORT_SIDE = 200  # 縮圖短邊（像素）
# 點數與樣本數上限：條碼掃描的解碼次數約為「點數 × 樣本數 × 2（原圖＋完整階梯）」，
# 限制單次請求的運算量
MAX_POINTS = 30
MAX_SAMPLES = 30
# 營養標示掃描的合成場景尺寸（高, 寬）與基本透視強度；比預設 1080×1440 小，單次掃描較快
LABEL_SCENE_SIZE = (720, 960)
LABEL_SCENE_STRENGTH = 0.15
# 定位容許誤差（最大四角誤差 ÷ 真值平均邊長）的預設值與範圍
TOL_DEFAULT = 0.03
TOL_RANGE = (0.005, 0.2)


@dataclass(frozen=True)
class Thumb:
    """某個等級的退化縮圖。"""

    level: float
    image: Image


@dataclass(frozen=True)
class SweepResult:
    """掃描結果：``data`` 可直接序列化成 JSON；``thumbs`` 由 server 存進暫存區後換成 ID。"""

    data: dict[str, Any]
    thumbs: list[Thumb]


@dataclass(frozen=True)
class Axis:
    """解析後的掃描維度：退化種類代碼、其定義，以及要掃的各等級。"""

    key: str
    axis: SweepAxis
    levels: list[float]


def parse_axis(params: Mapping[str, Any]) -> Axis:
    """由 {"axis", "lo", "hi", "n"} 取得退化種類與等級；範圍與點數超出時丟 ``SceneError``。"""
    key = params.get("axis", "blur_sigma")
    if key not in SWEEP_AXES:
        raise SceneError(f"未知的退化種類 {key!r}，可用：{', '.join(SWEEP_AXES)}", "axis")
    axis = SWEEP_AXES[key]
    lo = _number(params, "lo", axis.default_lo)
    hi = _number(params, "hi", axis.default_hi)
    if not axis.lo <= lo < hi <= axis.hi:
        # 錯誤標在出問題的欄位：只有 hi 超出上限時標 hi，其餘（lo 超出下限、lo ≥ hi）標 lo
        field = "hi" if axis.lo <= lo and hi > axis.hi else "lo"
        raise SceneError(f"範圍須滿足 {axis.lo} ≤ lo < hi ≤ {axis.hi}，收到 {lo}、{hi}", field)
    # 至少 3 點，_thumbs 的最弱／中間／最強三張縮圖才會各不相同
    n = _int(params, "n", 9, 3, MAX_POINTS)
    return Axis(key, axis, sweep_levels(lo, hi, n))


def quality_sweep(img: Image, ax: Axis, cfg: QualityConfig) -> SweepResult:
    """每個等級做一次品質檢查；``triggers`` 為各警告首次出現的等級（沒有則為 None）。"""
    rows: list[dict[str, Any]] = []
    degraded: list[Image] = []
    for level in ax.levels:
        out = ax.axis.fn(img, level)
        degraded.append(out)
        r = check_quality(out, cfg)
        rows.append(
            {
                "level": level,
                "blur_score": r.blur_score,
                "mean_brightness": r.exposure.mean,
                "dark_ratio": r.exposure.dark_ratio,
                "bright_ratio": r.exposure.bright_ratio,
                "resolution_ok": r.resolution_ok,
                "passed": r.passed,
                "warnings": [w.value for w in r.warnings],
            }
        )
    # 每個品質警告代碼都列出（沒觸發為 None），前端的欄位因此固定
    warnings = [", ".join(r["warnings"]) for r in rows]
    triggers = {
        code.value: first_trigger(ax.levels, warnings, code.value) for code in QUALITY_WARNINGS
    }
    data = {"axis": ax.key, "levels": ax.levels, "rows": rows, "triggers": triggers}
    return SweepResult(data, _thumbs(ax.levels, degraded))


def barcode_sweep(
    ax: Axis,
    *,
    samples: int,
    module_px: int,
    seed: int,
    ladder: LadderConfig,
    zxing: ZxingConfig,
    quality: QualityConfig,
) -> SweepResult:
    """合成 EAN-13 樣本（內容各不相同），每個等級比較只用原圖與完整階梯對真值的結果。

    成功率只計讀對的樣本，誤讀另列；同一批退化影像也跑品質檢查，回傳品質門檻與
    逐步升級結果的對照（``alarms`` 等，見 ``quality_alarm``）。
    """
    codes = ean13_codes(samples, seed)
    scenes = [ean13_scene(code, module_px) for code in codes]
    rows = ladder_eval.ladder_sweep(
        scenes, codes, ax.axis.fn, ax.levels, ZxingDecoder(zxing), ladder, quality
    )
    # ladder_eval 以中文為鍵，這裡轉成 JSON 用的英文鍵
    methods = {ladder_eval.RAW: "raw", ladder_eval.LADDER: "ladder"}
    data = {
        "axis": ax.key,
        "levels": ax.levels,
        "rates": [
            {
                "level": r["等級"],
                "method": methods[r["方法"]],
                "rate": r["成功率"],
                "misread": r["誤讀率"],
            }
            for r in ladder_eval.success_rates(rows)
        ],
        "rung_counts": [
            {"level": c["等級"], "rung": c["階"], "count": c["次數"]}
            for c in ladder_eval.rung_counts(rows)
        ],
        "overall": {m: ladder_eval.overall(rows, zh) for zh, m in methods.items()},
        "misread": {m: ladder_eval.overall(rows, zh, Outcome.MISREAD) for zh, m in methods.items()},
        "first_failure": {m: ladder_eval.first_failure(rows, zh) for zh, m in methods.items()},
        **quality_alarm.summary_json(rows, lambda r: r[ladder_eval.LADDER] == Outcome.CORRECT),
        "rows": [
            {
                "level": r["等級"],
                "sample": r["樣本"],
                "truth": r["真值"],
                "raw": r[ladder_eval.RAW],
                "ladder": r[ladder_eval.LADDER],
                "decoded": r["解出內容"],
                "success_rung": r["成功階"],
                "attempts": r["嘗試次數"],
                "quality_passed": r["品質通過"],
                "warnings": r["品質警告"],
            }
            for r in rows
        ],
    }
    # 縮圖只示意退化程度，取第一個樣本重新退化一次即可（ladder_sweep 不保留影像）
    first = scenes[0]
    return SweepResult(data, _thumbs(ax.levels, [ax.axis.fn(first, lv) for lv in ax.levels]))


def label_sweep(
    ax: Axis,
    *,
    samples: int,
    seed: int,
    tol: float,
    label: LabelConfig,
    quality: QualityConfig,
) -> SweepResult:
    """合成營養標示（各自的隨機透視，種子 ``seed + i``），每個等級跑營養標示前處理並對真實四角判定。

    幾何類退化（旋轉、縮小、透視）會同時換算真值四角；同一批退化影像也跑品質檢查，
    回傳品質門檻與定位結果的對照（見 ``quality_alarm``）。
    """
    h, w = LABEL_SCENE_SIZE
    scenes = [label_perspective_scene(LABEL_SCENE_STRENGTH, seed + i, h, w) for i in range(samples)]
    pairs = [(img, np.asarray(quad, dtype=np.float64)) for img, quad in scenes]
    rows = label_eval.label_sweep(pairs, ax.axis.fn, ax.axis.warp, ax.levels, label, quality, tol)
    outcomes = label_eval.LocateOutcome
    data = {
        "axis": ax.key,
        "levels": ax.levels,
        "tol": tol,
        "rates": [
            {
                "level": r["等級"],
                "rate": r["成功率"],
                "off": r["偏移率"],
                "median_error": r["誤差比中位數"],
                "warnings": r["警告比例"],
            }
            for r in label_eval.level_rates(rows)
        ],
        "overall": {o.value: label_eval.overall(rows, o) for o in outcomes},
        "first_failure": label_eval.first_failure(rows),
        **quality_alarm.summary_json(rows, lambda r: r["判定"] == outcomes.CORRECT),
        "rows": [
            {
                "level": r["等級"],
                "sample": r["樣本"],
                "outcome": r["判定"],
                "error": r["最大誤差比"],
                "method": r["方法"],
                "label_warnings": r["標示警告"],
                "quality_passed": r["品質通過"],
                "warnings": r["品質警告"],
            }
            for r in rows
        ],
    }
    first = pairs[0][0]
    return SweepResult(data, _thumbs(ax.levels, [ax.axis.fn(first, lv) for lv in ax.levels]))


def _thumbs(levels: list[float], images: list[Image]) -> list[Thumb]:
    """最弱、中間、最強三個等級的縮圖。"""
    picks = sorted({0, len(levels) // 2, len(levels) - 1})
    return [Thumb(levels[i], resize_short_side(images[i], THUMB_SHORT_SIDE)) for i in picks]


def _number(params: Mapping[str, Any], key: str, default: float) -> float:
    """取數字參數（int 或 float，缺少時用預設值）；bool 是 int 的子類別，須另外排除。"""
    value = params.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise SceneError(f"{key} 必須是數字", key)
    return float(value)


def _int(params: Mapping[str, Any], key: str, default: int, lo: int, hi: int) -> int:
    """取 ``lo``–``hi`` 間的整數參數（缺少時用預設值）；不接受 bool 與 float（含 3.0）。"""
    value = params.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise SceneError(f"{key} 必須是 {lo}–{hi} 的整數", key)
    return value


def sample_params(params: Mapping[str, Any]) -> tuple[int, int, int]:
    """條碼掃描的（樣本數, 模組寬, 種子），各自檢查範圍；超出時丟 ``SceneError``。"""
    return (
        _int(params, "samples", 5, 1, MAX_SAMPLES),
        _int(params, "module_px", 4, 1, 12),
        _int(params, "seed", 0, 0, 10_000),
    )


def tolerance_param(params: Mapping[str, Any]) -> float:
    """營養標示掃描的定位容許誤差（``tol``，比例）；超出範圍時丟 ``SceneError``。"""
    tol = _number(params, "tol", TOL_DEFAULT)
    lo, hi = TOL_RANGE
    if not lo <= tol <= hi:
        raise SceneError(f"tol 必須介於 {lo} 與 {hi}，收到 {tol}", "tol")
    return tol
