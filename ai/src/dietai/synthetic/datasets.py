"""合成實驗資料集：把合成場景與已知退化寫成影像檔＋manifest，讓實驗腳本能端到端跑通。

不代表真實拍攝條件；正式結論須用真實照片（DVC 管理於 ``research/data/``）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np

from dietai.evaluation.manifest import write_image, write_manifest
from dietai.preprocess.types import Image
from dietai.synthetic.degrade import (
    brightness_gradient,
    downscale,
    gaussian_blur,
    gaussian_noise,
    rotate,
    scale_brightness,
)
from dietai.synthetic.scenes import ean13_codes, ean13_scene, label_scene

# 條件 → 退化函式與等級。等級以模組寬 3 px 的 EAN-13 試出：涵蓋「只用原圖就成功」、
# 「只用原圖失敗、逐步升級救回」與「兩者都失敗」三種情形，讓消融結果有差異可看。
BARCODE_CONDITIONS: dict[str, tuple[Callable[[Image, float], Image], tuple[float, ...]]] = {
    "blur": (gaussian_blur, (1.0, 1.5, 2.5)),
    "rotate": (rotate, (15.0, 30.0, 45.0)),
    "downscale": (downscale, (0.5, 0.35)),
    "gradient": (brightness_gradient, (0.6, 0.9)),
    "dark": (scale_brightness, (0.15, 0.08)),
    "noise": (gaussian_noise, (20.0, 40.0, 80.0)),
}
TAG_COLUMNS = ("condition", "level")


def write_barcode_dataset(
    out_dir: str | Path,
    n_codes: int = 4,
    seed: int = 0,
    module_px: int = 3,
    negatives: bool = True,
) -> Path:
    """在 ``out_dir`` 寫出合成 EAN-13 影像（PNG）與 ``manifest.csv``，回傳 manifest 路徑。

    每個條碼產生一張無退化影像（``condition=clean``）與 ``BARCODE_CONDITIONS`` 中每個等級
    各一張；``negatives`` 為 ``True`` 時另加兩張沒有條碼的負樣本（``truth`` 為空）。
    標籤欄為 ``condition``、``level``，``split`` 一律為 ``dev``。
    產生參數另寫入 ``manifest.json``（實驗紀錄會一併保存），相同參數產生相同影像。
    """
    if n_codes < 1:
        raise ValueError(f"n_codes 至少為 1，收到 {n_codes}")
    out = Path(out_dir)
    rows: list[dict[str, str]] = []

    def add(name: str, img: Image, truth: str, condition: str, level: float) -> None:
        rel = f"images/{name}.png"
        write_image(out / rel, img)
        rows.append(
            {
                "id": name,
                "image": rel,
                "truth": truth,
                "split": "dev",
                "condition": condition,
                "level": f"{level:g}",
            }
        )

    for i, code in enumerate(ean13_codes(n_codes, seed)):
        base = ean13_scene(code, module_px)
        add(f"c{i:02d}_clean", base, code, "clean", 0)
        for condition, (fn, levels) in BARCODE_CONDITIONS.items():
            for level in levels:
                if fn is gaussian_noise:
                    img = gaussian_noise(base, level, seed=seed + i)
                else:
                    img = fn(base, level)
                add(f"c{i:02d}_{condition}_{level:g}", img, code, condition, level)
    if negatives:
        h, w = ean13_scene(ean13_codes(1, seed)[0], module_px).shape[:2]
        text = np.asarray(
            cv2.resize(label_scene(seed=seed), (w, h), interpolation=cv2.INTER_AREA),
            dtype=np.uint8,
        )
        add("neg_label", text, "", "negative", 0)
        add("neg_paper", np.full((h, w, 3), (235, 240, 242), dtype=np.uint8), "", "negative", 0)

    manifest = write_manifest(out / "manifest.csv", rows, TAG_COLUMNS)
    params = {
        "generator": "dietai.synthetic.write_barcode_dataset",
        "n_codes": n_codes,
        "seed": seed,
        "module_px": module_px,
        "negatives": negatives,
        "conditions": {k: list(v[1]) for k, v in BARCODE_CONDITIONS.items()},
    }
    manifest.with_suffix(".json").write_text(
        json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest
