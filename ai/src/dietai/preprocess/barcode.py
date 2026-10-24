"""條碼逐步升級（ladder）：依序嘗試不同的前處理版本，第一次解碼成功即停止。

每一階都由原圖（或其灰階）獨立產生，不疊加前一階的結果；階的順序與啟用與否由
``LadderConfig.rungs`` 決定，E1 消融實驗只改設定、不改程式。
找到的四角座標一律回推到原圖座標系。
"""

from __future__ import annotations

import re
import time
from collections import Counter
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
import numpy.typing as npt

from dietai.preprocess import ops
from dietai.preprocess.config import LadderConfig
from dietai.preprocess.decoders import DecodeHit, Decoder
from dietai.preprocess.types import CodeFormat, Image, PreprocessWarning, Rung, StepRecord

Affine = npt.NDArray[np.float64]  # 2×3 仿射矩陣
# 不改變幾何的階共用這一個物件；``_map_hit`` 以 ``is`` 判斷，命中時直接略過座標換算
_IDENTITY: Affine = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
# 只接受 ASCII 數字：``[0-9]`` 而非 ``\d``，``\d`` 也會匹配全形等其他 Unicode 數字
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
    """一次嘗試的紀錄。``hits`` 為採用的結果、``rejected`` 為檢查碼錯誤而捨棄的結果。

    ``rejected`` 也包含格式不在 ``LadderConfig.accept_formats`` 中的結果（見 ``iter_attempts``）。
    ``hits``／``rejected`` 的座標皆已回推到原圖。
    """

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
    ``image`` 為成功時送進解碼器的影像版本；失敗時兩者皆為 ``None``。
    失敗時 ``warnings`` 為 ``BARCODE_NOT_FOUND``；若有解碼結果但都未達
    ``min_agree`` 則為 ``BARCODE_UNCONFIRMED``。``hits`` 的座標為原圖座標。
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
    # GS1 規則：由左數第 1、3、5…位（索引偶數）權重 1，第 2、4、6…位（索引奇數）權重 3；
    # 檢查碼為使加權和補到 10 的倍數所需的數字（外層 % 10 讓「剛好整除」時得 0 而非 10）
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

    為避免每次嘗試都複製整張影像，``raw`` 階的 ``image`` 就是輸入本身、``gray`` 階與其他階
    共用同一份灰階；解碼器不會修改輸入，呼叫端也不得修改這些影像（需要時自行 ``copy()``）。
    """
    ops.validate_image(img)
    gray: Image | None = None

    def get_gray() -> Image:
        """第一次需要時才轉灰階並快取；若在 ``raw`` 階就解碼成功，就完全不必轉換。"""
        nonlocal gray
        if gray is None:
            gray = ops.to_gray(img)
        return gray

    for rung in cfg.rungs:
        # 以下各階皆只改像素、不改幾何，座標與原圖相同，故 ``to_original`` 為恆等矩陣；
        # 只有 deskew（旋轉＋擴大畫布）與 multiscale（縮放）需要回推矩陣
        if rung is Rung.RAW:
            yield Variant(rung, img, _IDENTITY)
        elif rung is Rung.GRAY:
            yield Variant(rung, get_gray(), _IDENTITY)
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
            # 以整張灰階的梯度結構張量估計主方向（見 ``ops.estimate_skew``）；
            # 回傳值為內容被逆時針轉了幾度，所以下方以 ``-skew`` 轉回
            skew = ops.estimate_skew(get_gray())
            params = {"skew_deg": round(skew, 2), "min_deg": cfg.deskew_min_deg}
            if abs(skew) < cfg.deskew_min_deg:
                # 角度低於門檻時略過旋轉（旋轉會多一次內插、也多花一次解碼時間）；
                # 仍產出一筆 skipped 紀錄以保留估計角度供分析，但不送解碼
                yield Variant(rung, None, _IDENTITY, params, skipped=True)
                continue
            # m 把原圖座標映射到旋轉後（已擴大畫布）的座標，與 ``ops.rotate`` 內部用的矩陣相同；
            # 取反矩陣即可把旋轉後影像上找到的四角回推到原圖
            m, _ = ops.rotation_matrix(get_gray().shape, -skew)
            inverse = np.asarray(cv2.invertAffineTransform(m), dtype=np.float64)
            yield Variant(rung, ops.rotate(get_gray(), -skew), inverse, params)
        elif rung is Rung.MULTISCALE:
            h, w = get_gray().shape[:2]
            for factor in cfg.scales:
                out = ops.scale(get_gray(), factor)
                # 以實際輸出尺寸計算倍率：``ops.scale`` 會把寬高取整，實際倍率可能與 factor
                # 略有差異，且 x、y 方向不一定相同
                sx, sy = out.shape[1] / w, out.shape[0] / h
                # resize 的像素中心對應：x' = (x + 0.5)·s − 0.5
                # 反解得 x = x'/s + (0.5/s − 0.5)，即下方矩陣的縮放項與平移項（y 方向同理）
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

    格式不在 ``cfg.accept_formats``（非空時）的結果，以及 ``cfg.verify_ean13`` 為 ``True``
    時檢查碼錯誤的 EAN-13，歸入 ``rejected``。
    耗時含產生影像版本與解碼。
    """
    variants = ladder_variants(img, cfg)
    while True:
        # 計時從 next() 之前開始：產生器是惰性的，影像版本在 next() 時才計算，
        # 這樣耗時才包含前處理本身（第一次用到灰階的那一階也會包含轉灰階的時間）
        start = time.perf_counter()
        variant = next(variants, None)
        if variant is None:
            return
        hits: list[DecodeHit] = []
        rejected: list[DecodeHit] = []
        # skipped 的版本 image 為 None：不解碼，但仍產出一筆（空的）嘗試紀錄
        if variant.image is not None:
            for hit in decoder(variant.image):
                # 先回推到原圖座標再分類，hits 與 rejected 的座標系才一致
                mapped = _map_hit(hit, variant.to_original)
                # 兩種情況捨棄：(1) 設定了允許格式而此格式不在其中；
                # (2) 要求驗證且為 EAN-13，但檢查碼不符
                if (cfg.accept_formats and mapped.format not in cfg.accept_formats) or (
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
    """依 ``cfg.rungs`` 逐階嘗試解碼，有結果被確認即停止。

    「確認」：同一個（格式, 內容）累計在 ``cfg.min_agree`` 次不同的嘗試中解出
    （多尺度的每個倍率各算一次嘗試）。``min_agree`` 為 1 時即第一次解出就採用；
    成功時 ``hits`` 只含當次嘗試中已確認的結果，``success_rung`` 為達到確認的那一階。

    輸入為 BGR 或灰階 ``uint8`` 影像，不會被修改。``decoder`` 可為任何符合
    ``Decoder`` 介面的實作（預設實作為 ``ZxingDecoder``）。
    每次嘗試記錄在 ``attempts`` 與 ``steps``（步驟名稱為階的代碼，參數含該階設定）。
    """
    ops.validate_image(img)
    attempts: list[RungAttempt] = []
    # 跨嘗試累計的票數；只計 hits，rejected（格式不符／檢查碼錯）不投票
    votes: Counter[tuple[CodeFormat, str]] = Counter()
    for variant, attempt in iter_attempts(img, decoder, cfg):
        attempts.append(attempt)
        votes.update({(h.format, h.text) for h in attempt.hits})  # 同一次嘗試只算一票
        # 本次嘗試中，累計票數已達門檻的結果；票數可能有一部分來自先前的嘗試
        confirmed = tuple(h for h in attempt.hits if votes[h.format, h.text] >= cfg.min_agree)
        if confirmed:
            return LadderResult(
                success=True,
                success_rung=attempt.rung,
                success_index=len(attempts) - 1,
                # raw 階的版本就是輸入本身；回傳副本，避免呼叫端修改結果時改到輸入
                image=img.copy() if variant.image is img else variant.image,
                hits=confirmed,
                attempts=tuple(attempts),
                steps=attempts_to_steps(attempts),
                warnings=(),
            )
    # 所有階都試完仍未確認：有任何一票表示「解得出但不夠一致」，否則為完全沒找到
    return LadderResult(
        success=False,
        success_rung=None,
        success_index=None,
        image=None,
        hits=(),
        attempts=tuple(attempts),
        steps=attempts_to_steps(attempts),
        warnings=(
            PreprocessWarning.BARCODE_UNCONFIRMED if votes else PreprocessWarning.BARCODE_NOT_FOUND,
        ),
    )


def attempts_to_steps(attempts: list[RungAttempt]) -> tuple[StepRecord, ...]:
    """把嘗試紀錄轉成通用的 ``StepRecord``（步驟名稱為階的代碼）。"""
    return tuple(StepRecord(a.rung.value, a.elapsed_ms, a.params) for a in attempts)


def _map_hit(hit: DecodeHit, affine: Affine) -> DecodeHit:
    """以 2×3 仿射矩陣把 ``hit`` 的四角從影像版本座標換算回原圖座標，其餘欄位不變。"""
    if affine is _IDENTITY:
        return hit
    # 對每個點 p（列向量）計算 A·p + t：pts 形狀 (4, 2)，所以乘 A 的轉置再加平移向量 t
    pts = np.array(hit.corners, dtype=np.float64)
    mapped = pts @ affine[:, :2].T + affine[:, 2]
    # 仿射只換座標、不重排順序，四角仍為左上、右上、右下、左下（以條碼本身方向為準）
    tl, tr, br, bl = ((float(x), float(y)) for x, y in mapped.tolist())
    return DecodeHit(hit.format, hit.text, hit.raw, (tl, tr, br, bl))
