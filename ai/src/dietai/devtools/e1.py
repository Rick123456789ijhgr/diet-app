"""E1 條碼消融的工作台功能：列出執行結果、讀取並彙整一次執行、以合成資料快速執行。

統計（成功率、Wilson 信賴區間、McNemar）一律由 ``dietai.evaluation`` 計算；
路徑經 ``images.guard_path`` 的測試集鎖定。
"""

from __future__ import annotations

import csv
import queue
import threading
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

from dietai.devtools.images import guard_path
from dietai.devtools.scenes import SceneError
from dietai.evaluation import (
    Outcome,
    list_runs,
    load_arms,
    new_run_dir,
    read_manifest,
    read_run,
    rescue_counts,
    run_experiment,
    summarize,
)
from dietai.synthetic import write_barcode_dataset

# ai/src/dietai/devtools/e1.py → 專案根目錄
E1_DIR = Path(__file__).resolve().parents[4] / "research" / "experiments" / "e1_barcode"
DEFAULT_ROOT = E1_DIR / "runs"
FAILURES = (Outcome.MISREAD, Outcome.MISSED, Outcome.FALSE_POSITIVE, Outcome.ERROR)
MAX_CODES = 20
# 失敗影像的嘗試紀錄最多附上幾筆（避免大型執行的回應過大）
MAX_FAILURE_ATTEMPTS = 2000


def resolve_root(root: str) -> Path:
    return guard_path(root) if root else DEFAULT_ROOT


def resolve_run(run_dir: str) -> Path:
    """執行資料夾：絕對或相對路徑；只有資料夾名稱時視為預設結果資料夾下的那一次。"""
    if not run_dir:
        raise SceneError("缺少執行資料夾", "run_dir")
    p = Path(run_dir)
    if not p.is_absolute() and len(p.parts) == 1:
        p = DEFAULT_ROOT / p
    resolved = guard_path(p)
    if not (resolved / "run.json").is_file():
        raise FileNotFoundError(f"不是 E1 執行資料夾：{resolved}")
    return resolved


def list_runs_json(root: str) -> dict[str, Any]:
    """結果資料夾下的各次執行（新的在前），以及可用的實驗組。"""
    folder = resolve_root(root)
    try:
        arms = [a.name for a in load_arms(E1_DIR / "configs")]
    except (OSError, ValueError):
        arms = []
    return {
        "root": str(folder),
        "runs": [{"name": p.name, "path": str(p)} for p in list_runs(folder)],
        "arms": arms,
        "default_arms": [a for a in ("a0_raw", "a6_full") if a in arms],
    }


def run_json(run_dir: str) -> dict[str, Any]:
    """一次執行的完整彙整：各基準組的整體成功率、各標籤分組、成功階、失敗影像與其嘗試紀錄。"""
    folder = resolve_run(run_dir)
    meta, rows = read_run(folder)
    manifest = meta.get("manifest", {})
    tags: list[str] = list(manifest.get("tag_columns", []))
    arms = list(dict.fromkeys(r["arm"] for r in rows))
    failures = [
        {
            k: r.get(k, "")
            for k in (
                "id",
                "arm",
                "outcome",
                "truth",
                "decoded",
                "success_rung",
                "error",
                "image",
                *tags,
            )
        }
        for r in rows
        if r["outcome"] in FAILURES
    ]
    return {
        "name": folder.name,
        "path": str(folder),
        "meta": {
            "items": manifest.get("items"),
            "include_test": bool(manifest.get("include_test")),
            "duration_s": meta.get("duration_s"),
            "git": meta.get("git") or {},
            "label": meta.get("label", ""),
            "created": meta.get("created"),
        },
        "arms": arms,
        "tags": tags,
        # 基準組不同時 McNemar 的結果不同，每個基準組各算一次（實驗組數量不多）
        "overall": {b: summarize(rows, (), b) for b in arms},
        "by_tag": {t: summarize(rows, (t,)) for t in tags},
        "rescues": rescue_counts(rows),
        "failures": failures,
        "attempts": _failure_attempts(folder, {(f["arm"], f["id"]) for f in failures}),
    }


def _failure_attempts(folder: Path, keys: set[tuple[str, str]]) -> list[dict[str, str]]:
    path = folder / "attempts.csv"
    if not keys or not path.is_file():
        return []
    out: list[dict[str, str]] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if (row.get("arm"), row.get("id")) in keys:
                out.append(row)
                if len(out) >= MAX_FAILURE_ATTEMPTS:
                    break
    return out


def start_run(arm_names: Sequence[str], n_codes: int, root: str) -> Iterator[dict[str, Any]]:
    """產生合成條碼資料並執行選取的實驗組，依序產生事件：

    ``{"type": "start", "total": n}``、多個 ``{"type": "progress", "done", "total"}``、
    最後 ``{"type": "done", "name", "path"}``；失敗時丟例外（由呼叫端轉成錯誤）。
    合成資料寫到 ``e1_barcode/synthetic/``，只供驗證流程與觀察趨勢，不可作為結論。
    """
    if not arm_names:
        raise SceneError("至少選一個實驗組", "arms")
    if not 1 <= n_codes <= MAX_CODES:
        raise SceneError(f"條碼數必須是 1–{MAX_CODES}", "n_codes")
    available = {a.name: a for a in load_arms(E1_DIR / "configs")}
    unknown = [a for a in arm_names if a not in available]
    if unknown:
        raise SceneError(f"沒有這些實驗組：{unknown}", "arms")
    arms = [available[a] for a in arm_names]
    folder = resolve_root(root)

    manifest = read_manifest(write_barcode_dataset(E1_DIR / "synthetic", n_codes))
    out = new_run_dir(folder, "workbench")
    total = len(manifest.items) * len(arms)
    yield {"type": "start", "total": total}

    # run_experiment 以回呼回報進度；在另一個執行緒執行，進度經佇列轉成事件
    events: queue.Queue[tuple[str, Any]] = queue.Queue()

    def work() -> None:
        try:
            run_experiment(
                manifest,
                arms,
                out,
                label="workbench",
                progress=lambda done, n: events.put(("progress", (done, n))),
            )
            events.put(("done", None))
        except BaseException as exc:  # 交給產生器在呼叫端的執行緒重新丟出
            events.put(("error", exc))

    threading.Thread(target=work, daemon=True).start()
    while True:
        kind, value = events.get()
        if kind == "progress":
            done, n = value
            yield {"type": "progress", "done": done, "total": n}
        elif kind == "error":
            raise value
        else:
            yield {"type": "done", "name": out.name, "path": str(out)}
            return
