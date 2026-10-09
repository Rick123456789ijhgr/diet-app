"""條碼逐步升級（ladder）：依序嘗試不同的前處理版本，第一次解碼成功即停止。

每一階都由原圖（或其灰階）獨立產生，不疊加前一階的結果；階的順序與啟用與否由
``LadderConfig.rungs`` 決定，E1 消融實驗只改設定、不改程式。
找到的四角座標一律回推到原圖座標系。
"""

from __future__ import annotations

import re
import time
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
import numpy.typing as npt

from dietai.preprocess import ops
from dietai.preprocess.config import LadderConfig
from dietai.preprocess.decoders import CodeFormat, DecodeHit, Decoder
from dietai.preprocess.types import Image, PreprocessWarning, Rung, StepRecord

Affine = npt.NDArray[np.float64]  # 2×3 仿射矩陣
_IDENTITY: Affine = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
_EAN13 = re.compile(r"[0-9]{13}")
_EAN13_BODY = re.compile(r"[0-9]{12}")


@dataclass(frozen=True)
class Variant:
    """階梯中的一個影像版本。

    ``to_original`` 把此版本的座標映射回原圖；``skipped`` 為 ``True`` 時不送解碼
    （例如估計傾斜角太小、不需旋轉校正），此時 ``image`` 為 ``None``。
    """

    rung: Rung
    image: Image | None
    to_original: Affine
    params: Mapping[str, Any] = field(default_factory=dict)
    skipped: bool = False


@dataclass(frozen=True)
class RungAttempt:
    """一次嘗試的紀錄。``hits`` 為採用的結果、``rejected`` 為檢查碼錯誤而捨棄的結果。"""

    rung: Rung
    params: Mapping[str, Any]
    elapsed_ms: float
    hits: tuple[DecodeHit, ...]
    rejected: tuple[DecodeHit, ...] = ()
    skipped: bool = False


@dataclass(frozen=True)
class LadderResult:
    """``decode_with_ladder`` 的結果。

    ``success_index`` 為成功那一次嘗試在 ``attempts`` 中的索引（從 0 起算），
    ``image`` 為成功時送進解碼器的影像版本；失敗時兩者皆為 ``None``，
    ``warnings`` 含 ``BARCODE_NOT_FOUND``。``hits`` 的座標為原圖座標。
    """

    success: bool
    success_rung: Rung | None
    success_index: int | None
    image: Image | None
    hits: tuple[DecodeHit, ...]
    attempts: tuple[RungAttempt, ...]
    steps: tuple[StepRecord, ...]
    warnings: tuple[PreprocessWarning, ...]


def ean13_check_digit(body: str) -> int:
    """EAN-13 前 12 碼對應的檢查碼（0–9）。

    ``body`` 須為 12 個 ASCII 數字，否則丟 ``ValueError``。
    """
    if not _EAN13_BODY.fullmatch(body):
        raise ValueError(f"EAN-13 本體須為 12 個數字，收到 {body!r}")
    total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(body))
    return (10 - total % 10) % 10


def ean13_checksum_ok(code: str) -> bool:
    """EAN-13 檢查碼是否正確。只接受 13 個 ASCII 數字，其他一律回傳 ``False``。"""
    if not _EAN13.fullmatch(code):
        return False
    return ean13_check_digit(code[:12]) == int(code[12])


def ladder_variants(img: Image, cfg: LadderConfig = LadderConfig()) -> Iterator[Variant]:
    """依 ``cfg.rungs`` 的順序逐一產生影像版本（惰性產生，呼叫端可提早停止）。

    使用的設定欄位：``rungs``、``scales``、``binarize_*``、``sharpen_*``、
    ``denoise_ksize``、``deskew_min_deg``。多尺度階每個倍率產生一個版本。
    """
    ops.validate_image(img)
    gray: Image | None = None

    def get_gray() -> Image:
        nonlocal gray
        if gray is None:
            gray = ops.to_gray(img)
        return gray

    for rung in cfg.rungs:
        if rung is Rung.RAW:
            yield Variant(rung, img.copy(), _IDENTITY)
        elif rung is Rung.GRAY:
            yield Variant(rung, get_gray().copy(), _IDENTITY)
        elif rung is Rung.BINARIZE:
            params = {"block_size": cfg.binarize_block_size, "c": cfg.binarize_c}
            out = ops.adaptive_threshold(get_gray(), cfg.binarize_block_size, cfg.binarize_c)
            yield Variant(rung, out, _IDENTITY, params)
        elif rung is Rung.SHARPEN:
            params = {"sigma": cfg.sharpen_sigma, "amount": cfg.sharpen_amount}
            out = ops.unsharp_mask(get_gray(), cfg.sharpen_sigma, cfg.sharpen_amount)
            yield Variant(rung, out, _IDENTITY, params)
        elif rung is Rung.DENOISE:
            params = {"ksize": cfg.denoise_ksize}
            yield Variant(rung, ops.median_blur(get_gray(), cfg.denoise_ksize), _IDENTITY, params)
        elif rung is Rung.DESKEW:
            skew = ops.estimate_skew(get_gray())
            params = {"skew_deg": round(skew, 2), "min_deg": cfg.deskew_min_deg}
            if abs(skew) < cfg.deskew_min_deg:
                yield Variant(rung, None, _IDENTITY, params, skipped=True)
                continue
            m, _ = ops.rotation_matrix(get_gray().shape, -skew)
            inverse = np.asarray(cv2.invertAffineTransform(m), dtype=np.float64)
            yield Variant(rung, ops.rotate(get_gray(), -skew), inverse, params)
        elif rung is Rung.MULTISCALE:
            h, w = get_gray().shape[:2]
            for factor in cfg.scales:
                out = ops.scale(get_gray(), factor)
                sx, sy = out.shape[1] / w, out.shape[0] / h
                # resize 的像素中心對應：x' = (x + 0.5)·s − 0.5
                inverse = np.array(
                    [[1 / sx, 0.0, 0.5 / sx - 0.5], [0.0, 1 / sy, 0.5 / sy - 0.5]],
                    dtype=np.float64,
                )
                yield Variant(rung, out, inverse, {"factor": factor})


