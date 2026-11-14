"""批次改名的共用部分：逐筆記錄改名，並可依紀錄由後往前還原。

紀錄為 CSV（``time``、``old``、``new``），每改一個檔案就寫入一筆並 flush，
中途出錯時已改的都在紀錄裡。改名一律不覆寫既有檔案；路徑經 ``images.guard_path``
的測試集鎖定。
"""

from __future__ import annotations

import csv
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path

from dietai.devtools.images import guard_path

LOG_COLUMNS = ("time", "old", "new")


def apply_renames(log: Path, pairs: Iterable[tuple[Path, Path]]) -> int:
    """依序把 ``src`` 改名為 ``dst`` 並記在 ``log``；回傳改了幾個檔案。

    目標已存在（計畫之後才出現的檔案）或來源已不存在時略過該筆，不覆寫。
    """
    new_log = not log.is_file()
    done = 0
    with log.open("a", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        if new_log:
            writer.writerow(LOG_COLUMNS)
        for src, dst in pairs:
            if dst.exists() or not src.is_file():
                continue
            src.rename(dst)
            writer.writerow([datetime.now().isoformat(timespec="seconds"), src, dst])
            f.flush()  # 中途出錯時，已改的都在紀錄裡，可以還原
            done += 1
    return done


def has_entries(log: Path) -> bool:
    """紀錄中是否還有可還原的改名。"""
    if not log.is_file():
        return False
    with log.open(encoding="utf-8", newline="") as f:
        return next(csv.DictReader(f), None) is not None


def undo_renames(log: Path) -> tuple[int, list[str]]:
    """依紀錄由後往前還原；回傳（還原了幾個、無法還原的說明）。

    還原成功的紀錄會移除；無法還原的（新檔名已不存在、或舊檔名已被占用）留在紀錄裡。
    """
    if not log.is_file():
        return 0, []
    with log.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    kept: list[dict[str, str]] = []
    problems: list[str] = []
    restored = 0
    for row in reversed(rows):
        old, new = guard_path(row["old"]), guard_path(row["new"])
        if new.is_file() and not old.exists():
            new.rename(old)
            restored += 1
        else:
            problems.append(f"無法還原 {new.name} → {old.name}")
            kept.append(row)
    with log.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=LOG_COLUMNS)
        writer.writeheader()
        writer.writerows(reversed(kept))
    return restored, problems
