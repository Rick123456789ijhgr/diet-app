"""可組合的前處理 pipeline。

每個前處理步驟以 ``@register("名稱")`` 註冊，pipeline 依步驟名稱清單依序執行。
消融實驗只需改變步驟清單與參數（見 research/experiments/*/configs），不需改程式。
系統上線時使用同一個 ``run_pipeline``，確保研究結果與實際行為一致。
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

StepFn = Callable[..., np.ndarray]

_REGISTRY: dict[str, StepFn] = {}


def register(name: str) -> Callable[[StepFn], StepFn]:
    """把函式註冊為前處理步驟。函式簽名須為 ``fn(image, **params) -> image``。"""

    def decorator(fn: StepFn) -> StepFn:
        if name in _REGISTRY:
            raise ValueError(f"前處理步驟名稱重複：{name}")
        _REGISTRY[name] = fn
        return fn

    return decorator


def available_steps() -> list[str]:
    return sorted(_REGISTRY)


@dataclass(frozen=True)
class StepRecord:
    name: str
    elapsed_ms: float


@dataclass
class PipelineResult:
    image: np.ndarray
    records: list[StepRecord] = field(default_factory=list)


def run_pipeline(
    image: np.ndarray,
    steps: Sequence[str],
    params: Mapping[str, Mapping[str, Any]] | None = None,
) -> PipelineResult:
    """依序執行前處理步驟，並記錄每一步的耗時，供實驗分析。"""
    params = params or {}
    unknown = [s for s in steps if s not in _REGISTRY]
    if unknown:
        raise KeyError(f"未註冊的前處理步驟：{unknown}；可用：{available_steps()}")

    result = PipelineResult(image=image)
    for name in steps:
        start = time.perf_counter()
        result.image = _REGISTRY[name](result.image, **params.get(name, {}))
        result.records.append(StepRecord(name, (time.perf_counter() - start) * 1000))
    return result
