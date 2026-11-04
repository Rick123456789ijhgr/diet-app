"""半合成資料集：以真實照片為原圖，產生參數已知的劣化變體與 manifest（ADR 0005 第 1 點）。

設計見 ``docs/preprocess-experiment-design.md`` 第三、四章：

- 每個原圖（manifest 的一列）產生一張未劣化的 ``clean`` 與 ``VARIANT_CONDITIONS`` 中每個條件、
  每個等級各一張；一次只改變一項條件（4.1 節第 1 點），劣化過重的樣本也保留（第 4 點）。
- 複合情境（``COMPOSITE_CONDITIONS``，4.1 節第 3 點）依序套用多個單一條件，
  第 i 級為各成分的第 i 級；``condition`` 與 ``level`` 都以 ``+`` 連接各成分
  （例如 ``dark+blur``、``0.5+1``），與單一劣化分開報告。
- 變體跟著原圖的 ``split``（3.4 節）：影像寫在 ``splits/<split>/<source_id>/`` 下，
  測試集的變體因此同時受 ``split`` 欄與 ``splits/test`` 路徑兩道鎖保護。
- manifest 每列記錄 ``source_id``（統計分析的單位）、``condition``、``level`` 與隨機種子 ``seed``；
  產生參數另寫入 manifest 旁的同名 ``.json``，實驗紀錄會一併保存，可據此重新產生。
- 變體一律存成 PNG（無損），``jpeg`` 條件的壓縮失真才是唯一來源。

原圖先等比縮到長邊不超過 ``max_side``，各條件的等級（模糊 σ、移動長度等，以像素為單位）
才對不同手機拍的照片有一致的意義。
"""

from __future__ import annotations

import hashlib
import json
import zlib
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from dietai.evaluation.manifest import (
    SOURCE_COLUMN,
    Manifest,
    read_image,
    write_image,
    write_manifest,
)
from dietai.preprocess.types import Image
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
    reduce_contrast,
    rotate,
    salt_pepper,
    scale_brightness,
)

# 變體 manifest 固定的標籤欄（原圖的標籤欄接在後面）
VARIANT_COLUMNS = (SOURCE_COLUMN, "condition", "level", "seed")
CLEAN = "clean"


@dataclass(frozen=True)
class Condition:
    """一種劣化條件：``fn(影像, 等級, 種子)`` 與依序由輕到重的等級。"""

    fn: Callable[[Image, float, int], Image]
    levels: tuple[float, ...]
    unit: str  # 等級的意義，寫入產生參數


def _motion(img: Image, length: float, seed: int) -> Image:
    """手震方向由種子決定（0–180°），同一原圖的各等級方向相同、只差在長度。"""
    angle = float(np.random.default_rng(seed).uniform(0, 180))
    return motion_blur(img, length, angle)


# 條件 → 劣化函式與等級（設計第四章，每種 4 級）。等級以長邊 1600 px 的照片為準。
VARIANT_CONDITIONS: dict[str, Condition] = {
    "blur": Condition(lambda i, v, s: gaussian_blur(i, v), (1.0, 2.0, 3.0, 5.0), "高斯 σ（px）"),
    "motion": Condition(_motion, (5.0, 9.0, 15.0, 25.0), "移動長度（px），方向由種子決定"),
    "noise": Condition(gaussian_noise, (10.0, 20.0, 40.0, 60.0), "高斯雜訊標準差（灰階值）"),
    "salt_pepper": Condition(salt_pepper, (0.01, 0.03, 0.06, 0.1), "壞點比例"),
    "downscale": Condition(lambda i, v, s: downscale(i, v), (0.6, 0.35, 0.15, 0.08), "縮小倍率"),
    "dark": Condition(lambda i, v, s: scale_brightness(i, v), (0.5, 0.3, 0.15, 0.08), "亮度增益"),
    "contrast": Condition(
        lambda i, v, s: reduce_contrast(i, v), (0.6, 0.4, 0.25, 0.15), "對比倍率（以平均為中心）"
    ),
    "gradient": Condition(
        lambda i, v, s: brightness_gradient(i, v), (0.3, 0.6, 0.8, 0.95), "左右亮度梯度強度"
    ),
    "glare": Condition(add_glare, (0.1, 0.2, 0.3, 0.4), "光斑半徑／短邊，位置由種子決定"),
    "rotate": Condition(lambda i, v, s: rotate(i, v), (15.0, 30.0, 45.0, 80.0), "逆時針角度"),
    "perspective": Condition(
        perspective, (0.05, 0.1, 0.2, 0.3), "四角向內位移上限／寬高（斜拍），方向由種子決定"
    ),
    "curve": Condition(
        lambda i, v, s: cylinder_warp(i, v), (0.3, 0.5, 0.7, 0.85), "圓柱邊緣角度／90°"
    ),
    "jpeg": Condition(lambda i, v, s: jpeg(i, int(v)), (90.0, 70.0, 50.0, 30.0), "JPEG 品質"),
}


