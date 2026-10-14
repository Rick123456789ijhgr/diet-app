"""proto 與 dietai 模型之間的轉換（不含任何處理邏輯）。"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import asdict
from typing import Any

from dietai.devtools.store import StoredImage
from dietai.preprocess import DecodeHit, InvoiceQrResult, LadderResult, QualityReport, RungAttempt
from dietai.preprocess.types import Box, Ellipse, StepRecord
from dietai.v1 import preprocess_pb2, workbench_pb2


def dumps(value: Any) -> str:
    """JSON 編碼：保留中文；numpy 純量等非標準型別轉成字串，避免整個請求失敗。"""
    return json.dumps(value, ensure_ascii=False, default=str)


def config_key(cfg: Any) -> str:
    """設定的快取鍵：全部欄位依名稱排序的 JSON（衍生影像依原圖與這個鍵去重複）。"""
    return json.dumps(asdict(cfg), sort_keys=True, default=str)


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


def decode_hit(hit: DecodeHit) -> preprocess_pb2.DecodeHit:
    return preprocess_pb2.DecodeHit(
        format=hit.format.value,
        text=hit.text,
        raw=hit.raw,
        corners=[preprocess_pb2.Point(x=float(x), y=float(y)) for x, y in hit.corners],
    )


def rung_attempt(a: RungAttempt) -> preprocess_pb2.RungAttempt:
    return preprocess_pb2.RungAttempt(
        rung=a.rung.value,
        params_json=dumps(dict(a.params)),
        elapsed_ms=a.elapsed_ms,
        hits=[decode_hit(h) for h in a.hits],
        rejected=[decode_hit(h) for h in a.rejected],
        skipped=a.skipped,
    )


def barcode_response(r: LadderResult) -> preprocess_pb2.DecodeBarcodeResponse:
    return preprocess_pb2.DecodeBarcodeResponse(
        success=r.success,
        success_rung=r.success_rung.value if r.success_rung is not None else "",
        success_index=r.success_index if r.success_index is not None else -1,
        hits=[decode_hit(h) for h in r.hits],
        attempts=[rung_attempt(a) for a in r.attempts],
        warnings=[w.value for w in r.warnings],
        steps=steps(r.steps),
    )


def invoice_response(r: InvoiceQrResult) -> preprocess_pb2.LocateInvoiceQrResponse:
    out = preprocess_pb2.LocateInvoiceQrResponse(
        attempts=[rung_attempt(a) for a in r.attempts],
        warnings=[w.value for w in r.warnings],
        steps=steps(r.steps),
    )
    if r.left is not None:
        out.left.CopyFrom(decode_hit(r.left))
    if r.right is not None:
        out.right.CopyFrom(decode_hit(r.right))
    return out


def box(b: Box) -> preprocess_pb2.Box:
    return preprocess_pb2.Box(x=b.x, y=b.y, w=b.w, h=b.h)


def ellipse(e: Ellipse) -> preprocess_pb2.Ellipse:
    return preprocess_pb2.Ellipse(cx=e.cx, cy=e.cy, major=e.major, minor=e.minor, angle=e.angle)
