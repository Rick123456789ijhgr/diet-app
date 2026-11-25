"""電子發票雙 QR 定位：在一張影像中找出左、右兩個 QR，回傳原始位元組與座標。

只做定位與解碼，**不做中文解碼、不解析欄位**（由 Go 端負責）。
沿用條碼逐步升級的階梯：逐階累積找到的 QR（以原始位元組去除重複）。

唯一看內容的地方是右碼的開頭 ``**``（財政部規格：右碼一律以 ``**`` 開頭），用來
（1）決定何時停止：同時找到一個非 ``**`` 與一個 ``**`` 的 QR 才停，避免背景中的其他 QR
湊數，讓階梯在讀到右碼之前就停下；（2）指定左右：不受拍攝方向影響（倒拍時右碼在影像左側）。
兩類沒有湊齊時（例如右碼一直沒讀到），退回依面積取最大兩個、再依中心 x 排左右。
規則寫成純函式（``select_invoice_pair``、``has_invoice_pair``），E3 離線模擬共用。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace

from dietai.preprocess import ops
from dietai.preprocess.barcode import RungAttempt, attempts_to_steps, iter_attempts
from dietai.preprocess.config import InvoiceQrConfig
from dietai.preprocess.decoders import DecodeHit, Decoder
from dietai.preprocess.types import CodeFormat, Image, PreprocessWarning, StepRecord

RIGHT_PREFIX = b"**"
"""右碼內容的開頭（財政部電子發票證明聯規格）。"""


def is_right_qr(raw: bytes) -> bool:
    """QR 內容是否為發票右碼（以 ``**`` 開頭）。"""
    return raw.startswith(RIGHT_PREFIX)


def has_invoice_pair(raws: Iterable[bytes]) -> bool:
    """是否同時有非 ``**``（左碼候選）與 ``**``（右碼）的 QR；逐步升級以此決定停止。"""
    kinds = {is_right_qr(r) for r in raws}
    return kinds == {False, True}


def select_invoice_pair(areas: Mapping[bytes, float]) -> list[bytes]:
    """由（QR 內容 → 面積）選出發票的兩個 QR，最多兩個。

    兩類都有時回傳 ``[左, 右]``：左為面積最大的非 ``**`` QR、右為面積最大的 ``**`` QR；
    否則回傳面積最大的兩個（由大到小，左右由呼叫端依位置決定）。
    """
    if has_invoice_pair(areas):
        lefts = [r for r in areas if not is_right_qr(r)]
        rights = [r for r in areas if is_right_qr(r)]
        return [max(lefts, key=areas.__getitem__), max(rights, key=areas.__getitem__)]
    return sorted(areas, key=areas.__getitem__, reverse=True)[:2]


@dataclass(frozen=True)
class InvoiceQrResult:
    """``locate_invoice_qrs`` 的結果。

    ``left``／``right`` 優先依內容區分（右碼以 ``**`` 開頭），兩類沒有湊齊時依兩碼中心的
    水平位置區分；座標為原圖座標。只找到一個時放在 ``left`` 並附 ``INVOICE_QR_PARTIAL``
    （即使它是右碼：只有一個時不判斷左右）。兩碼可能來自不同的階，
    因此不提供單一的處理後影像（無 ``image`` 欄位）；各階紀錄見 ``attempts``。
    """

    left: DecodeHit | None
    right: DecodeHit | None
    attempts: tuple[RungAttempt, ...]
    steps: tuple[StepRecord, ...]
    warnings: tuple[PreprocessWarning, ...]

    @property
    def complete(self) -> bool:
        """左右兩個 QR 是否都找到。"""
        return self.left is not None and self.right is not None


def locate_invoice_qrs(
    img: Image, decoder: Decoder, cfg: InvoiceQrConfig = InvoiceQrConfig()
) -> InvoiceQrResult:
    """找出電子發票的左右兩個 QR。

    輸入為 BGR 或灰階 ``uint8`` 影像，不會被修改。使用 ``cfg.ladder`` 的階梯設定，
    只採用 QR 格式的結果。配對與停止規則見模組說明（``select_invoice_pair``）。
    只找到一個時回傳部分結果並附 ``INVOICE_QR_PARTIAL``，都找不到時附
    ``INVOICE_QR_NOT_FOUND``；不丟例外。
    """
    ops.validate_image(img)
    # 以原始位元組為鍵去重：同一個 QR 常在多個階都被解出，只保留第一次（最早的階）的結果
    found: dict[bytes, DecodeHit] = {}
    attempts: list[RungAttempt] = []
    # 格式限制是給商品條碼的；發票只取 QR（下方過濾），不受共用設定影響
    ladder = replace(cfg.ladder, accept_formats=())
    # 不使用 ``min_agree`` 投票：QR 有 Reed–Solomon 錯誤更正，單次解出即可信
    # （見 ``InvoiceQrConfig`` 說明）
    for _, attempt in iter_attempts(img, decoder, ladder):
        attempts.append(attempt)
        for hit in attempt.hits:
            if hit.format is CodeFormat.QR_CODE:
                found.setdefault(hit.raw, hit)
        # 只數「左碼候選＋右碼」：背景中的其他 QR 不會讓階梯在讀到右碼前停下
        if has_invoice_pair(found):
            break

    pair = select_invoice_pair({raw: hit.area for raw, hit in found.items()})
    codes = [found[raw] for raw in pair]
    if not has_invoice_pair(pair):
        # 認不出左右（例如沒讀到右碼）：退回依中心 x 由左到右排序
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
