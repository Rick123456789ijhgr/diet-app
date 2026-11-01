"""營養標示 OCR 的批次評估：每張影像 × 每個前處理方法 × 每個 OCR 引擎辨識一次並評分。

處理一律呼叫 ``dietai.preprocess.preprocess_label``、OCR 引擎（``label_parsing.ocr.OcrEngine``，
實作在 ``dietai.adapters.ocr``）與 ``label_parsing.parse_fields``；這裡只負責「跑哪些組合、
怎麼評分、怎麼記錄與彙整」。

- manifest 的 ``truth`` 欄為真值 JSON 的路徑（相對於 manifest，格式見 ``evaluation.label``）；
  空字串為負樣本（影像中沒有營養標示），只記錄讀到幾個欄位。
- 前處理方法以名稱對應 ``LabelConfig``；``None`` 表示原圖（不做前處理，階段零只用這個）。
  有定位（``enable_rectify``）且真值有 ``quad`` 時另計算定位誤差。
- 結果寫在 ``label_results.csv``（每張影像 × 方法 × 引擎一列）與 ``run.json``。
"""

from __future__ import annotations

import csv
import json
import statistics
import time
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

from dietai.evaluation.barcode import (
    META_FILE,
    RunSummary,
    _config_section,
    _git_info,
    _jsonable,
    _natural,
    _package_versions,
    _sidecar,
    meta_lines,
    prepare_run_dir,
)
from dietai.evaluation.label import (
    DEFAULT_QUAD_TOL,
    LabelTruth,
    cer,
    load_label_truth,
    quad_error,
    score_fields,
)
from dietai.evaluation.manifest import SOURCE_COLUMN, Manifest, read_image
from dietai.label_parsing.fields import format_fields, parse_fields
from dietai.label_parsing.ocr import OcrEngine, group_lines
from dietai.preprocess import ops
from dietai.preprocess.config import LabelConfig
from dietai.preprocess.label import preprocess_label
from dietai.preprocess.types import Image, Quad

EXPERIMENT = "e2_label"
LABEL_RESULTS_FILE = "label_results.csv"
LABEL_COLUMNS = (
    "id",
    "image",
    "engine",
    "method",
    "truth",
    "split",
    "correct",
    "total",
    "accuracy",
    "all_correct",
    "cer",
    "quad_error",
    "located",
    "n_fields",
    "fields",
    "wrong",
    "lines",
    "preprocess_ms",
    "ocr_ms",
    "error",
)
RAW = "raw"


_METHOD_KEYS = frozenset({"name", "description", "label"})


