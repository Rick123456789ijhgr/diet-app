"""工作台「找最佳流程」：放入圖片 → 每個方法都執行 → 確認真值 → 選出最佳的方法與順序。

一次執行的資料夾（``runs/<時間>_bestflow/``）::

    inputs/manifest.csv   自動產生的 manifest（truth 全為空、split 為 dev）
    inputs/images/        上傳的圖片（資料夾來源不複製，manifest 直接指向原檔）
    methods/              run_methods 的輸出（run.json、methods.csv）
    truth.csv             採用的真值與來源（auto／manual；規則化檔名中的條碼視為 manual）
    best_flow.json        完成標記與設定（推定所需方法數、實驗組）

``methods/`` 放在子資料夾，因此 E1 消融與自適應策略頁不會把它當成自己的執行。
推定、判定與貪婪選擇一律由 ``dietai.evaluation`` 計算；路徑經 ``images.guard_path``
的測試集鎖定。
"""

from __future__ import annotations

import json
import re
import shutil
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from contextlib import closing
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

from dietai.devtools.background import progress_events
from dietai.devtools.e1 import E1_DIR, claim_run_dir, resolve_root
from dietai.devtools.images import PathNotFoundError, guard_path, list_images
from dietai.devtools.scenes import SceneError
from dietai.evaluation import (
    GreedyCriteria,
    ManifestItem,
    greedy_ladder,
    load_arms,
    method_arms,
    methods_in,
    read_manifest,
    read_methods,
    run_methods,
    simulate_ladder,
    summarize,
    write_manifest,
)
from dietai.evaluation.barcode import Outcome
from dietai.evaluation.best_flow import (
    DEFAULT_MIN_METHODS,
    TruthSource,
    apply_truth,
    guess_json,
    infer_truth,
    normalize_truth,
    read_truth,
    resolve_truths,
    write_truth,
)
from dietai.evaluation.image_names import truth_from_name, valid_code
from dietai.evaluation.manifest import write_image
from dietai.preprocess.types import Image, Rung

ARM = "c0_all_methods"  # 所有單一方法＋多尺度＋疊加流程
LABEL = "bestflow"
MARKER = "best_flow.json"
INPUTS = "inputs"
METHODS = "methods"
# 一次最多幾張：每張要跑十多個方法；更多的圖片請分批或改用 run_methods.py
MAX_IMAGES = 500

# 由圖片 ID 取得縮圖的暫存影像 ID（由 server 注入，本模組因此不依賴暫存區）
Thumb = Callable[[str], str]


