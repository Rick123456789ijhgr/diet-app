"""實驗 manifest（CSV）的讀取與測試集鎖定。

manifest 每列一張影像：

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| ``image`` | 是 | 影像路徑；相對路徑以 manifest 所在資料夾為準 |
| ``truth`` | 是 | 真值（例如條碼內容）；空字串表示「影像中沒有目標」的負樣本 |
| ``split`` | 否 | 資料切分（``train``／``dev``／``test``…）；``test`` 預設排除 |
| ``id`` | 否 | 影像代碼；省略時用 ``image`` 欄位的原文 |
| 其他欄位 | 否 | 拍攝條件標籤（如 ``distance``、``angle``、``lighting``），分析時依此分組 |

所有欄位都以字串讀入（條碼的前導 0 不會遺失）；檔案為 UTF-8，可含 BOM（Excel 另存的 CSV）。
注意：用 Excel 開啟再存檔會把長數字轉成科學記號，編輯 manifest 請用文字編輯器。
"""

from __future__ import annotations

import csv
import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from dietai.preprocess.types import Image

TEST_SPLIT = "test"
REQUIRED_COLUMNS = ("image", "truth")
RESERVED_COLUMNS = ("image", "truth", "split", "id")


class SplitLockedError(ValueError):
    """嘗試在非正式實驗中讀取鎖定的測試集（根目錄 CLAUDE.md 規則 7）。"""


def is_test_split(path: str | Path) -> bool:
    """路徑中是否含有連續的 ``splits/test`` 目錄（不分大小寫）。"""
    parts = [p.lower() for p in Path(path).parts]
    return any(a == "splits" and b == "test" for a, b in zip(parts, parts[1:], strict=False))


@dataclass(frozen=True)
class ManifestItem:
    """manifest 的一列。``image`` 為解析後的絕對路徑；``tags`` 為拍攝條件標籤。"""

    id: str
    image: Path
    truth: str
    split: str
    tags: Mapping[str, str]

    @property
    def is_test(self) -> bool:
        return self.split.lower() == TEST_SPLIT or is_test_split(self.image)


@dataclass(frozen=True)
class Manifest:
    """讀入的 manifest。

    ``excluded_test`` 為因測試集鎖定而排除的列數；``sha256`` 為檔案內容雜湊，
    寫入實驗紀錄以確認不同次執行用的是同一份 manifest。
    """

    path: Path
    items: tuple[ManifestItem, ...]
    tag_columns: tuple[str, ...]
    sha256: str
    excluded_test: int = 0


def read_manifest(path: str | Path, *, include_test: bool = False) -> Manifest:
    """讀取 manifest CSV。

    ``include_test`` 為 ``False``（預設）時，``split`` 為 ``test`` 或路徑含 ``splits/test``
    的列會被排除並計入 ``excluded_test``；manifest 本身位於 ``splits/test`` 下時丟
    ``SplitLockedError``。只有正式實驗才可設為 ``True``。

    缺少必填欄位、``id`` 重複或 ``image`` 為空時丟 ``ValueError``。
    """
    path = Path(path).expanduser().resolve()
    if not include_test and is_test_split(path):
        raise SplitLockedError(f"測試集已鎖定，正式實驗才可讀取：{path}")
    data = path.read_bytes()
    reader = csv.DictReader(data.decode("utf-8-sig").splitlines())
    columns = tuple(c.strip() for c in reader.fieldnames or ())
    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        raise ValueError(f"manifest 缺少欄位 {missing}：{path}")
    tag_columns = tuple(c for c in columns if c not in RESERVED_COLUMNS)

    items: list[ManifestItem] = []
    seen: set[str] = set()
    excluded = 0
    for line, raw in enumerate(reader, start=2):
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k is not None}
        if not row["image"]:
            raise ValueError(f"第 {line} 列的 image 為空：{path}")
        item = ManifestItem(
            id=row.get("id") or row["image"],
            image=(path.parent / row["image"]).resolve(),
            truth=row["truth"],
            split=row.get("split", ""),
            tags={c: row.get(c, "") for c in tag_columns},
        )
        if item.id in seen:
            raise ValueError(f"第 {line} 列的 id 重複：{item.id}")
        seen.add(item.id)
        if item.is_test and not include_test:
            excluded += 1
            continue
        items.append(item)
    return Manifest(
        path=path,
        items=tuple(items),
        tag_columns=tag_columns,
        sha256=hashlib.sha256(data).hexdigest(),
        excluded_test=excluded,
    )


def write_manifest(
    path: str | Path, rows: Sequence[Mapping[str, str]], tag_columns: tuple[str, ...] = ()
) -> Path:
    """寫出 manifest CSV（UTF-8，無 BOM）。欄位順序：``id, image, truth, split`` 再接標籤。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["id", "image", "truth", "split", *tag_columns]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="raise")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})
    return path


def read_image(path: str | Path) -> Image:
    """讀取影像為 BGR ``uint8``（支援含中文的 Windows 路徑）。

    找不到檔案丟 ``FileNotFoundError``，無法解碼丟 ``ValueError``。
    """
    data = Path(path).read_bytes()
    if not data:  # 空緩衝區會讓 cv2.imdecode 丟 cv2.error，而不是回傳 None
        raise ValueError(f"影像檔是空的：{path}")
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"無法解碼影像：{path}")
    return np.asarray(img, dtype=np.uint8)


def write_image(path: str | Path, img: Image) -> Path:
    """依副檔名編碼並寫出影像（支援含中文的 Windows 路徑），回傳路徑。"""
    path = Path(path)
    ok, buf = cv2.imencode(path.suffix or ".png", img)
    if not ok:
        raise ValueError(f"無法編碼影像：{path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.tobytes())
    return path