def load_label_methods(
    folder: str | Path, only: Sequence[str] = ()
) -> dict[str, LabelConfig | None]:
    """讀取前處理方法設定（``folder`` 中的每個 ``*.json``，依檔名排序）。

    每個檔案：``{"name": ..., "description": ..., "label": {LabelConfig 欄位} 或 null}``；
    ``label`` 為 ``null`` 表示原圖。``name`` 省略時用檔名。``only`` 非空時只保留這些名稱
    （依 ``only`` 的順序）。未知欄位、名稱重複或找不到時丟 ``ValueError``。
    """
    out: dict[str, LabelConfig | None] = {}
    for path in sorted(Path(folder).glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or set(data) - _METHOD_KEYS or "label" not in data:
            raise ValueError(f"{path.name}：須為含 label 的物件，可用鍵 {sorted(_METHOD_KEYS)}")
        name = str(data.get("name") or path.stem)
        if name in out:
            raise ValueError(f"前處理方法名稱重複：{name}")
        try:
            cfg = None if data["label"] is None else _config_section(LabelConfig, data["label"])
        except (TypeError, ValueError) as e:
            raise ValueError(f"{path.name}：{e}") from e
        out[name] = cfg
    if only:
        missing = [n for n in only if n not in out]
        if missing:
            raise ValueError(f"找不到前處理方法 {missing}；可用：{list(out)}")
        out = {n: out[n] for n in only}
    if not out:
        raise ValueError(f"{folder} 沒有任何前處理方法設定")
    return out


def run_label_ocr(
    manifest: Manifest,
    engines: Mapping[str, OcrEngine],
    out_dir: str | Path,
    *,
    methods: Mapping[str, LabelConfig | None] | None = None,
    quad_tol: float = DEFAULT_QUAD_TOL,
    include_test: bool = False,
    progress: Callable[[int, int], None] | None = None,
    label: str = "",
) -> RunSummary:
    """對 manifest 的每張影像，依序做每個前處理方法，再交給每個引擎辨識並評分。

    ``engines`` 為（簡稱 → 引擎），簡稱寫入結果的 ``engine`` 欄，引擎的完整 ``name``（含版本、
    模型、語言包）寫入 ``run.json``。``methods`` 省略時只有原圖（``raw``）。
    測試集鎖定、輸出資料夾不覆寫等檢查同 ``run_experiment``；``progress`` 以「影像 × 方法」為單位。
    真值檔讀不到或格式錯誤時，該影像每一列記為 error，不中斷整批。
    """
    methods = dict(methods) if methods is not None else {RAW: None}
    if not engines or not methods:
        raise ValueError("至少要有一個引擎與一個前處理方法")
    combos = [(m, e) for m in methods for e in engines]
    out = prepare_run_dir(manifest, combos, out_dir, LABEL_COLUMNS, include_test=include_test)
    started = datetime.now().astimezone()
    t0 = time.perf_counter()
    counts: Counter[str] = Counter()
    total, done = len(manifest.items) * len(methods), 0
    with (out / LABEL_RESULTS_FILE).open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[*LABEL_COLUMNS, *manifest.tag_columns])
        writer.writeheader()
        for item in manifest.items:
            base = {
                "id": item.id,
                "image": str(item.image),
                "truth": item.truth,
                "split": item.split,
                **item.tags,
            }
            img: Image | None = None
            truth: LabelTruth | None = None
            load_error = ""
            try:
                img = read_image(item.image)
                ops.validate_image(img)
                if item.truth:
                    truth = load_label_truth(manifest.path.parent / item.truth)
            except Exception as e:  # 單張讀檔或真值錯誤不中斷整批
                # 真值錯誤時影像雖已讀到，也不能當成負樣本評分
                img, load_error = None, f"{type(e).__name__}: {e}"
            for method, cfg in methods.items():
                rows = _method_rows(img, load_error, truth, cfg, engines, quad_tol)
                for engine, row in rows:
                    counts[_outcome(row)] += 1
                    writer.writerow({**base, "engine": engine, "method": method, **row})
                done += 1
                if progress is not None:
                    progress(done, total)

    duration = time.perf_counter() - t0
    meta = {
        "experiment": EXPERIMENT,
        "label": label,
        "created": started.isoformat(timespec="seconds"),
        "duration_s": round(duration, 3),
        "git": _git_info(),
        "packages": _package_versions(),
        "manifest": {
            "path": str(manifest.path),
            "sha256": manifest.sha256,
            "items": len(manifest.items),
            "excluded_test": manifest.excluded_test,
            "include_test": include_test,
            "tag_columns": list(manifest.tag_columns),
            "dataset": _sidecar(manifest.path),
        },
        "engines": {k: e.name for k, e in engines.items()},
        "methods": {k: None if c is None else _jsonable(asdict(c)) for k, c in methods.items()},
        "quad_tol": quad_tol,
        "counts": dict(sorted(counts.items())),
    }
    (out / META_FILE).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return RunSummary(out, dict(counts), duration)


