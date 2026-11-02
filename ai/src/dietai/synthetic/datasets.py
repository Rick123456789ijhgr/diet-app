"""合成實驗資料集：把合成場景與已知退化寫成影像檔＋manifest，讓實驗腳本能端到端跑通。

不代表真實拍攝條件；正式結論須用真實照片（DVC 管理於 ``research/data/``）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np

from dietai.evaluation.manifest import SOURCE_COLUMN, write_image, write_manifest
from dietai.preprocess.types import Image
from dietai.synthetic.degrade import (
    brightness_gradient,
    downscale,
    gaussian_blur,
    gaussian_noise,
    rotate,
    scale_brightness,
)
from dietai.synthetic.scenes import (
    _LABEL_ROWS,
    ean13_codes,
    ean13_scene,
    label_perspective_scene,
    label_scene,
)

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
# 各等級的意義依退化函式而定：blur 為高斯 sigma（px）、rotate 為逆時針角度、downscale 為
# 縮小倍率、gradient 為左右亮度梯度強度、dark 為亮度增益、noise 為雜訊標準差（灰階值）。
# manifest 的標籤欄；E1 報告可用 ``--by condition`` 等依此分組。``source_id`` 為條碼代碼
# （``c00``…；負樣本各自一個），同一條碼的各種退化屬於同一個原始樣本，統計時視為一個集群。
TAG_COLUMNS = (SOURCE_COLUMN, "condition", "level")


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
    標籤欄為 ``source_id``（條碼代碼）、``condition``、``level``，``split`` 一律為 ``dev``。
    產生參數另寫入 ``manifest.json``（實驗紀錄會一併保存），相同參數產生相同影像。
    """
    if n_codes < 1:
        raise ValueError(f"n_codes 至少為 1，收到 {n_codes}")
    out = Path(out_dir)
    rows: list[dict[str, str]] = []

    def add(name: str, img: Image, truth: str, condition: str, level: float, source: str) -> None:
        """寫出一張影像並登記一列 manifest；``image`` 用相對路徑，資料夾搬動後仍可讀。"""
        rel = f"images/{name}.png"
        write_image(out / rel, img)
        rows.append(
            {
                "id": name,
                "image": rel,
                "truth": truth,
                "split": "dev",
                SOURCE_COLUMN: source,
                "condition": condition,
                # ``:g`` 讓 1.0 寫成 "1"、0.35 寫成 "0.35"，與影像檔名一致
                "level": f"{level:g}",
            }
        )

    # 條碼內容由 seed 決定（互不相同、檢查碼正確）；每個條碼先畫一張無退化的基準影像，
    # 再對同一張基準影像套用每個條件的每個等級，因此各影像之間只差在退化本身。
    for i, code in enumerate(ean13_codes(n_codes, seed)):
        base = ean13_scene(code, module_px)
        add(f"c{i:02d}_clean", base, code, "clean", 0, f"c{i:02d}")
        for condition, (fn, levels) in BARCODE_CONDITIONS.items():
            for level in levels:
                if fn is gaussian_noise:
                    # 唯一有隨機性的退化：種子取 seed + i，不同條碼的雜訊不同、整體仍可重現
                    # （同一條碼的各等級共用同一個種子，只差在標準差）
                    img = gaussian_noise(base, level, seed=seed + i)
                else:
                    img = fn(base, level)
                add(f"c{i:02d}_{condition}_{level:g}", img, code, condition, level, f"c{i:02d}")
    if negatives:
        # 負樣本與正樣本同尺寸（EAN-13 符號寬度與內容無關，取任一條碼量尺寸即可）：
        # 一張是縮放後的標示文字（有大量邊緣、容易誘發誤報），一張是純紙色。
        h, w = ean13_scene(ean13_codes(1, seed)[0], module_px).shape[:2]
        text = np.asarray(
            cv2.resize(label_scene(seed=seed), (w, h), interpolation=cv2.INTER_AREA),
            dtype=np.uint8,
        )
        add("neg_label", text, "", "negative", 0, "neg_label")
        add(
            "neg_paper",
            np.full((h, w, 3), (235, 240, 242), dtype=np.uint8),
            "",
            "negative",
            0,
            "neg_paper",
        )

    manifest = write_manifest(out / "manifest.csv", rows, TAG_COLUMNS)
    # 產生參數寫成 manifest 旁的同名 .json；``evaluation.barcode`` 執行實驗時會把它
    # 一併存入 ``run.json``（``manifest.dataset``），日後可依此重新產生同一份資料。
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


# 合成營養標示的真值：與 ``scenes.nutrition_label`` 畫出的各列一致（只有每份一欄）
LABEL_TRUTH: dict[str, object] = {
    "columns": ["per_serving"],
    "header": {"serving_size": "30 g", "servings": "6"},
    "facts": {
        "energy": ["152 kcal"],
        "protein": ["2.1 g"],
        "fat": ["8.4 g"],
        "saturated_fat": ["3.2 g"],
        "trans_fat": ["0 g"],
        "carbohydrate": ["17.0 g"],
        "sugar": ["1.5 g"],
        "sodium": ["125 mg"],
    },
}


def write_label_dataset(
    out_dir: str | Path,
    n: int = 4,
    seed: int = 0,
    strength: float = 0.15,
) -> Path:
    """在 ``out_dir`` 寫出合成營養標示（透視變形貼在桌面上）、各自的真值 JSON 與 ``manifest.csv``。

    每張影像的透視由 ``seed + i`` 決定；真值含欄位（``LABEL_TRUTH``）、真實四角與全文。
    標籤欄為 ``source_id``（每張各自一個）與 ``strength``，``split`` 一律為 ``dev``。
    內容為英文（OpenCV 無法繪製中文），只供演練流程，不代表真實營養標示。
    """
    if n < 1:
        raise ValueError(f"n 至少為 1，收到 {n}")
    out = Path(out_dir)
    text = "\n".join(["Nutrition Facts", *(f"{k.strip()} {v}" for k, v in _LABEL_ROWS)])
    rows: list[dict[str, str]] = []
    for i in range(n):
        name = f"l{i:02d}"
        img, quad = label_perspective_scene(strength=strength, seed=seed + i)
        write_image(out / "images" / f"{name}.png", img)
        truth = {**LABEL_TRUTH, "quad": np.asarray(quad).round(2).tolist(), "text": text}
        truth_rel = f"truth/{name}.json"
        (out / "truth").mkdir(parents=True, exist_ok=True)
        (out / truth_rel).write_text(json.dumps(truth, ensure_ascii=False, indent=2), "utf-8")
        rows.append(
            {
                "id": name,
                "image": f"images/{name}.png",
                "truth": truth_rel,
                "split": "dev",
                SOURCE_COLUMN: name,
                "strength": f"{strength:g}",
            }
        )
    manifest = write_manifest(out / "manifest.csv", rows, (SOURCE_COLUMN, "strength"))
    params = {
        "generator": "dietai.synthetic.write_label_dataset",
        "n": n,
        "seed": seed,
        "strength": strength,
    }
    manifest.with_suffix(".json").write_text(
        json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest
