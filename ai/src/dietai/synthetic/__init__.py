"""合成影像與已知退化（需安裝 ``vision`` extra）。

測試（``tests/``）、工作台（``workbench/``）與研究實驗共用，避免各自複製產生邏輯。
"""

from dietai.synthetic.degrade import (
    add_glare,
    brightness_gradient,
    downscale,
    gaussian_blur,
    gaussian_noise,
    rotate,
    scale_brightness,
)
from dietai.synthetic.scenes import label_scene

__all__ = [
    "add_glare",
    "brightness_gradient",
    "downscale",
    "gaussian_blur",
    "gaussian_noise",
    "label_scene",
    "rotate",
    "scale_brightness",
]