# 複合情境 → 依序套用的單一條件（名稱即以 + 連接的成分）。各成分的等級數須相同，第 i 級一起套用。
# 套用順序依拍攝的物理過程：先是物體本身（旋轉、曲面），再是斜拍與反光，最後是曝光與對焦
COMPOSITE_CONDITIONS: dict[str, tuple[str, ...]] = {
    "dark+blur": ("dark", "blur"),
    "rotate+perspective": ("rotate", "perspective"),
    "curve+glare": ("curve", "glare"),
}


def condition_levels(name: str) -> list[str]:
    """條件各等級在 manifest 中的寫法（由輕到重）。

    單一條件為數值，複合情境為各成分的等級以 ``+`` 連接。
    """
    if name in VARIANT_CONDITIONS:
        return [f"{v:g}" for v in VARIANT_CONDITIONS[name].levels]
    parts = [VARIANT_CONDITIONS[c].levels for c in COMPOSITE_CONDITIONS[name]]
    return ["+".join(f"{v:g}" for v in step) for step in zip(*parts, strict=True)]


def source_seed(source_id: str, seed: int) -> int:
    """原圖專屬的隨機種子：由 ``source_id`` 與整體 ``seed`` 決定，與原圖在 manifest 中的順序無關。

    之後加入新原圖不會改變既有原圖的變體。
    """
    return (zlib.crc32(source_id.encode("utf-8")) ^ seed) & 0x7FFFFFFF


