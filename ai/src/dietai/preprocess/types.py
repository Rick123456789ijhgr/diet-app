"""前處理共用型別。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, TypeAlias

import numpy as np
import numpy.typing as npt

# 影像：uint8，彩色為 (H, W, 3) BGR，灰階為 (H, W)。
Image: TypeAlias = npt.NDArray[np.uint8]

# 四邊形：float32，形狀 (4, 2) 的 (x, y)，順序為左上、右上、右下、左下（見 ops.order_quad）。
Quad: TypeAlias = npt.NDArray[np.float32]


@dataclass(frozen=True)
class StepRecord:
    """一個處理步驟的紀錄，供消融實驗分析。

    ``params`` 為該步驟實際使用的參數；``elapsed_ms`` 為耗時（毫秒）。
    """

    name: str
    elapsed_ms: float
    params: Mapping[str, Any] = field(default_factory=dict)


class PreprocessWarning(StrEnum):
    """給使用者的提示代碼。文字訊息由 APP 端對應，這裡只放代碼。"""

    TOO_BLURRY = "TOO_BLURRY"
    TOO_DARK = "TOO_DARK"
    TOO_BRIGHT = "TOO_BRIGHT"
    LOW_RESOLUTION = "LOW_RESOLUTION"
    BARCODE_NOT_FOUND = "BARCODE_NOT_FOUND"
    INVOICE_QR_PARTIAL = "INVOICE_QR_PARTIAL"
    INVOICE_QR_NOT_FOUND = "INVOICE_QR_NOT_FOUND"
    LABEL_NOT_LOCATED = "LABEL_NOT_LOCATED"  # 找不到營養標示的表格框，以原圖繼續
    GLARE_RETAKE = "GLARE_RETAKE"  # 反光面積過大，無法修補，建議重拍


class Rung(StrEnum):
    """條碼逐步升級（``barcode.decode_with_ladder``）的一階。

    每一階都由原圖獨立產生一個影像版本，不疊加前一階的結果，
    以便 E1 消融實驗判斷「是哪一個步驟救回來的」。
    """

    RAW = "raw"  # 原圖
    GRAY = "gray"  # 灰階
    BINARIZE = "binarize"  # 自適應二值化
    SHARPEN = "sharpen"  # 反銳化遮罩
    DENOISE = "denoise"  # 中值濾波
    DESKEW = "deskew"  # 估計傾斜角後旋轉校正
    MULTISCALE = "multiscale"  # 依設定的倍率逐一縮放
