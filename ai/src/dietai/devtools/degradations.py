"""模擬退化設定，實際運算全部呼叫 ``dietai.synthetic``。

``Degradation`` 與前處理設定走同一套流程：以 ``param()`` 宣告欄位（列在
``schema.SCHEMA_CLASSES``，自動產生表單），前端送來的覆寫經 ``configs.config_from_override``
驗證。``SWEEP_AXES`` 則定義參數掃描（``sweep``）可選的退化種類。
"""

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
    curvature: float = param(
        0.0,
        "曲面",
        "Curvature",
        "貼在圓柱（瓶身、罐身）上的彎曲程度：邊緣角度為此值 × 90°；0 為平面。",
        min=0.0,
        max=0.95,
        step=0.05,
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
    motion_len: float = param(
        0.0,
        "手震長度",
        "Motion blur",
        "手震模糊的移動長度（像素）；0 為不模糊。",
        min=0.0,
        max=60.0,
        step=1.0,
        group="optics",
    )
    motion_angle: float = param(
        0.0,
        "手震方向",
        "Motion angle",
        "手震方向（度），0 為水平、正值為逆時針。",
        min=0.0,
        max=180.0,
        step=5.0,
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
    contrast: float = param(
        1.0,
        "對比",
        "Contrast",
        "以平均亮度為中心壓縮動態範圍的倍率；1 為不變。",
        min=0.0,
        max=1.0,
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
    salt_pepper: float = param(
        0.0,
        "椒鹽雜訊",
        "Salt & pepper",
        "變成全黑或全白的像素比例。",
        min=0.0,
        max=0.3,
        step=0.01,
        group="optics",
    )
    jpeg_quality: int = param(
        0,
        "JPEG 品質",
        "JPEG quality",
        "以此品質重新壓縮；0 為不壓縮。",
        min=0,
        max=100,
        step=5,
        group="optics",
    )
    seed: int = param(
        0,
        "隨機種子",
        "Seed",
        "光斑位置、高斯與椒鹽雜訊的隨機種子。",
        min=0,
        max=10_000,
        step=1,
        group="random",
    )

    def __post_init__(self) -> None:
        """只擋會讓退化函式出錯或無意義的值；``param()`` 的 min／max 只用於表單，不在此強制。"""
        if not 0 < self.scale <= 1:
            raise ValueError(f"scale 必須介於 0（不含）與 1，收到 {self.scale}")
        for name in (
            "blur_sigma",
            "motion_len",
            "gain",
            "gradient",
            "glare",
            "noise_std",
            "jpeg_quality",
            "seed",
        ):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 不得為負，收到 {getattr(self, name)}")
        if not 0 <= self.curvature < 1:
            raise ValueError(f"curvature 必須介於 0 與 1（不含 1），收到 {self.curvature}")
        if not 0 <= self.contrast <= 1:
            raise ValueError(f"contrast 必須介於 0 與 1，收到 {self.contrast}")
        if not 0 <= self.salt_pepper <= 1:
            raise ValueError(f"salt_pepper 必須介於 0 與 1，收到 {self.salt_pepper}")
        if self.jpeg_quality > 100:
            raise ValueError(f"jpeg_quality 不得超過 100，收到 {self.jpeg_quality}")

    def is_identity(self) -> bool:
        """是否不做任何退化（只改種子不算）；server 端據此直接回傳原圖，不另存一份。"""
        return self.active_count() == 0

    def active_count(self) -> int:
        """啟用（非預設值）的退化項目數；種子與手震方向單獨改變時不算。"""
        default = Degradation()
        return sum(getattr(self, f) != getattr(default, f) for f in _EFFECT_FIELDS)


# 會改變影像的欄位（種子與手震方向單獨不改變影像，不算）
_EFFECT_FIELDS = (
    "rotate_deg",
    "curvature",
    "scale",
    "blur_sigma",
    "motion_len",
    "gain",
    "contrast",
    "gradient",
    "glare",
    "noise_std",
    "salt_pepper",
    "jpeg_quality",
)


def apply(img: Image, d: Degradation) -> Image:
    """依序套用退化；回傳新陣列。

    順序固定為：旋轉 → 曲面 → 縮小 → 模糊 → 手震 → 亮度 → 對比 → 梯度 → 光斑 → 高斯雜訊
    → 椒鹽雜訊 → JPEG（同欄位順序；JPEG 是拍完後的儲存，放在最後）。
    值為預設值的項目整個跳過，未啟用的退化不會碰到影像；光斑與兩種雜訊共用 ``seed``，
    相同參數產生相同結果。
    """
    out = img.copy()
    if d.rotate_deg:
        out = synthetic.rotate(out, d.rotate_deg)
    if d.curvature:
        out = synthetic.cylinder_warp(out, d.curvature)
    if d.scale != 1.0:
        out = synthetic.downscale(out, d.scale)
    if d.blur_sigma:
        out = synthetic.gaussian_blur(out, d.blur_sigma)
    if d.motion_len:
        out = synthetic.motion_blur(out, d.motion_len, d.motion_angle)
    if d.gain != 1.0:
        out = synthetic.scale_brightness(out, d.gain)
    if d.contrast != 1.0:
        out = synthetic.reduce_contrast(out, d.contrast)
    if d.gradient:
        out = synthetic.brightness_gradient(out, d.gradient)
    if d.glare:
        out = synthetic.add_glare(out, d.glare, seed=d.seed)
    if d.noise_std:
        out = synthetic.gaussian_noise(out, d.noise_std, seed=d.seed)
    if d.salt_pepper:
        out = synthetic.salt_pepper(out, d.salt_pepper, seed=d.seed)
    if d.jpeg_quality:
        out = synthetic.jpeg(out, d.jpeg_quality)
    return out


@dataclass(frozen=True)
class SweepAxis:
    """參數掃描的一個維度。

    ``fn(影像, 等級)`` 只收兩個參數，因此光斑與雜訊使用 ``synthetic`` 函式的預設種子。
    """

    label: str  # 中文
    label_en: str
    lo: float  # 允許的範圍下限（sweep.parse_axis 檢查）
    hi: float  # 允許的範圍上限
    default_lo: float  # 前端未指定時的掃描起點
    default_hi: float  # 前端未指定時的掃描終點
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
    """掃描結果中第一個出現 ``code`` 警告的等級；都沒有則回傳 ``None``。

    ``warnings`` 每個元素是該等級以「, 」串接的警告代碼（``sweep.quality_sweep`` 產生）。
    """
    for level, codes in zip(levels, warnings, strict=True):
        if code in codes.split(", "):
            return level
    return None


def sweep_levels(lo: float, hi: float, n: int) -> list[float]:
    """在 [lo, hi] 間等距取 n 個值（n ≥ 2）。"""
    if n < 2:
        raise ValueError("掃描點數至少為 2")
    return [lo + (hi - lo) * i / (n - 1) for i in range(n)]
