"""proto 與 dietai 模型之間的轉換（不含任何處理邏輯）。"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from dietai.devtools.store import StoredImage
from dietai.preprocess import QualityReport
from dietai.preprocess.types import StepRecord
from dietai.v1 import preprocess_pb2, workbench_pb2


def dumps(value: Any) -> str:
    """JSON 編碼：保留中文；numpy 純量等非標準型別轉成字串，避免整個請求失敗。"""
    return json.dumps(value, ensure_ascii=False, default=str)


def steps(records: Iterable[StepRecord]) -> list[preprocess_pb2.Step]:
    return [
        preprocess_pb2.Step(name=s.name, elapsed_ms=s.elapsed_ms, params_json=dumps(dict(s.params)))
        for s in records
    ]


def quality_response(report: QualityReport) -> preprocess_pb2.CheckQualityResponse:
    return preprocess_pb2.CheckQualityResponse(
        passed=report.passed,
        blur_score=report.blur_score,
        mean_brightness=report.exposure.mean,
        dark_ratio=report.exposure.dark_ratio,
        bright_ratio=report.exposure.bright_ratio,
        resolution_ok=report.resolution_ok,
        warnings=[w.value for w in report.warnings],
        steps=steps(report.steps),
    )


def image_ref(item: StoredImage) -> workbench_pb2.ImageRef:
    return workbench_pb2.ImageRef(
        image_id=item.image_id,
        width=item.width,
        height=item.height,
        description=item.description,
        truth_json=dumps(item.truth) if item.truth is not None else "",
    )
