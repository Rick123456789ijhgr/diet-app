"""實驗圖片的批次命名：把「檔名就是條碼」的照片改成規則化檔名，條碼保留在檔名中。

命名規則見 ``dietai.evaluation.image_names``（``<類別>_<批次>_<序號>[_<條碼>]``）。
能辨認的舊檔名（``rename_by_truth.code_from_name``）::

    4710088410108.jpg、4710088410108_2.jpg   → f_a01_001_4710088410108.jpg
    沒有條碼_IMG_1234.jpg                     → f_a01_002_nocode.jpg

類別（``f``＝食物包裝、``o``＝其他物品）、批次、起始序號、序號位數、「沒有條碼」的標記
都可自訂。看不出條碼的檔名（``IMG_1234.jpg`` 等）預設略過；``include_unknown`` 時只編號、
不帶條碼（``f_a01_003.jpg``），之後確認了真值可再用 ``rename_by_truth`` 補上條碼。
同類別批次已有的檔案不動，其序號不重複使用，新照片接在後面；其他類別批次的檔案略過。

先預覽（``plan``），確認後才 ``apply``；改名不覆寫既有檔案，逐筆記在資料夾的
``_rename_log.csv``，可用 ``undo`` 依相反順序還原。路徑一律經 ``images.guard_path`` 的
測試集鎖定。
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from dietai.devtools.images import PathNotFoundError, guard_path, list_images
from dietai.devtools.rename_by_truth import code_from_name
from dietai.devtools.rename_log import apply_renames, has_entries, undo_renames
from dietai.devtools.scenes import SceneError
from dietai.evaluation.image_names import (
    MAX_SEQ_WIDTH,
    MIN_SEQ_WIDTH,
    NO_CODE,
    ImageName,
    check_no_code,
    check_token,
    parse_name,
)

LOG_FILE = "_rename_log.csv"
# 常用的類別（工作台的預設選項）；類別仍可自訂
CATEGORIES = {"f": "食物包裝", "o": "其他物品（書、用品等）"}

Order = Literal["mtime", "name"]
Status = Literal["rename", "same", "skip"]


@dataclass(frozen=True)
class Planned:
    """一個檔案的改名計畫。

    ``status``：``rename``（要改名）、``same``（已是本類別批次的規則化檔名，不動）、
    ``skip``（不處理：其他類別批次、或看不出條碼）。``code`` 為檔名帶的條碼
    （``""`` 為沒有條碼，``None`` 為看不出來）。
    """

    src: Path
    dst: Path | None
    status: Status
    code: str | None = None
    note: str = ""


def _natural_key(name: str) -> list[Any]:
    """自然排序：``IMG_2`` 排在 ``IMG_10`` 前面。"""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _folder(folder: str | Path) -> Path:
    base = guard_path(folder)
    if not base.is_dir():
        raise PathNotFoundError(f"找不到資料夾：{base}")
    return base


def plan(
    folder: str | Path,
    category: str,
    batch: str,
    *,
    start: int = 0,
    width: int = MIN_SEQ_WIDTH,
    order: Order = "mtime",
    include_unknown: bool = False,
    no_code: str = NO_CODE,
) -> list[Planned]:
    """列出資料夾中每張圖片的改名計畫（不動任何檔案；不含子資料夾）。

    ``start`` 為第一個序號（0 表示接在本類別批次既有的最大序號之後）；``order`` 決定
    編號順序：``mtime``（修改時間；改名不會改變它，通常就是拍攝順序）或 ``name``
    （原檔名的自然排序）。``include_unknown`` 時看不出條碼的檔案也編號（不帶條碼）。
    ``no_code`` 為沒有條碼時寫在條碼欄的標記（小寫字母）。
    """
    for check, value, field in (
        (lambda v: check_token(v, "類別"), category, "category"),
        (lambda v: check_token(v, "批次"), batch, "batch"),
        (check_no_code, no_code, "no_code"),
    ):
        try:
            check(value)
        except ValueError as e:
            raise SceneError(str(e), field) from e
    if not MIN_SEQ_WIDTH <= width <= MAX_SEQ_WIDTH:
        raise SceneError(f"序號位數必須是 {MIN_SEQ_WIDTH}–{MAX_SEQ_WIDTH}，收到 {width}", "width")
    if start < 0:
        raise SceneError(f"起始序號不可為負數：{start}", "start")
    base = _folder(folder)
    group = (category, batch)

    out: list[Planned] = []
    used: set[int] = set()
    todo: list[tuple[Path, str | None]] = []
    for p in list_images(base):
        parsed = parse_name(p.name)
        if parsed is not None:
            if parsed.group == group:
                used.add(parsed.seq)
                out.append(Planned(p, p, "same", parsed.code))
            else:
                note = f"已屬於 {parsed.category}_{parsed.batch}"
                out.append(Planned(p, None, "skip", parsed.code, note))
            continue
        code = code_from_name(p.name)
        if code is None and not include_unknown:
            out.append(Planned(p, None, "skip", None, "檔名看不出條碼"))
            continue
        todo.append((p, code))

    if order == "mtime":
        todo.sort(key=lambda t: (t[0].stat().st_mtime, _natural_key(t[0].name)))
    else:
        todo.sort(key=lambda t: _natural_key(t[0].name))
    taken = {p.name.lower() for p in base.iterdir()}  # Windows 檔名不分大小寫
    seq = start or (max(used, default=0) + 1)
    limit = 10**width - 1
    for p, code in todo:
        while True:
            while seq in used:
                seq += 1
            if seq > limit:
                raise SceneError(f"序號超過 {width} 位數（{limit}）：請加大序號位數", "width")
            used.add(seq)
            name = ImageName(category, batch, seq, width, code).filename(p.suffix, no_code)
            if name.lower() not in taken:
                break
        taken.add(name.lower())
        out.append(Planned(p, base / name, "rename", code))
    return out


def apply(folder: str | Path, planned: Sequence[Planned]) -> int:
    """依計畫改名並記在資料夾的 ``_rename_log.csv``；回傳改了幾個檔案。"""
    base = _folder(folder)
    pairs = [(p.src, p.dst) for p in planned if p.status == "rename" and p.dst is not None]
    return apply_renames(base / LOG_FILE, pairs)


def undo(folder: str | Path) -> tuple[int, list[str]]:
    """依資料夾的 ``_rename_log.csv`` 由後往前還原全部紀錄。"""
    return undo_renames(_folder(folder) / LOG_FILE)


# ── 工作台（server 經 gRPC 呼叫；結構由這裡定義） ──────────────────────


def _planned_json(base: Path, planned: Sequence[Planned]) -> dict[str, Any]:
    items = [
        {
            "src": p.src.name,
            "dst": p.dst.name if p.dst is not None else "",
            "status": p.status,
            "code": p.code,
            "note": p.note,
        }
        for p in planned
    ]
    final = [p.dst.name for p in planned if p.dst is not None]
    return {
        "folder": str(base),
        "items": items,
        "counts": {s: sum(1 for p in planned if p.status == s) for s in ("rename", "same", "skip")},
        # 改名後（含不變的）主檔名的長度；不只一種時介面提示長度不一致（EAN-8、沒有條碼）
        "stem_lengths": sorted({len(Path(n).stem) for n in final}),
        "can_undo": has_entries(base / LOG_FILE),
    }


def plan_json(folder: str, **options: Any) -> dict[str, Any]:
    """預覽（同 ``plan`` 的參數）：每個檔案的新檔名、統計與檔名長度。"""
    base = _folder(folder)
    return {"categories": CATEGORIES, **_planned_json(base, plan(base, **options))}


def apply_json(folder: str, **options: Any) -> dict[str, Any]:
    """依目前的資料夾重新規劃後改名（不採用前端送來的計畫）；回傳改名數與改名後的預覽。"""
    base = _folder(folder)
    renamed = apply(base, plan(base, **options))
    return {"renamed": renamed, **plan_json(str(base), **options)}


def undo_json(folder: str) -> dict[str, Any]:
    """依紀錄還原；回傳還原數與無法還原的說明。"""
    restored, problems = undo(folder)
    return {"restored": restored, "problems": problems}
