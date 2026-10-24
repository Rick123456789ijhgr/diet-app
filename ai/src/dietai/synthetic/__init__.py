"""合成影像與已知退化（需安裝 ``vision`` extra）。

測試（``tests/``）、工作台（``workbench/``）與研究實驗共用，避免各自複製產生邏輯。
``write_barcode_dataset`` 把合成條碼寫成影像檔＋manifest，供 E1 實驗腳本端到端跑通。
"""

# 合成實驗資料集：影像檔＋manifest（E1 端到端用）
from dietai.synthetic.datasets import write_barcode_dataset

# 已知程度的退化：模擬模糊、旋轉、縮小、光線不均、雜訊、反光等拍攝條件
from dietai.synthetic.degrade import (
    add_glare,
    brightness_gradient,
    downscale,
    gaussian_blur,
    gaussian_noise,
    rotate,
    scale_brightness,
)

# 合成場景：條碼、電子發票 QR、營養標示（含透視變形）、餐桌食物
from dietai.synthetic.scenes import (
    ean13_codes,
    ean13_scene,
    food_scene,
    invoice_qr_scene,
    label_perspective_scene,
    label_scene,
    nutrition_label,
)

__all__ = [
    "add_glare",
    "brightness_gradient",
    "downscale",
    "ean13_codes",
    "ean13_scene",
    "food_scene",
    "gaussian_blur",
    "gaussian_noise",
    "invoice_qr_scene",
    "label_perspective_scene",
    "label_scene",
    "nutrition_label",
    "rotate",
    "scale_brightness",
    "write_barcode_dataset",
]