def _method_rows(
    img: Image | None,
    load_error: str,
    truth: LabelTruth | None,
    cfg: LabelConfig | None,
    engines: Mapping[str, OcrEngine],
    quad_tol: float,
) -> list[tuple[str, dict[str, Any]]]:
    """一張影像在一個前處理方法下，每個引擎的結果列。前處理只做一次，各引擎共用。"""
    if img is None:
        return [(e, {"error": load_error}) for e in engines]
    start = time.perf_counter()
    found: Quad | None = None
    try:
        if cfg is None:
            processed = img
        else:
            res = preprocess_label(img, cfg)
            processed, found = res.image, res.quad
    except Exception as e:  # 前處理失敗時，此方法的每個引擎都記為 error
        return [(name, {"error": f"{type(e).__name__}: {e}"}) for name in engines]
    pre_ms = (time.perf_counter() - start) * 1000
    located_fields: dict[str, Any] = {}
    if truth is not None and truth.quad is not None and cfg is not None and cfg.enable_rectify:
        err = None if found is None else quad_error(found, truth.quad)
        located_fields = {
            "quad_error": "" if err is None else f"{err:.4f}",
            "located": int(err is not None and err <= quad_tol),
        }
    rows: list[tuple[str, dict[str, Any]]] = []
    for name, engine in engines.items():
        row: dict[str, Any] = {"preprocess_ms": f"{pre_ms:.3f}", **located_fields}
        start = time.perf_counter()
        try:
            lines = group_lines(engine(processed))
        except Exception as e:  # 單一引擎失敗不影響其他引擎
            rows.append((name, {**row, "error": f"{type(e).__name__}: {e}"}))
            continue
        row["ocr_ms"] = f"{(time.perf_counter() - start) * 1000:.3f}"
        parsed = parse_fields(lines)
        row.update(
            n_fields=len(parsed),
            fields=json.dumps(format_fields(parsed), ensure_ascii=False),
            lines=json.dumps(lines, ensure_ascii=False),
            error="",
        )
        if truth is not None:
            score = _score(truth, parsed)
            row.update(score)
            if truth.text:
                text = "\n".join(lines)
                row["cer"] = f"{cer(truth.text, text):.4f}"
        rows.append((name, row))
    return rows


def _score(truth: LabelTruth, parsed: Mapping[str, Any]) -> dict[str, Any]:
    """欄位比對的結果欄位；``wrong`` 為答錯的格（欄位/欄 → 讀到的值，沒讀到為空字串）。"""
    s = score_fields(truth, parsed)
    wrong = {f"{n}/{c}" if c else n: "" if q is None else str(q) for (n, c), q in s.wrong.items()}
    return {
        "correct": s.correct,
        "total": s.total,
        "accuracy": f"{s.accuracy:.4f}",
        "all_correct": int(s.all_correct),
        "wrong": json.dumps(wrong, ensure_ascii=False),
    }


def _outcome(row: Mapping[str, Any]) -> str:
    """計數用的分類：error、negative（負樣本）、all_correct、partial、none（一格都沒對）。"""
    if row.get("error"):
        return "error"
    if "total" not in row:
        return "negative"
    if row["all_correct"]:
        return "all_correct"
    return "partial" if row["correct"] else "none"


def read_label_run(run_dir: str | Path) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """讀取一次執行的（``run.json`` 內容, ``label_results.csv`` 各列）。"""
    run = Path(run_dir)
    meta = json.loads((run / META_FILE).read_text(encoding="utf-8"))
    with (run / LABEL_RESULTS_FILE).open(encoding="utf-8-sig", newline="") as f:
        return meta, list(csv.DictReader(f))


