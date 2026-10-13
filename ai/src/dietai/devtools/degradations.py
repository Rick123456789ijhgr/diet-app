"""模擬退化設定，實際運算全部呼叫 ``dietai.synthetic``。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from dietai import synthetic
from dietai.preprocess.config import param
from dietai.preprocess.types import Image


@dataclass(frozen=True)
class Degradation:
    """一組退化參數；全部為預設值時不改變影像。套用順序同欄位順序。

    以 ``param()`` 宣告，工作台據此自動產生退化表單（分組：geometry、optics、lighting、random）。
    """

    rotate_deg: float = param(
        0.0,
        "旋轉",
        "Rotate",
        "旋轉角度（度），正值為逆時針。",
        min=-90.0,
        max=90.0,
        step=1.0,
        group="geometry",
    )
    scale: float = param(
        1.0,
        "縮小",
        "Scale",
        "縮小倍率；1 為不縮小。",
        min=0.05,
        max=1.0,
        step=0.05,
        group="geometry",
    )
    blur_sigma: float = param(
        0.0,
        "模糊 σ",
        "Blur",
        "高斯模糊的標準差（像素）。",
        min=0.0,
        max=20.0,
        step=0.5,
        group="optics",
    )
    gain: float = param(
        1.0,
        "亮度",
        "Gain",
        "整體亮度倍率；1 為不變。",
        min=0.0,
        max=3.0,
        step=0.05,
        group="lighting",
    )
    gradient: float = param(
        0.0,
        "梯度",
        "Gradient",
        "由左到右的亮度梯度強度。",
        min=0.0,
        max=1.0,
        step=0.05,
        group="lighting",
    )
    glare: float = param(
        0.0,
        "光斑",
        "Glare",
        "光斑半徑相對於短邊的比例。",
        min=0.0,
        max=0.6,
        step=0.02,
        group="lighting",
    )
    noise_std: float = param(
        0.0,
        "雜訊",
        "Noise",
        "高斯雜訊的標準差（灰階值）。",
        min=0.0,
        max=80.0,
        step=1.0,
        group="optics",
    )
    seed: int = param(
        0,
        "隨機種子",
        "Seed",
        "光斑位置與雜訊的隨機種子。",
        min=0,
        max=10_000,
        step=1,
        group="random",
    )

    def __post_init__(self) -> None:
        if not 0 < self.scale <= 1:
            raise ValueError(f"scale 必須介於 0（不含）與 1，收到 {self.scale}")
        for name in ("blur_sigma", "gain", "gradient", "glare", "noise_std", "seed"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 不得為負，收到 {getattr(self, name)}")

    def is_identity(self) -> bool:
        return self.active_count() == 0

    def active_count(self) -> int:
        """啟用（非預設值）的退化項目數，種子不算。"""
        default = Degradation()
        return sum(
            getattr(self, f) != getattr(default, f)
            for f in ("rotate_deg", "scale", "blur_sigma", "gain", "gradient", "glare", "noise_std")
        )


def apply(img: Image, d: Degradation) -> Image:
    """依序套用退化；回傳新陣列。"""
    out = img.copy()
    if d.rotate_deg:
        out = synthetic.rotate(out, d.rotate_deg)
    if d.scale != 1.0:
        out = synthetic.downscale(out, d.scale)
    if d.blur_sigma:
        out = synthetic.gaussian_blur(out, d.blur_sigma)
    if d.gain != 1.0:
        out = synthetic.scale_brightness(out, d.gain)
    if d.gradient:
        out = synthetic.brightness_gradient(out, d.gradient)
    if d.glare:
        out = synthetic.add_glare(out, d.glare, seed=d.seed)
    if d.noise_std:
        out = synthetic.gaussian_noise(out, d.noise_std, seed=d.seed)
    return out


@dataclass(frozen=True)
class SweepAxis:
    """參數掃描的一個維度。"""

    label: str  # 中文
    label_en: str
    lo: float
    hi: float
    default_lo: float
    default_hi: float
    fn: Callable[[Image, float], Image]


SWEEP_AXES: dict[str, SweepAxis] = {
    "blur_sigma": SweepAxis(
        "高斯模糊 σ", "Gaussian blur σ", 0.0, 20.0, 0.0, 8.0, synthetic.gaussian_blur
    ),
    "gain": SweepAxis(
        "整體亮度倍率", "Brightness gain", 0.0, 3.0, 0.1, 2.0, synthetic.scale_brightness
    ),
    "gradient": SweepAxis(
        "亮度梯度強度", "Brightness gradient", 0.0, 1.0, 0.0, 0.9, synthetic.brightness_gradient
    ),
    "scale": SweepAxis("縮小倍率", "Downscale factor", 0.05, 1.0, 0.1, 1.0, synthetic.downscale),
    "noise_std": SweepAxis(
        "高斯雜訊標準差", "Gaussian noise std", 0.0, 80.0, 0.0, 40.0, synthetic.gaussian_noise
    ),
    "glare": SweepAxis(
        "光斑半徑比例", "Glare radius ratio", 0.0, 0.6, 0.0, 0.4, synthetic.add_glare
    ),
    "rotate_deg": SweepAxis("旋轉角度", "Rotation (deg)", -90.0, 90.0, 0.0, 45.0, synthetic.rotate),
}


def first_trigger(levels: list[float], warnings: list[str], code: str) -> float | None:
    """掃描結果中第一個出現 ``code`` 警告的等級；都沒有則回傳 ``None``。"""
    for level, codes in zip(levels, warnings, strict=True):
        if code in codes.split(", "):
            return level
    return None


def sweep_levels(lo: float, hi: float, n: int) -> list[float]:
    """在 [lo, hi] 間等距取 n 個值（n ≥ 2）。"""
    if n < 2:
        raise ValueError("掃描點數至少為 2")
    return [lo + (hi - lo) * i / (n - 1) for i in range(n)]