def start_run(
    *,
    folder: str = "",
    uploads: Sequence[tuple[str, Image]] = (),
    recursive: bool = False,
    limit: int = 0,
    root: str = "",
) -> Iterator[dict[str, Any]]:
    """對資料夾或上傳的圖片執行所有方法，依序產生事件：

    ``{"type": "start", "total": n}``、多個 ``{"type": "progress", "done", "total"}``、
    最後 ``{"type": "done", "name", "path"}``。``folder`` 與 ``uploads``（(名稱, 影像)）擇一；
    ``limit`` 為 0 時用 ``MAX_IMAGES``。產生器被關閉（取消）時中止並刪除未完成的資料夾。
    """
    if bool(folder) == bool(uploads):
        raise SceneError("請擇一提供資料夾或上傳的圖片", "folder")
    if not 0 <= limit <= MAX_IMAGES:
        raise SceneError(f"張數上限必須是 1–{MAX_IMAGES}", "limit")
    limit = limit or MAX_IMAGES
    if len(uploads) > limit:
        raise SceneError(f"一次最多 {limit} 張圖片", "image_ids")
    paths = list_images(folder, recursive=recursive, limit=limit) if folder else []
    if folder and not paths:
        raise PathNotFoundError(f"資料夾中沒有影像：{guard_path(folder)}")
    (arm,) = load_arms(E1_DIR / "configs", [ARM])
    out = claim_run_dir(resolve_root(root), LABEL)

    def discard() -> None:
        """未完成的執行不留下資料夾。"""
        shutil.rmtree(out, ignore_errors=True)

    try:
        manifest = read_manifest(_write_inputs(out / INPUTS, folder, paths, uploads))
    except BaseException:
        discard()
        raise
    try:
        yield {"type": "start", "total": len(manifest.items)}
    except GeneratorExit:  # 在背景執行緒開始前就被取消
        discard()
        raise

    def work(progress: Callable[[int, int], None]) -> None:
        """背景執行緒：每個方法都執行，再寫出自動推定的真值與完成標記。"""
        run_methods(manifest, [arm], out / METHODS, label=LABEL, progress=progress)
        _, rows = read_methods(out / METHODS)
        guesses = infer_truth(rows, min_methods=DEFAULT_MIN_METHODS)
        named = names_truth(manifest.items)
        write_truth(out, resolve_truths(guesses, named))
        marker = {
            "created": datetime.now().astimezone().isoformat(timespec="seconds"),
            "source": str(guard_path(folder)) if folder else "upload",
            "recursive": recursive,
            "images": len(manifest.items),
            "arm": ARM,
            "min_methods": DEFAULT_MIN_METHODS,
            "truth_from_names": len(named),
        }
        (out / MARKER).write_text(json.dumps(marker, ensure_ascii=False, indent=2), "utf-8")

    events = progress_events(work, discard, name="best-flow")
    with closing(events):
        for done, total in events:
            yield {"type": "progress", "done": done, "total": total}
    yield {"type": "done", "name": out.name, "path": str(out)}


def _write_inputs(
    inputs: Path, folder: str, paths: Sequence[Path], uploads: Sequence[tuple[str, Image]]
) -> Path:
    """寫出 manifest（與上傳的圖片），回傳 manifest 路徑。ID 為相對路徑或檔名（重複時加序號）。"""
    rows: list[dict[str, str]] = []
    seen: set[str] = set()

    def unique(name: str) -> str:
        base, i, out = name, 1, name
        while out in seen:
            i += 1
            out = f"{base}#{i}"
        seen.add(out)
        return out

    if folder:
        base = guard_path(folder)
        for p in paths:
            rows.append({"id": unique(p.relative_to(base).as_posix()), "image": str(p)})
    else:
        for i, (name, img) in enumerate(uploads, start=1):
            # 檔名只留安全字元；加上序號避免同名覆寫
            stem = re.sub(r"[^\w.-]+", "_", Path(name).stem)[:60] or "image"
            rel = f"images/{i:03d}_{stem}.png"
            write_image(inputs / rel, img)
            rows.append({"id": unique(name or rel), "image": rel})
    return write_manifest(inputs / "manifest.csv", [{**r, "split": "dev"} for r in rows])


def names_truth(items: Iterable[ManifestItem]) -> dict[str, tuple[str, TruthSource]]:
    """由規則化檔名（``food_b01_001_<條碼>.jpg``，見 ``evaluation.image_names``）取得的真值。

    檔名中的條碼是人工確認過的，視同人工確認（``manual``）；檔名沒有條碼或不符合規則的
    圖片不列入，仍走自動推定與人工確認。圖片 ID 為檔名或相對路徑（同名上傳加 ``#n``），
    取最後一段的檔名解析。
    """
    out: dict[str, tuple[str, TruthSource]] = {}
    for item in items:
        name = PurePosixPath(re.sub(r"#\d+$", "", item.id)).name
        truth = truth_from_name(name)
        if truth is not None:
            out[item.id] = (truth, TruthSource.MANUAL)
    return out


def list_runs_json(root: str) -> list[dict[str, str]]:
    """結果資料夾下已完成的「找最佳流程」執行（新的在前）。"""
    folder = resolve_root(root)
    if not folder.is_dir():
        return []
    done = sorted((p.parent for p in folder.glob(f"*/{MARKER}")), reverse=True)
    return [{"name": p.name, "path": str(p)} for p in done]