def iter_attempts(
    img: Image, decoder: Decoder, cfg: LadderConfig = LadderConfig()
) -> Iterator[tuple[Variant, RungAttempt]]:
    """逐階產生影像版本並解碼，產出（版本, 嘗試紀錄）。供 ``decode_with_ladder`` 與
    ``invoice_qr`` 共用；何時停止由呼叫端決定。

    ``cfg.verify_ean13`` 為 ``True`` 時，檢查碼錯誤的 EAN-13 歸入 ``rejected``。
    耗時含產生影像版本與解碼。
    """
    variants = ladder_variants(img, cfg)
    while True:
        start = time.perf_counter()
        variant = next(variants, None)
        if variant is None:
            return
        hits: list[DecodeHit] = []
        rejected: list[DecodeHit] = []
        if variant.image is not None:
            for hit in decoder(variant.image):
                mapped = _map_hit(hit, variant.to_original)
                if (
                    cfg.verify_ean13
                    and mapped.format is CodeFormat.EAN13
                    and not ean13_checksum_ok(mapped.text)
                ):
                    rejected.append(mapped)
                else:
                    hits.append(mapped)
        attempt = RungAttempt(
            rung=variant.rung,
            params=dict(variant.params),
            elapsed_ms=(time.perf_counter() - start) * 1000,
            hits=tuple(hits),
            rejected=tuple(rejected),
            skipped=variant.skipped,
        )
        yield variant, attempt


def decode_with_ladder(
    img: Image, decoder: Decoder, cfg: LadderConfig = LadderConfig()
) -> LadderResult:
    """依 ``cfg.rungs`` 逐階嘗試解碼，第一次有採用的結果即停止。

    輸入為 BGR 或灰階 ``uint8`` 影像，不會被修改。``decoder`` 可為任何符合
    ``Decoder`` 介面的實作（預設實作為 ``ZxingDecoder``）。
    每次嘗試記錄在 ``attempts`` 與 ``steps``（步驟名稱為階的代碼，參數含該階設定）。
    """
    ops.validate_image(img)
    attempts: list[RungAttempt] = []
    for variant, attempt in iter_attempts(img, decoder, cfg):
        attempts.append(attempt)
        if attempt.hits:
            return LadderResult(
                success=True,
                success_rung=attempt.rung,
                success_index=len(attempts) - 1,
                image=variant.image,
                hits=attempt.hits,
                attempts=tuple(attempts),
                steps=attempts_to_steps(attempts),
                warnings=(),
            )
    return LadderResult(
        success=False,
        success_rung=None,
        success_index=None,
        image=None,
        hits=(),
        attempts=tuple(attempts),
        steps=attempts_to_steps(attempts),
        warnings=(PreprocessWarning.BARCODE_NOT_FOUND,),
    )


def attempts_to_steps(attempts: list[RungAttempt]) -> tuple[StepRecord, ...]:
    """把嘗試紀錄轉成通用的 ``StepRecord``（步驟名稱為階的代碼）。"""
    return tuple(StepRecord(a.rung.value, a.elapsed_ms, a.params) for a in attempts)


def _map_hit(hit: DecodeHit, affine: Affine) -> DecodeHit:
    if affine is _IDENTITY:
        return hit
    pts = np.array(hit.corners, dtype=np.float64)
    mapped = pts @ affine[:, :2].T + affine[:, 2]
    tl, tr, br, bl = ((float(x), float(y)) for x, y in mapped.tolist())
    return DecodeHit(hit.format, hit.text, hit.raw, (tl, tr, br, bl))
