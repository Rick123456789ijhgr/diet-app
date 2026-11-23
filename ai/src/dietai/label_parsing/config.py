"""營養標示讀取（``label_parsing.reader.read_label``）的參數。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from dietai.preprocess.config import LabelConfig, param


@dataclass(frozen=True)
class LabelReadConfig:
    """營養標示讀取：前處理 → OCR → 欄位解析 → 欄基準判斷 → 邏輯驗證。

    ``preprocess`` 為模組一的 ``LabelConfig``（巢狀；由 JSON 讀入時可為物件）。``enable_*`` 全部
    關閉時等於不做前處理，E2 的「原圖」方法即以此表示。
    邏輯驗證的容許誤差應依法規允許的標示誤差範圍調整，目前為暫定值（待校準）。
    """

    preprocess: LabelConfig = LabelConfig()
    line_overlap: float = param(
        0.5,
        "同一行的重疊比例",
        "Line overlap",
        "兩個文字框的垂直範圍重疊超過較矮者高度的此比例時，排在同一行。",
        min=0.05,
        max=1.0,
        step=0.05,
        calibrate=True,
        group="label_read",
    )
    atwater_rel_tol: float = param(
        0.2,
        "熱量推算相對誤差",
        "Atwater relative tolerance",
        "標示熱量與蛋白質×4＋脂肪×9＋碳水×4 的差距，在此比例內視為一致。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="label_checks",
    )
    atwater_abs_tol: float = param(
        10.0,
        "熱量推算絕對誤差（大卡）",
        "Atwater absolute tolerance (kcal)",
        "熱量很小時改用此絕對差距判斷，避免捨入造成誤報。",
        min=0.0,
        max=100.0,
        step=1.0,
        calibrate=True,
        group="label_checks",
    )
    serving_rel_tol: float = param(
        0.05,
        "每份×份數相對誤差",
        "Serving × count tolerance",
        "每份重量乘以份數與淨重的差距，在此比例內視為一致。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="label_checks",
    )

    def __post_init__(self) -> None:
        if isinstance(self.preprocess, Mapping):  # 由 JSON 讀入的巢狀物件
            object.__setattr__(self, "preprocess", LabelConfig(**self.preprocess))
        if not 0 < self.line_overlap <= 1:
            raise ValueError(f"line_overlap 必須介於 0（不含）與 1，收到 {self.line_overlap}")
        for name in ("atwater_rel_tol", "atwater_abs_tol", "serving_rel_tol"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 不得為負，收到 {getattr(self, name)}")
