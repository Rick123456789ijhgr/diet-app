"""依「找最佳流程」確認過的真值，把原始照片改名成條碼號碼。

一次執行（``runs/<時間>_bestflow/``）的 ``truth.csv`` 記錄每張圖的真值；本模組找出每張圖的
原始檔並改名：

- 有條碼 → ``<號碼><副檔名>``（同一個號碼有多張時加 ``_2``、``_3``…）
- 沒有條碼 → ``沒有條碼_<原檔名>``
- 已規則化的檔名（``food_b01_001.jpg``，見 ``evaluation.image_names``）→ 保留類別、批次、
  序號，只把條碼接在後面（``food_b01_001_<號碼>.jpg``、``food_b01_001_nocode.jpg``）
- 尚未確定的圖片不改；預設也不改程式自動推定的（``include_auto`` 才改）

原始檔的位置：資料夾來源的執行，manifest 直接記錄原檔路徑；上傳來源的執行只有檔名
（圖片 ID 就是上傳時的檔名），需另外指定照片所在的資料夾（``folder``），以檔名對應。

改名不覆寫任何既有檔案（目標已存在就加序號），並把每一筆寫進執行資料夾的
``rename_log.csv``，可用 ``undo`` 依相反順序還原。檔名已經是正確號碼的檔案不動。
路徑一律經 ``images.guard_path`` 的測試集鎖定。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from dietai.devtools.best_flow import INPUTS, MARKER, resolve_run
from dietai.devtools.images import PathNotFoundError, guard_path
from dietai.devtools.rename_log import apply_renames, undo_renames
from dietai.evaluation import read_manifest
from dietai.evaluation.best_flow import TruthSource, normalize_truth, read_truth
from dietai.evaluation.image_names import parse_name, valid_code

LOG_FILE = "rename_log.csv"
NO_CODE_PREFIX = "沒有條碼_"

# 檔名就是號碼（可接 _2、-3、" (1)" 之類的序號）
_CODE_NAME = re.compile(r"^(\d{8}|\d{12,13})(?:[_\-\s(#].*)?$")


@dataclass(frozen=True)
class Rename:
    """一張圖的改名計畫。

    ``status``：``rename``（要改名）、``same``（檔名已正確）、``undecided``（真值未定）、
    ``missing``（找不到原始檔）、``ambiguous``（對應到多個檔案或同名上傳）。
    """

    id: str
    truth: str | None
    source: str
    src: Path | None
    dst: Path | None
    status: str
    note: str = ""


def code_from_name(name: str) -> str | None:
    """檔名代表的答案：合法的條碼號碼、``""``（沒有條碼）或 ``None``（看不出來）。"""
    parsed = parse_name(name)
    if parsed is not None:
        return parsed.code
    stem = Path(name).stem
    if stem.startswith(NO_CODE_PREFIX):
        return ""
    m = _CODE_NAME.match(stem)
    if not m:
        return None
    code = normalize_truth(m.group(1))
    return code if valid_code(code) else None


def _target_name(name: str, truth: str) -> str:
    p = Path(name)
    parsed = parse_name(name)
    if parsed is not None:
        return parsed.with_code(truth).filename(p.suffix)
    if truth:
        return f"{truth}{p.suffix.lower()}"
    return name if name.startswith(NO_CODE_PREFIX) else f"{NO_CODE_PREFIX}{name}"


def _with_suffix(name: str, i: int) -> str:
    p = Path(name)
    return f"{p.stem}_{i}{p.suffix}"


def _find(folder: Path, name: str, recursive: bool) -> list[Path]:
    if recursive:
        return sorted(p for p in folder.rglob(name) if p.is_file())
    p = folder / name
    return [p] if p.is_file() else []


def plan(
    run_dir: str,
    folder: str | Path | None = None,
    *,
    recursive: bool = False,
    include_auto: bool = False,
) -> list[Rename]:
    """列出這次執行每張圖的改名計畫（不動任何檔案）。

    ``folder``：上傳來源的執行必填（照片所在的資料夾）；資料夾來源的執行忽略。
    ``include_auto``：程式自動推定的真值也改；預設只改人工確認過的圖片。
    """
    run = resolve_run(run_dir)
    marker = json.loads((run / MARKER).read_text(encoding="utf-8"))
    uploaded = marker.get("source") == "upload"
    base: Path | None = None
    if uploaded:
        if not folder:
            raise ValueError("這次執行的圖片是上傳的：請指定照片所在的資料夾（--folder）")
        base = guard_path(folder)
        if not base.is_dir():
            raise PathNotFoundError(f"找不到資料夾：{base}")
    manifest = read_manifest(run / INPUTS / "manifest.csv")
    truths = read_truth(run)

    out: list[Rename] = []
    # 每個資料夾裡已被占用的檔名（既有檔案＋已規劃的目標），改名一律避開，不形成連鎖改名
    taken: dict[Path, set[str]] = {}
    for item in manifest.items:
        decided = truths.get(item.id)
        if decided is None or (not include_auto and decided[1] is not TruthSource.MANUAL):
            why = "真值未定" if decided is None else "程式推定的（加 --include-auto 才改）"
            out.append(Rename(item.id, None, "", None, None, "undecided", why))
            continue
        truth, source = decided
        if base is not None:
            # 同名上傳的第二張以後 ID 帶「#n」，無法判斷是資料夾裡的哪一個檔案
            if re.search(r"#\d+$", item.id):
                out.append(
                    Rename(item.id, truth, source, None, None, "ambiguous", "同名的上傳，無法對應")
                )
                continue
            found = _find(base, item.id, recursive)
            if len(found) != 1:
                status = "missing" if not found else "ambiguous"
                note = "資料夾中找不到這個檔名" if not found else f"有 {len(found)} 個同名檔案"
                out.append(Rename(item.id, truth, source, None, None, status, note))
                continue
            src = found[0]
        else:
            src = guard_path(item.image)
            if not src.is_file():
                out.append(Rename(item.id, truth, source, None, None, "missing", "原檔已不存在"))
                continue
        if code_from_name(src.name) == truth:
            out.append(Rename(item.id, truth, source, src, src, "same"))
            continue
        used = taken.setdefault(src.parent, {p.name for p in src.parent.iterdir()})
        want = _target_name(src.name, truth)
        name, i = want, 1
        while name in used:
            i += 1
            name = _with_suffix(want, i)
        used.add(name)
        out.append(Rename(item.id, truth, source, src, src.parent / name, "rename"))
    return out


def apply(run_dir: str, renames: list[Rename]) -> int:
    """依計畫改名並逐筆寫進執行資料夾的 ``rename_log.csv``；回傳改了幾個檔案。

    目標已存在時（計畫之後才出現的檔案）略過該筆，不覆寫。
    """
    run = resolve_run(run_dir)
    pairs = [
        (r.src, r.dst)
        for r in renames
        if r.status == "rename" and r.src is not None and r.dst is not None
    ]
    return apply_renames(run / LOG_FILE, pairs)


def undo(run_dir: str) -> tuple[int, list[str]]:
    """依 ``rename_log.csv`` 由後往前還原；回傳（還原了幾個、無法還原的說明）。

    還原成功的紀錄會移除；無法還原的（新檔名已不存在、或舊檔名已被占用）留在紀錄裡。
    """
    return undo_renames(resolve_run(run_dir) / LOG_FILE)