def resolve_run(run_dir: str) -> Path:
    """執行資料夾：只有名稱時視為預設結果資料夾下的那一次；必須是已完成的找最佳流程執行。"""
    if not run_dir:
        raise SceneError("缺少執行資料夾", "run_dir")
    p = Path(run_dir)
    if not p.is_absolute() and len(p.parts) == 1:
        p = resolve_root("") / p
    resolved = guard_path(p)
    if not (resolved / MARKER).is_file():
        raise PathNotFoundError(f"不是已完成的找最佳流程執行：{resolved}")
    return resolved


def criteria_of(min_gain: int, max_new_wrong: int, max_mean_ms: float) -> GreedyCriteria:
    """由請求參數建立選擇準則：min_gain 為 0 時用 1；max_mean_ms 為 0 表示不限。"""
    try:
        return GreedyCriteria(
            min_gain=min_gain or 1,
            max_new_wrong=max_new_wrong,
            max_mean_ms=max_mean_ms or None,
        )
    except ValueError as e:
        raise SceneError(str(e), "criteria") from e


def run_json(run_dir: str, criteria: GreedyCriteria, thumb: Thumb | None = None) -> dict[str, Any]:
    """一次執行的真值表與結論（推薦流程、單一方法比較、與只用原圖／全部方法的比較）。"""
    folder = resolve_run(run_dir)
    marker = json.loads((folder / MARKER).read_text(encoding="utf-8"))
    _, rows = read_methods(folder / METHODS)
    guesses = infer_truth(rows, min_methods=int(marker.get("min_methods", DEFAULT_MIN_METHODS)))
    truths = resolve_truths(guesses, read_truth(folder))
    judged = apply_truth(rows, {k: t for k, (t, _) in truths.items()})

    images = []
    for g in guesses:
        applied = truths.get(g.id)
        errors = sorted({r["error"] for r in rows if r["id"] == g.id and r["error"]})
        images.append(
            {
                **guess_json(g),
                "applied": None if applied is None else {"truth": applied[0], "source": applied[1]},
                "error": errors[0] if errors else "",
                "thumb_id": _safe_thumb(thumb, g.image),
            }
        )
    decided = [i for i in images if i["applied"] is not None]
    return {
        "name": folder.name,
        "path": str(folder),
        "meta": marker,
        "criteria": {
            "min_gain": criteria.min_gain,
            "max_new_wrong": criteria.max_new_wrong,
            "max_mean_ms": criteria.max_mean_ms,
        },
        "counts": {
            "images": len(images),
            "decided": len(decided),
            "undecided": len(images) - len(decided),
            "positives": sum(1 for i in decided if i["applied"]["truth"]),
            "negatives": sum(1 for i in decided if not i["applied"]["truth"]),
            "auto": sum(1 for i in images if i["status"] == "auto"),
            "review": sum(1 for i in images if i["status"] == "review"),
            "unknown": sum(1 for i in images if i["status"] == "unknown"),
        },
        "images": images,
        "result": _result(judged, criteria),
    }


def _safe_thumb(thumb: Thumb | None, path: str) -> str:
    """縮圖的暫存影像 ID；原檔讀不到（已搬移或刪除）時回傳空字串，不影響其他結果。"""
    if thumb is None:
        return ""
    try:
        return thumb(path)
    except (OSError, ValueError):
        return ""


