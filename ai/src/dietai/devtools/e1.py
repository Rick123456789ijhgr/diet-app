"""E1 條碼消融的工作台功能：列出執行結果、讀取並彙整一次執行、以合成資料快速執行。

統計（成功率、Wilson 信賴區間、McNemar）一律由 ``dietai.evaluation`` 計算；
路徑經 ``images.guard_path`` 的測試集鎖定。
"""

from __future__ import annotations

import csv
import queue
import shutil
import threading
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

from dietai.devtools.images import PathNotFoundError, guard_path
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
# 列入「失敗影像」清單的判定結果（不含 correct 與 true_negative）
FAILURES = (Outcome.MISREAD, Outcome.MISSED, Outcome.FALSE_POSITIVE, Outcome.ERROR)
# 快速執行的條碼數上限：每個條碼會產生多張退化影像，再乘上實驗組數，數量放大很快
MAX_CODES = 20
# 失敗影像的嘗試紀錄最多附上幾筆（避免大型執行的回應過大）
MAX_FAILURE_ATTEMPTS = 2000


def resolve_root(root: str) -> Path:
    """結果資料夾：空字串用預設的 ``e1_barcode/runs``，否則經測試集鎖定檢查。"""
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
        raise PathNotFoundError(f"不是 E1 執行資料夾：{resolved}")
    return resolved


def list_runs_json(root: str) -> dict[str, Any]:
    """結果資料夾下的各次執行（新的在前），以及可用的實驗組。"""
    folder = resolve_root(root)
    # 實驗組設定讀不到或格式錯時仍列出既有結果，只是不能快速執行
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
    # 依結果中首次出現的順序去重複（保留執行時的實驗組順序）
    arms = list(dict.fromkeys(r["arm"] for r in rows))
    # 失敗列只挑介面需要的欄位（含各標籤欄），缺的欄位補空字串
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
        "rescues": rescue_counts(rows, meta.get("arms", ())),
        "failures": failures,
        "attempts": _failure_attempts(folder, {(f["arm"], f["id"]) for f in failures}),
    }


def _failure_attempts(folder: Path, keys: set[tuple[str, str]]) -> list[dict[str, str]]:
    """從 ``attempts.csv`` 挑出失敗影像（``(arm, id)``）的逐階嘗試紀錄。

    逐列串流讀取，最多 ``MAX_FAILURE_ATTEMPTS`` 筆；檔案不存在或沒有失敗時回傳空串列。
    ``utf-8-sig`` 讓有 BOM（例如 Excel 存過）的檔案也能正確讀到第一欄名稱。
    """
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

    合成資料寫到 ``e1_barcode/synthetic/<執行名稱>/``（每次執行各自一份，互不覆寫，
    失敗影像日後仍可檢視），只供驗證流程與觀察趨勢，不可作為結論。
    產生器被關閉（使用者取消）時中止實驗並刪除未完成的結果資料夾。
    """
    # 先檢查完所有參數再建立任何檔案，參數錯誤時不留下空資料夾
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

    out = _claim_run_dir(folder)
    data_dir = E1_DIR / "synthetic" / out.name

    def discard() -> None:
        """未完成的執行不留下結果資料夾（沒有 run.json）與它的合成資料。"""
        shutil.rmtree(out, ignore_errors=True)
        shutil.rmtree(data_dir, ignore_errors=True)

    # 讀 manifest 一律經 read_manifest（測試集鎖定）；合成資料的 split 一律為 dev
    try:
        manifest = read_manifest(write_barcode_dataset(data_dir, n_codes))
    except BaseException:
        discard()
        raise
    total = len(manifest.items) * len(arms)
    try:
        yield {"type": "start", "total": total}
    except GeneratorExit:  # 在背景執行緒開始前就被取消
        discard()
        raise

    # run_experiment 以回呼回報進度；在另一個執行緒執行，進度經佇列轉成事件。
    # 取消時在下一次進度回呼丟出 _Cancelled 中止實驗。
    events: queue.Queue[tuple[str, Any]] = queue.Queue()
    cancelled = threading.Event()

    def progress(done: int, n: int) -> None:
        """run_experiment 的進度回呼（在背景執行緒中呼叫）。"""
        if cancelled.is_set():
            raise _Cancelled
        events.put(("progress", (done, n)))

    def work() -> None:
        """背景執行緒：跑實驗，結束狀態（done／cancelled／error）一律經佇列回報。"""
        try:
            run_experiment(manifest, arms, out, label="workbench", progress=progress)
            events.put(("done", None))
        except _Cancelled:
            discard()
            events.put(("cancelled", None))
        except BaseException as exc:  # 交給產生器在呼叫端的執行緒重新丟出
            discard()
            events.put(("error", exc))

    worker = threading.Thread(target=work, name="e1-quick-run", daemon=True)
    worker.start()
    # 呼叫端執行緒在這裡把佇列轉成事件。產生器被關閉時 yield 處丟出 GeneratorExit，
    # finally 設下取消旗標，背景執行緒在下一次進度回呼時中止並刪除未完成的資料夾
    try:
        while True:
            kind, value = events.get()
            if kind == "progress":
                done, n = value
                yield {"type": "progress", "done": done, "total": n}
            elif kind == "error":
                raise value
            elif kind == "cancelled":
                return
            else:
                yield {"type": "done", "name": out.name, "path": str(out)}
                return
    finally:
        cancelled.set()


def _claim_run_dir(folder: Path) -> Path:
    """以 ``mkdir`` 佔用一個新的執行資料夾。

    ``new_run_dir`` 只挑尚不存在的名稱；同一秒內開始的兩次執行（例如停止後立刻重跑）
    可能拿到同一個名稱、寫進同一份合成資料，所以在這裡原子地建立，撞名就再挑一次。
    """
    folder.mkdir(parents=True, exist_ok=True)
    while True:
        out = new_run_dir(folder, "workbench")
        try:
            out.mkdir()
        except FileExistsError:
            continue
        return out


class _Cancelled(Exception):
    """使用者取消快速執行。"""