def limit_side(img: Image, max_side: int | None) -> Image:
    """等比縮小到長邊不超過 ``max_side``（``None`` 或已夠小時回傳原陣列）。"""
    if max_side is None or max(img.shape[:2]) <= max_side:
        return img
    h, w = img.shape[:2]
    f = max_side / max(h, w)
    size = (max(1, round(w * f)), max(1, round(h * f)))
    return np.asarray(cv2.resize(img, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def write_variant_dataset(
    sources: Manifest,
    out_dir: str | Path,
    *,
    conditions: Sequence[str] | None = None,
    seed: int = 0,
    max_side: int | None = 1600,
) -> Path:
    """對 ``sources`` 的每張原圖寫出劣化變體與 ``manifest.csv``，回傳 manifest 路徑。

    ``conditions`` 為 ``VARIANT_CONDITIONS`` 與 ``COMPOSITE_CONDITIONS`` 的子集（省略時全部，
    單一條件在前）。原圖的 ``id`` 即 ``source_id``，
    ``truth``、``split`` 與標籤欄照抄到每個變體。每張原圖都必須有 ``split``（dev／test），
    否則丟 ``ValueError``：切分以原始樣本為單位，變體不能各自決定。
    ``sources`` 是否含測試集由呼叫端以 ``read_manifest(include_test=...)`` 決定。
    ``out_dir`` 已存在且非空時丟 ``FileExistsError``（資料集不覆寫）。
    """
    available = [*VARIANT_CONDITIONS, *COMPOSITE_CONDITIONS]
    names = available if conditions is None else list(conditions)
    unknown = [c for c in names if c not in available]
    if unknown:
        raise ValueError(f"沒有這些劣化條件：{unknown}；可用：{available}")
    if not sources.items:
        raise ValueError("來源 manifest 沒有任何原圖")
    missing = [i.id for i in sources.items if not i.split]
    if missing:
        raise ValueError(f"這些原圖沒有 split，請先以原始樣本為單位切分：{missing[:5]}")
    clash = set(sources.tag_columns) & set(VARIANT_COLUMNS)
    if clash:
        raise ValueError(f"來源 manifest 的標籤欄與變體欄位同名：{sorted(clash)}")
    if max_side is not None and max_side < 1:
        raise ValueError(f"max_side 至少為 1，收到 {max_side}")
    out = Path(out_dir)
    if out.exists() and any(out.iterdir()):
        raise FileExistsError(f"輸出資料夾已存在且非空，資料集不覆寫：{out}")

    rows: list[dict[str, str]] = []
    for item in sources.items:
        base = limit_side(read_image(item.image), max_side)
        s = source_seed(item.id, seed)
        # 以原圖代碼當資料夾名稱；把路徑分隔字元換掉，避免寫到別處
        folder = Path("splits") / item.split / item.id.replace("/", "_").replace("\\", "_")

        for condition, level, img in _degraded(base, names, s):
            rel = (folder / f"{condition}_{level}.png").as_posix()
            write_image(out / rel, img)
            rows.append(
                {
                    "id": f"{item.id}__{condition}_{level}",
                    "image": rel,
                    "truth": item.truth,
                    "split": item.split,
                    SOURCE_COLUMN: item.id,
                    "condition": condition,
                    "level": level,
                    "seed": str(s),
                    **item.tags,
                }
            )

    manifest = write_manifest(out / "manifest.csv", rows, (*VARIANT_COLUMNS, *sources.tag_columns))
    params = {
        "generator": "dietai.synthetic.write_variant_dataset",
        "sources": {
            "path": str(sources.path),
            "sha256": sources.sha256,
            "items": len(sources.items),
            "excluded_test": sources.excluded_test,
        },
        "seed": seed,
        "max_side": max_side,
        "conditions": {n: _condition_params(n) for n in names},
        "code_sha256": _code_hash(),
    }
    manifest.with_suffix(".json").write_text(
        json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def _condition_params(name: str) -> dict[str, object]:
    """寫入產生參數的條件說明；複合情境另列成分。"""
    if name in VARIANT_CONDITIONS:
        cond = VARIANT_CONDITIONS[name]
        return {"levels": list(cond.levels), "unit": cond.unit}
    parts = COMPOSITE_CONDITIONS[name]
    return {"parts": list(parts), "levels": condition_levels(name), "unit": "各成分的等級以 + 連接"}


def _degraded(base: Image, names: Sequence[str], seed: int) -> Iterator[tuple[str, str, Image]]:
    """依序產生（條件, 等級, 影像）：先是未劣化的 ``clean``，再是各條件的各等級。

    複合情境依序套用各成分，各成分使用同一個種子（與單獨套用時相同）。
    惰性產生，一次只保留一張變體在記憶體中（真實照片很大）。
    """
    yield CLEAN, "0", base
    for name in names:
        parts = COMPOSITE_CONDITIONS.get(name, (name,))
        levels = zip(*(VARIANT_CONDITIONS[c].levels for c in parts), strict=True)
        for label, step in zip(condition_levels(name), levels, strict=True):
            img = base
            for c, v in zip(parts, step, strict=True):
                img = VARIANT_CONDITIONS[c].fn(img, v, seed)
            yield name, label, img


def _code_hash() -> str:
    """劣化程式（``degrade.py`` 與本檔）的雜湊；改了劣化程式，同樣參數就不保證得到同樣影像。"""
    here = Path(__file__).parent
    h = hashlib.sha256()
    for name in ("degrade.py", "variants.py"):
        h.update((here / name).read_bytes())
    return h.hexdigest()[:16]