def _result(judged: Sequence[Mapping[str, str]], criteria: GreedyCriteria) -> dict[str, Any] | None:
    """以已確認真值的影像計算結論；沒有正樣本時回傳 ``None``（無從比較成功率）。"""
    if not any(r["truth"] for r in judged):
        return None
    methods = methods_in(judged)
    raw = Rung.RAW.value
    per_method = summarize(method_arms(judged), (), raw if raw in methods else None)
    try:
        greedy = greedy_ladder(judged, criteria)
    except ValueError as e:  # 全部 error 等無法計算的情形
        return {"methods": per_method, "error": str(e)}
    ladders = {"raw": (raw,), "greedy": greedy.order, "all": methods}
    simulated = [
        r for name, order in ladders.items() for r in simulate_ladder(judged, order, name=name)
    ]
    return {
        "methods": per_method,
        "greedy": {
            "order": list(greedy.order),
            "stop": greedy.stop,
            "excluded": greedy.excluded,
            "steps": [
                {
                    "method": s.method,
                    "rescued": s.rescued,
                    "new_misread": s.new_misread,
                    "new_false_positive": s.new_false_positive,
                    "correct": s.correct,
                    "positives": s.positives,
                    "misread": s.misread,
                    "false_positive": s.false_positive,
                    "rate": s.rate,
                    "mean_ms": s.mean_ms,
                }
                for s in greedy.steps
            ],
        },
        "compare": {
            "orders": {k: list(v) for k, v in ladders.items()},
            "summary": summarize(simulated, (), "raw"),
        },
        "export": ladder_export(greedy.order),
        "errors": sum(1 for r in judged if r["outcome"] == Outcome.ERROR),
    }


def ladder_export(order: Sequence[str]) -> dict[str, Any]:
    """把方法順序轉成 ``LadderConfig`` 的匯出格式（工作台的匯入格式）。

    設定中同一階只能出現一次：多尺度的各倍率、各疊加流程會併到該階第一次出現的位置，
    此時 ``exact`` 為 ``False``，實際順序與推薦順序略有不同。
    """
    rungs: list[str] = []
    scales: list[float] = []
    pipelines: list[list[str]] = []
    for method in order:
        rung, _, arg = method.partition("@")
        if rung not in rungs:
            rungs.append(rung)
        if rung == Rung.MULTISCALE.value:
            scales.append(float(arg))
        elif rung == Rung.PIPELINE.value:
            pipelines.append(arg.split("+"))
    expanded: list[str] = []
    for rung in rungs:
        if rung == Rung.MULTISCALE.value:
            expanded += [f"{rung}@{s:g}" for s in scales]
        elif rung == Rung.PIPELINE.value:
            expanded += [f"{rung}@{'+'.join(p)}" for p in pipelines]
        else:
            expanded.append(rung)
    values: dict[str, Any] = {"rungs": rungs}
    if scales:
        values["scales"] = scales
    if pipelines:
        values["pipelines"] = pipelines
    return {"class": "LadderConfig", "values": values, "exact": expanded == list(order)}


def set_truth(
    run_dir: str,
    updates: Mapping[str, str | None],
    criteria: GreedyCriteria,
    thumb: Thumb | None = None,
) -> dict[str, Any]:
    """更新人工確認的真值後回傳同 ``run_json`` 的結果。

    ``updates``：圖片 ID → 條碼（EAN-13／UPC-A／EAN-8，可含空白）、空字串（沒有條碼），
    或 ``None``（取消人工確認，改回自動推定）。未知的 ID 或號碼不合法時丟 ``SceneError``。
    """
    folder = resolve_run(run_dir)
    marker = json.loads((folder / MARKER).read_text(encoding="utf-8"))
    _, rows = read_methods(folder / METHODS)
    guesses = infer_truth(rows, min_methods=int(marker.get("min_methods", DEFAULT_MIN_METHODS)))
    known = {g.id for g in guesses}
    # 只保留人工確認的部分；自動推定由 resolve_truths 重新補上
    confirmed = {k: v for k, v in read_truth(folder).items() if v[1] is TruthSource.MANUAL}
    for image_id, value in updates.items():
        if image_id not in known:
            raise SceneError(f"沒有這張圖片：{image_id}", "truths")
        if value is None:
            confirmed.pop(image_id, None)
            continue
        code = normalize_truth(value)
        if code and not valid_code(code):
            raise SceneError(f"{image_id} 的條碼不合法（檢查碼錯誤或位數不對）：{value}", "truths")
        confirmed[image_id] = (code, TruthSource.MANUAL)
    write_truth(folder, resolve_truths(guesses, confirmed))
    return run_json(str(folder), criteria, thumb)
