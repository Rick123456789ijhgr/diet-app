"""前處理的所有門檻與參數。

數值皆為合理預設值，標示「待校準」者須由研究組以標記照片（100–200 張）校準，
校準時不得使用 test split（見根目錄 CLAUDE.md 規則 7）。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class QualityConfig:
    """共通品質檢查（``dietai.preprocess.quality``）的參數。"""

    # 計算模糊分數前先把影像縮放到此短邊（像素），使不同解析度的分數可比較。
    blur_short_side: int = 480
    # 拉普拉斯變異數低於此值視為過於模糊。待校準。
    blur_min: float = 100.0
    # 灰階值低於此值的像素視為過暗。待校準。
    dark_level: int = 30
    # 過暗像素比例超過此值時警告。待校準。
    dark_ratio_max: float = 0.5
    # 灰階值高於此值的像素視為過亮。待校準。
    bright_level: int = 225
    # 過亮像素比例超過此值時警告。待校準。
    bright_ratio_max: float = 0.5
    # 影像短邊低於此值（像素）時警告解析度不足。待校準。
    min_short_side: int = 480

    def __post_init__(self) -> None:
        if self.blur_short_side <= 0 or self.min_short_side <= 0:
            raise ValueError("blur_short_side 與 min_short_side 必須為正整數")
        if not 0 <= self.dark_level <= self.bright_level <= 255:
            raise ValueError("須滿足 0 <= dark_level <= bright_level <= 255")
        for name in ("dark_ratio_max", "bright_ratio_max"):
            if not 0.0 <= getattr(self, name) <= 1.0:
                raise ValueError(f"{name} 必須介於 0 與 1")