def summarize_label(
    rows: Sequence[Mapping[str, str]], by: Sequence[str] = ()
) -> list[dict[str, Any]]:
    """依（方法, 引擎, ``by`` 各欄）彙整。

    每組欄位：``method``、``engine``、``by`` 各欄、``n``（有真值的影像數，不含 error）、
    ``sources``（原始樣本數）、``field_accuracy``（所有格合併的欄位完全正確率）、
    ``source_accuracy``（先在原始樣本內平均、再對原始樣本平均；設計 9.1 節）、
    ``all_correct``（整張全對的比例）、``mean_cer``、``located``（定位成功率）、``mean_quad_error``、
    ``negatives``／``negative_fields``（負樣本數與其中讀到任何欄位的張數）、``errors``、
    ``median_ocr_ms``。沒有資料的指標為 ``None``。
    """
    groups: dict[tuple[str, ...], list[Mapping[str, str]]] = {}
    for r in rows:
        groups.setdefault((r["method"], r["engine"], *(r.get(k, "") for k in by)), []).append(r)
    method_order = list(dict.fromkeys(r["method"] for r in rows))
    engine_order = list(dict.fromkeys(r["engine"] for r in rows))
    out: list[dict[str, Any]] = []
    for key in sorted(
        groups,
        key=lambda k: (method_order.index(k[0]), engine_order.index(k[1]), *map(_natural, k[2:])),
    ):
        group = groups[key]
        ok = [r for r in group if not r["error"]]
        pos = [r for r in ok if r["truth"]]
        neg = [r for r in ok if not r["truth"]]
        correct = sum(int(r["correct"]) for r in pos)
        cells = sum(int(r["total"]) for r in pos)
        by_source: dict[str, list[float]] = {}
        for r in pos:
            by_source.setdefault(r.get(SOURCE_COLUMN) or r["id"], []).append(float(r["accuracy"]))
        cers = [float(r["cer"]) for r in pos if r.get("cer")]
        locs = [r for r in pos if r.get("located") != ""]
        quad_errs = [float(r["quad_error"]) for r in locs if r.get("quad_error")]
        ms = [float(r["ocr_ms"]) for r in ok if r.get("ocr_ms")]
        out.append(
            {
                "method": key[0],
                "engine": key[1],
                **dict(zip(by, key[2:], strict=True)),
                "n": len(pos),
                "sources": len(by_source),
                "field_accuracy": correct / cells if cells else None,
                "source_accuracy": statistics.fmean(statistics.fmean(v) for v in by_source.values())
                if by_source
                else None,
                "all_correct": statistics.fmean(int(r["all_correct"]) for r in pos)
                if pos
                else None,
                "mean_cer": statistics.fmean(cers) if cers else None,
                "located": statistics.fmean(int(r["located"]) for r in locs) if locs else None,
                "mean_quad_error": statistics.fmean(quad_errs) if quad_errs else None,
                "negatives": len(neg),
                "negative_fields": sum(1 for r in neg if int(r["n_fields"] or 0) > 0),
                "errors": len(group) - len(ok),
                "median_ocr_ms": statistics.median(ms) if ms else None,
            }
        )
    return out


def label_report_markdown(
    meta: Mapping[str, Any], rows: Sequence[Mapping[str, str]], by: Sequence[str] = ()
) -> str:
    """Markdown 摘要：實驗紀錄、引擎完整名稱、整體與依各標籤分組的指標。"""
    lines = meta_lines(meta, "E2 營養標示 OCR")
    lines += ["", "## 引擎", ""]
    lines += [f"- `{k}`：{v}" for k, v in meta.get("engines", {}).items()]
    lines += ["", "## 整體 · Overall", "", _label_table(summarize_label(rows), ())]
    for tag in by:
        lines += [
            "",
            f"## 依 `{tag}` 分組",
            "",
            _label_table(summarize_label(rows, (tag,)), (tag,)),
        ]
    lines += [
        "",
        "> 欄位正確率：所有（欄位, 欄）合併計算；原始樣本平均：先在原始樣本內平均再平均"
        "（設計 9.1）。定位只在前處理含定位、且真值有 quad 時計算。",
    ]
    errors = sum(1 for r in rows if r["error"])
    if errors:
        lines += ["", f"> 有 {errors} 筆 error，未計入；見 label_results.csv。"]
    return "\n".join(lines) + "\n"


def _label_table(summary: Sequence[Mapping[str, Any]], by: Sequence[str]) -> str:
    """把 ``summarize_label`` 的結果排成 Markdown 表格。"""
    head = ["方法", "引擎", *by, "n", "原始樣本", "欄位正確率", "原始樣本平均", "整張全對"]
    head += ["CER", "定位成功", "負樣本誤讀", "OCR ms"]
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]

    def pct(v: float | None) -> str:
        return "—" if v is None else f"{v:.1%}"

    for s in summary:
        neg = f"{s['negative_fields']}/{s['negatives']}" if s["negatives"] else "—"
        cells = [s["method"], s["engine"], *(str(s[b]) for b in by), str(s["n"])]
        cells += [str(s["sources"]), pct(s["field_accuracy"]), pct(s["source_accuracy"])]
        cells += [pct(s["all_correct"]), "—" if s["mean_cer"] is None else f"{s['mean_cer']:.3f}"]
        cells += [pct(s["located"]), neg]
        cells.append("—" if s["median_ocr_ms"] is None else f"{s['median_ocr_ms']:.0f}")
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)
