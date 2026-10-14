"""參數掃描：一種退化由弱到強，觀察品質檢查的指標或條碼解碼的成功率如何變化。

回傳可直接序列化成 JSON 的字典（英文鍵），另附幾個等級的縮圖供介面顯示。
解碼與檢查一律呼叫 ``dietai.preprocess``；成功率彙整沿用 ``ladder_eval``。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from dietai.devtools import ladder_eval
from dietai.devtools.degradations import SWEEP_AXES, SweepAxis, first_trigger, sweep_levels
from dietai.devtools.scenes import SceneError
from dietai.preprocess import LadderConfig, QualityConfig, ZxingConfig, ZxingDecoder, check_quality
from dietai.preprocess.ops import resize_short_side
from dietai.preprocess.quality import QUALITY_WARNINGS
from dietai.preprocess.types import Image
from dietai.synthetic import ean13_codes, ean13_scene

THUMB_SHORT_SIDE = 200
MAX_POINTS = 30
MAX_SAMPLES = 30


@dataclass(frozen=True)
class Thumb:
    level: float
    image: Image


@dataclass(frozen=True)
class SweepResult:
    data: dict[str, Any]
    thumbs: list[Thumb]


@dataclass(frozen=True)
class Axis:
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
        raise SceneError(f"範圍須滿足 {axis.lo} ≤ lo < hi ≤ {axis.hi}，收到 {lo}、{hi}", "lo")
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
    # 與 Streamlit 版共用「首次觸發」的定義
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
) -> SweepResult:
    """合成 EAN-13 樣本（內容各不相同），每個等級比較只用原圖與完整階梯的成功率。"""
    scenes = [ean13_scene(code, module_px) for code in ean13_codes(samples, seed)]
    rows = ladder_eval.ladder_sweep(scenes, ax.axis.fn, ax.levels, ZxingDecoder(zxing), ladder)
    methods = {ladder_eval.RAW: "raw", ladder_eval.LADDER: "ladder"}
    data = {
        "axis": ax.key,
        "levels": ax.levels,
        "rates": [
            {"level": r["等級"], "method": methods[r["方法"]], "rate": r["成功率"]}
            for r in ladder_eval.success_rates(rows)
        ],
        "rung_counts": [
            {"level": c["等級"], "rung": c["階"], "count": c["次數"]}
            for c in ladder_eval.rung_counts(rows)
        ],
        "overall": {m: ladder_eval.overall(rows, zh) for zh, m in methods.items()},
        "first_failure": {m: ladder_eval.first_failure(rows, zh) for zh, m in methods.items()},
        "rows": [
            {
                "level": r["等級"],
                "sample": r["樣本"],
                "raw": r[ladder_eval.RAW],
                "ladder": r[ladder_eval.LADDER],
                "success_rung": r["成功階"],
                "attempts": r["嘗試次數"],
            }
            for r in rows
        ],
    }
    first = scenes[0]
    return SweepResult(data, _thumbs(ax.levels, [ax.axis.fn(first, lv) for lv in ax.levels]))


def _thumbs(levels: list[float], images: list[Image]) -> list[Thumb]:
    """最弱、中間、最強三個等級的縮圖。"""
    picks = sorted({0, len(levels) // 2, len(levels) - 1})
    return [Thumb(levels[i], resize_short_side(images[i], THUMB_SHORT_SIDE)) for i in picks]


def _number(params: Mapping[str, Any], key: str, default: float) -> float:
    value = params.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise SceneError(f"{key} 必須是數字", key)
    return float(value)


def _int(params: Mapping[str, Any], key: str, default: int, lo: int, hi: int) -> int:
    value = params.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise SceneError(f"{key} 必須是 {lo}–{hi} 的整數", key)
    return value


def sample_params(params: Mapping[str, Any]) -> tuple[int, int, int]:
    """條碼掃描的（樣本數, 模組寬, 種子）。"""
    return (
        _int(params, "samples", 5, 1, MAX_SAMPLES),
        _int(params, "module_px", 4, 1, 12),
        _int(params, "seed", 0, 0, 10_000),
    )
