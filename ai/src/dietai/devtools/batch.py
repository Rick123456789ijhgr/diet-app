"""資料夾批次：對本機資料夾的照片逐張做品質檢查，逐張產生事件（供 SSE 回報進度）。

路徑一律經 ``images.guard_path`` 的測試集鎖定（根目錄 CLAUDE.md 規則 7）。
路徑也可以是單一檔案：只處理那一張，並把影像存進暫存區，讓介面檢視該張的細節。
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from dietai.devtools.images import guard_path, list_images, load_image
from dietai.preprocess import QualityConfig, check_quality
from dietai.preprocess.quality import QUALITY_WARNINGS
from dietai.preprocess.types import Image

MAX_LIMIT = 5000

# 把單一檔案存進暫存區並回傳 image_id
Keep = Callable[[Image, str], str]


def iter_batch(
    path: str,
    cfg: QualityConfig,
    *,
    recursive: bool = False,
    limit: int = 500,
    keep: Keep | None = None,
) -> Iterator[dict[str, Any]]:
    """依序產生事件：

    - ``{"type": "start", "total": n, "folder": ...}``
    - 每張一個 ``{"type": "row", "index": i, ...品質檢查結果}``；讀檔失敗時 ``error`` 不為空
    - ``{"type": "summary", ...}``：張數、通過率、各警告張數、讀取失敗數

    ``path`` 為檔案時只處理該檔，``keep`` 不為 None 時把影像存起來並在列中附上 ``image_id``。
    """
    resolved = guard_path(path)
    if resolved.is_file():
        files = [resolved]
    else:
        files = list_images(resolved, recursive=recursive, limit=min(max(limit, 1), MAX_LIMIT))
    yield {"type": "start", "total": len(files), "folder": str(resolved)}
    rows: list[dict[str, Any]] = []
    for i, f in enumerate(files):
        row = _check(f, cfg, keep if resolved.is_file() else None)
        rows.append(row)
        yield {"type": "row", "index": i, **row}
    yield {"type": "summary", **summarize(rows)}


def _check(path: Path, cfg: QualityConfig, keep: Keep | None) -> dict[str, Any]:
    base: dict[str, Any] = {"file": path.name, "path": str(path)}
    try:
        img = load_image(path)
    except (OSError, ValueError) as exc:
        return {**base, "error": str(exc)}
    r = check_quality(img, cfg)
    row = {
        **base,
        "short_side": int(min(img.shape[:2])),
        "blur_score": r.blur_score,
        "mean_brightness": r.exposure.mean,
        "dark_ratio": r.exposure.dark_ratio,
        "bright_ratio": r.exposure.bright_ratio,
        "resolution_ok": r.resolution_ok,
        "passed": r.passed,
        "warnings": [w.value for w in r.warnings],
        "error": None,
    }
    if keep is not None:
        row["image_id"] = keep(img, path.name)
        row["width"], row["height"] = int(img.shape[1]), int(img.shape[0])
    return row


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ok = [r for r in rows if r.get("error") is None]
    warnings = Counter(w for r in ok for w in r["warnings"])
    return {
        "count": len(rows),
        "ok": len(ok),
        "failed": len(rows) - len(ok),
        "pass_rate": sum(r["passed"] for r in ok) / len(ok) if ok else None,
        "warning_counts": {code.value: warnings[code.value] for code in QUALITY_WARNINGS},
    }
