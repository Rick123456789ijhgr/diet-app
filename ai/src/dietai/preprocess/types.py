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
