"""電子發票雙 QR 定位：在一張影像中找出左、右兩個 QR，回傳原始位元組與座標。

只做定位與解碼，**不做中文解碼、不解析欄位**（由 Go 端負責）。
沿用條碼逐步升級的階梯：逐階累積找到的 QR（以原始位元組去除重複），湊滿兩個即停止。
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from dietai.preprocess import ops
from dietai.preprocess.barcode import RungAttempt, attempts_to_steps, iter_attempts
from dietai.preprocess.config import InvoiceQrConfig
from dietai.preprocess.decoders import DecodeHit, Decoder
from dietai.preprocess.types import CodeFormat, Image, PreprocessWarning, StepRecord


@dataclass(frozen=True)
class InvoiceQrResult:
    """``locate_invoice_qrs`` 的結果。

    ``left``／``right`` 依兩碼中心的水平位置區分，座標為原圖座標；只找到一個時
    放在 ``left`` 並附 ``INVOICE_QR_PARTIAL``（無法判斷左右）。兩碼可能來自不同的階，
    因此不提供單一的處理後影像（無 ``image`` 欄位）；各階紀錄見 ``attempts``。
    """

    left: DecodeHit | None
    right: DecodeHit | None
    attempts: tuple[RungAttempt, ...]
    steps: tuple[StepRecord, ...]
    warnings: tuple[PreprocessWarning, ...]

    @property
    def complete(self) -> bool:
        return self.left is not None and self.right is not None


def locate_invoice_qrs(
    img: Image, decoder: Decoder, cfg: InvoiceQrConfig = InvoiceQrConfig()
) -> InvoiceQrResult:
    """找出電子發票的左右兩個 QR。

    輸入為 BGR 或灰階 ``uint8`` 影像，不會被修改。使用 ``cfg.ladder`` 的階梯設定，
    只採用 QR 格式的結果。找到超過兩個不同的 QR 時取面積最大的兩個。
    只找到一個時回傳部分結果並附 ``INVOICE_QR_PARTIAL``，都找不到時附
    ``INVOICE_QR_NOT_FOUND``；不丟例外。
    """
    ops.validate_image(img)
    found: dict[bytes, DecodeHit] = {}
    attempts: list[RungAttempt] = []
    # 格式限制是給商品條碼的；發票只取 QR（下方過濾），不受共用設定影響
    ladder = replace(cfg.ladder, accept_formats=())
    for _, attempt in iter_attempts(img, decoder, ladder):
        attempts.append(attempt)
        for hit in attempt.hits:
            if hit.format is CodeFormat.QR_CODE:
                found.setdefault(hit.raw, hit)
        if len(found) >= 2:
            break

    codes = sorted(found.values(), key=lambda h: h.area, reverse=True)[:2]
    codes.sort(key=lambda h: h.center[0])
    warnings: tuple[PreprocessWarning, ...] = ()
    if not codes:
        warnings = (PreprocessWarning.INVOICE_QR_NOT_FOUND,)
    elif len(codes) == 1:
        warnings = (PreprocessWarning.INVOICE_QR_PARTIAL,)
    return InvoiceQrResult(
        left=codes[0] if codes else None,
        right=codes[1] if len(codes) == 2 else None,
        attempts=tuple(attempts),
        steps=attempts_to_steps(attempts),
        warnings=warnings,
    )
