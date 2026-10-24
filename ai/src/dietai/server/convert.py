"""proto 與 dietai 模型之間的轉換（不含任何處理邏輯）。

共通慣例：

- proto3 的純量欄位沒有「未設定」：domain 的 ``None`` 以空字串或 ``-1`` 表示；
  message 欄位則以「不填」表示，呼叫端用 ``HasField`` 判斷。
- 列舉（``Rung``、``CodeFormat``、``PreprocessWarning``）以 ``.value`` 的英文字串傳送，
  proto 中對應欄位為 ``string``。
- 座標皆為原圖像素：``Box`` 為整數，``Point``、``Ellipse`` 為浮點。
- 各步驟的參數字典以 JSON 字串（``params_json``）傳送，前端直接顯示。
"""

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
    """``StepRecord`` → proto ``Step``。

    ``params`` 轉成 JSON 字串：各步驟的參數不同，不為每個步驟另定 message。
    """
    return [
        preprocess_pb2.Step(name=s.name, elapsed_ms=s.elapsed_ms, params_json=dumps(dict(s.params)))
        for s in records
    ]


def quality_response(report: QualityReport) -> preprocess_pb2.CheckQualityResponse:
    """``QualityReport`` → ``CheckQualityResponse``；巢狀的 ``exposure`` 攤平成三個欄位。"""
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
    """暫存影像 → ``ImageRef``；沒有真值時 ``truth_json`` 為空字串（proto3 字串沒有 None）。"""
    return workbench_pb2.ImageRef(
        image_id=item.image_id,
        width=item.width,
        height=item.height,
        description=item.description,
        truth_json=dumps(item.truth) if item.truth is not None else "",
    )


def decode_hit(hit: DecodeHit) -> preprocess_pb2.DecodeHit:
    """``DecodeHit`` → proto；``raw`` 原樣傳送位元組，發票 QR 的中文由 Go 端解碼。"""
    return preprocess_pb2.DecodeHit(
        format=hit.format.value,
        text=hit.text,
        raw=hit.raw,
        # 四角順序沿用 domain（左上、右上、右下、左下）；float() 確保 numpy 等數值型別
        # 也能放進 double 欄位
        corners=[preprocess_pb2.Point(x=float(x), y=float(y)) for x, y in hit.corners],
    )


def rung_attempt(a: RungAttempt) -> preprocess_pb2.RungAttempt:
    """``RungAttempt`` → proto。

    ``rejected`` 為檢查碼錯誤或格式不被接受而捨棄的結果；``skipped`` 表示這一階未實際執行。
    兩者的座標都已由 ``preprocess`` 回推到原圖，這裡不再換算。
    """
    return preprocess_pb2.RungAttempt(
        rung=a.rung.value,
        params_json=dumps(dict(a.params)),
        elapsed_ms=a.elapsed_ms,
        hits=[decode_hit(h) for h in a.hits],
        rejected=[decode_hit(h) for h in a.rejected],
        skipped=a.skipped,
    )


def barcode_response(r: LadderResult) -> preprocess_pb2.DecodeBarcodeResponse:
    """``LadderResult`` → ``DecodeBarcodeResponse``（``LadderResult.image`` 不傳回）。"""
    return preprocess_pb2.DecodeBarcodeResponse(
        success=r.success,
        # 失敗時 domain 為 None；proto3 的純量欄位沒有 None，以空字串與 -1 表示
        # （-1 不會與合法索引 0 混淆，見 proto 註解）
        success_rung=r.success_rung.value if r.success_rung is not None else "",
        success_index=r.success_index if r.success_index is not None else -1,
        hits=[decode_hit(h) for h in r.hits],
        attempts=[rung_attempt(a) for a in r.attempts],
        warnings=[w.value for w in r.warnings],
        steps=steps(r.steps),
    )


def invoice_response(r: InvoiceQrResult) -> preprocess_pb2.LocateInvoiceQrResponse:
    """``InvoiceQrResult`` → ``LocateInvoiceQrResponse``；左右 QR 未找到時不填該欄位。"""
    out = preprocess_pb2.LocateInvoiceQrResponse(
        attempts=[rung_attempt(a) for a in r.attempts],
        warnings=[w.value for w in r.warnings],
        steps=steps(r.steps),
    )
    # message 欄位不能在建構時傳 None，也不能直接指派，找到時才以 CopyFrom 填入；
    # 呼叫端以 HasField（Go 為 nil 判斷）分辨「未找到」
    if r.left is not None:
        out.left.CopyFrom(decode_hit(r.left))
    if r.right is not None:
        out.right.CopyFrom(decode_hit(r.right))
    return out


def box(b: Box) -> preprocess_pb2.Box:
    """``Box`` → proto ``Box``：原圖整數像素，左上角 ``(x, y)`` 加寬高。"""
    return preprocess_pb2.Box(x=b.x, y=b.y, w=b.w, h=b.h)


def ellipse(e: Ellipse) -> preprocess_pb2.Ellipse:
    """``Ellipse`` → proto：原圖浮點像素；``major``／``minor`` 為軸全長，``angle`` 單位為度。"""
    return preprocess_pb2.Ellipse(cx=e.cx, cy=e.cy, major=e.major, minor=e.minor, angle=e.angle)
