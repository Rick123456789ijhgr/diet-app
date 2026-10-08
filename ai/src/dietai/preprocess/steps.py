"""基本前處理步驟。

需要 OpenCV 的步驟請放在 ``steps_cv.py``（依賴 ``pip install -e ".[vision]"``），
並以相同的 ``@register`` 方式註冊。
"""

import numpy as np

from dietai.preprocess.pipeline import register


@register("gray")
def to_gray(image: np.ndarray) -> np.ndarray:
    """RGB 轉灰階（ITU-R BT.601 權重）。已是灰階則原樣回傳。"""
    if image.ndim == 2:
        return image
    weights = np.array([0.299, 0.587, 0.114])
    return (image[..., :3] @ weights).round().astype(np.uint8)
