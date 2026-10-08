"""工作台的模擬退化設定，實際運算全部呼叫 ``dietai.synthetic``。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from dietai import synthetic
from dietai.preprocess.types import Image


@dataclass(frozen=True)
class Degradation:
    """一組退化參數；全部為預設值時不改變影像。套用順序同欄位順序。"""

    rotate_deg: float = 0.0
    scale: float = 1.0
    blur_sigma: float = 0.0
    gain: float = 1.0
    gradient: float = 0.0
    glare: float = 0.0
    noise_std: float = 0.0
    seed: int = 0

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
