"""合成影像與已知退化（需安裝 ``vision`` extra）。

測試（``tests/``）、工作台（``workbench/``）與研究實驗共用，避免各自複製產生邏輯。
``write_barcode_dataset`` 把合成條碼寫成影像檔＋manifest，供 E1 實驗腳本端到端跑通；
``write_variant_dataset`` 由真實照片產生劣化變體（半合成，正式實驗用）。
"""

# 合成實驗資料集：影像檔＋manifest（E1 端到端用）
from dietai.synthetic.datasets import (
    INVOICE_CONDITIONS,
    invoice_contents,
    write_barcode_dataset,
    write_invoice_dataset,
    write_label_dataset,
)

# 已知程度的退化：模糊、手震、旋轉、透視、縮小、曲面、光線、對比、雜訊、反光、JPEG 等拍攝條件
from dietai.synthetic.degrade import (
    add_glare,
    brightness_gradient,
    cylinder_warp,
    downscale,
    gaussian_blur,
    gaussian_noise,
    jpeg,
    motion_blur,
    perspective,
    perspective_matrix,
    reduce_contrast,
    rotate,
    salt_pepper,
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

# 半合成資料集：真實照片 → 參數已知的劣化變體＋manifest（含 source_id，ADR 0005）
from dietai.synthetic.variants import (
    COMPOSITE_CONDITIONS,
    VARIANT_CONDITIONS,
    condition_levels,
    write_variant_dataset,
)

__all__ = [
    "COMPOSITE_CONDITIONS",
    "INVOICE_CONDITIONS",
    "VARIANT_CONDITIONS",
    "add_glare",
    "brightness_gradient",
    "condition_levels",
    "cylinder_warp",
    "downscale",
    "ean13_codes",
    "ean13_scene",
    "food_scene",
    "gaussian_blur",
    "gaussian_noise",
    "invoice_contents",
    "invoice_qr_scene",
    "jpeg",
    "label_perspective_scene",
    "label_scene",
    "motion_blur",
    "nutrition_label",
    "perspective",
    "perspective_matrix",
    "reduce_contrast",
    "rotate",
    "salt_pepper",
    "scale_brightness",
    "write_barcode_dataset",
    "write_invoice_dataset",
    "write_label_dataset",
    "write_variant_dataset",
]
