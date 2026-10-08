"""前處理的所有門檻與參數。

數值皆為合理預設值，標示「待校準」者須由研究組以標記照片（100–200 張）校準，
校準時不得使用 test split（見根目錄 CLAUDE.md 規則 7）。

每個欄位以 ``param()`` 宣告，附上中文名稱、英文名稱、說明、合理範圍與是否待校準，
工作台（``ai/workbench``）依此自動產生參數表單，PR 的「待校準清單」也可由此列出。
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any, TypeVar

T = TypeVar("T", int, float, bool)


@dataclass(frozen=True)
class ParamInfo:
    """設定欄位的描述資料（只用於說明與介面，不影響計算）。"""

    label: str  # 中文名稱
    label_en: str  # 英文名稱（輔助）
    help: str
    min: float | None = None
    max: float | None = None
    step: float | None = None
    calibrate: bool = False  # True 表示數值待校準
    group: str = ""  # 介面分組代碼，例如 "blur"、"exposure"


def param(
    default: T,
    label: str,
    label_en: str,
    help: str,
    *,
    min: float | None = None,
    max: float | None = None,
    step: float | None = None,
    calibrate: bool = False,
    group: str = "",
) -> T:
    """宣告一個帶描述資料的設定欄位。"""
    info = ParamInfo(label, label_en, help, min, max, step, calibrate, group)
    result: T = field(default=default, metadata={"info": info})
    return result


def param_info(cfg_cls: type[Any]) -> dict[str, ParamInfo]:
    """取得設定 dataclass 各欄位的 ``ParamInfo``；未以 ``param()`` 宣告的欄位略過。"""
    return {f.name: f.metadata["info"] for f in fields(cfg_cls) if "info" in f.metadata}


@dataclass(frozen=True)
class QualityConfig:
    """共通品質檢查（``dietai.preprocess.quality``）的參數。"""

    blur_short_side: int = param(
        480,
        "模糊計算短邊",
        "Blur short side",
        "計算模糊分數前先把影像縮放到此短邊（像素），使不同解析度的分數可比較。",
        min=64,
        max=2160,
        step=16,
        group="blur",
    )
    blur_min: float = param(
        100.0,
        "模糊下限",
        "Blur min",
        "拉普拉斯變異數低於此值視為過於模糊。",
        min=0.0,
        max=2000.0,
        step=5.0,
        calibrate=True,
        group="blur",
    )
    dark_level: int = param(
        30,
        "過暗灰階",
        "Dark level",
        "灰階值低於此值的像素視為過暗。",
        min=0,
        max=255,
        step=1,
        calibrate=True,
        group="exposure",
    )
    dark_ratio_max: float = param(
        0.5,
        "過暗比例上限",
        "Dark ratio max",
        "過暗像素比例超過此值時警告。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="exposure",
    )
    bright_level: int = param(
        225,
        "過亮灰階",
        "Bright level",
        "灰階值高於此值的像素視為過亮。",
        min=0,
        max=255,
        step=1,
        calibrate=True,
        group="exposure",
    )
    bright_ratio_max: float = param(
        0.5,
        "過亮比例上限",
        "Bright ratio max",
        "過亮像素比例超過此值時警告。注意白色包裝可能大面積超過過亮灰階。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="exposure",
    )
    min_short_side: int = param(
        480,
        "最小短邊",
        "Min short side",
        "影像短邊低於此值（像素）時警告解析度不足。",
        min=1,
        max=4320,
        step=1,
        calibrate=True,
        group="resolution",
    )

    def __post_init__(self) -> None:
        if self.blur_short_side <= 0 or self.min_short_side <= 0:
            raise ValueError("blur_short_side 與 min_short_side 必須為正整數")
        if not 0 <= self.dark_level <= self.bright_level <= 255:
            raise ValueError("須滿足 0 <= dark_level <= bright_level <= 255")
        for name in ("dark_ratio_max", "bright_ratio_max"):
            if not 0.0 <= getattr(self, name) <= 1.0:
                raise ValueError(f"{name} 必須介於 0 與 1")
