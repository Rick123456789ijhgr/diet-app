"""E3 電子發票 QR：每張影像執行所有單一方法，判定正確／部分／誤讀／未讀到，並離線計算逐步升級。

依 ADR 0005 與 ``docs/preprocess-experiment-design.md`` 3.3、5.3、6.3、6.5、8.1 節：

- 真值為左、右兩個 QR 的**原始位元組**（右側常含 Big5 中文，不能當成文字比對），manifest 的
  ``truth`` 欄寫成兩段小寫 hex 以 ``|`` 分隔（``format_invoice_truth``）；空字串為負樣本。
- 判定（``judge_invoice``）：比照 ``locate_invoice_qrs`` 只取面積最大的兩個 QR，再與真值比對。
  兩個都一致 → ``correct``；只有一個且一致 → ``partial``；任一不一致 → ``misread``；
  都沒有 → ``missed``。負樣本有 QR → ``false_positive``，否則 ``true_negative``。
  左右不另判：兩個 QR 的內容不同，位元組一致即代表找對了。
- ``run_invoice_methods``：實驗組 ``ladder.rungs`` 中的每一階都由原圖獨立處理並解碼一次
  （同 E1 的 ``run_methods``），每個「影像 × 方法」寫一列到 ``invoice_methods.csv``，
  記錄找到的所有 QR（hex 與面積）。
- ``simulate_invoice_ladder``：由結果表離線計算逐步升級，規則同 ``locate_invoice_qrs``——
  依序累積各階找到的 QR（同內容只留第一次），湊滿兩個即停止。
"""

from __future__ import annotations

import csv
import json
import statistics
import time
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from dietai.evaluation.barcode import (
    META_FILE,
    Arm,
    RunSummary,
    _jsonable,
    _natural,
    meta_lines,
    prepare_run_dir,
    run_meta,
)
from dietai.evaluation.manifest import SOURCE_COLUMN, Manifest, read_image
from dietai.evaluation.methods import _check_methods, _Variant, _variants, arm_methods, method_id
from dietai.evaluation.stats import wilson_interval
from dietai.preprocess import ops
from dietai.preprocess.barcode import RungAttempt, iter_attempts
from dietai.preprocess.config import LadderConfig
from dietai.preprocess.decoders import Decoder
from dietai.preprocess.types import CodeFormat, Image, Rung

EXPERIMENT = "e3_invoice_qr"
MODE = "invoice_methods"
INVOICE_METHODS_FILE = "invoice_methods.csv"
INVOICE_METHOD_COLUMNS = (
    "id",
    "image",
    "arm",
    "method",
    "rung",
    "params",
    "truth",
    "split",
    "outcome",
    "decoded",
    "areas",
    "skipped",
    "elapsed_ms",
    "preprocess_ms",
    "decode_ms",
    "error",
)
# 逐步升級（離線計算）每個變體一列的欄位
INVOICE_LADDER_COLUMNS = (
    "id",
    "image",
    "arm",
    "truth",
    "split",
    "outcome",
    "attempts",
    "stop_method",
    "elapsed_ms",
    "decoded",
    "error",
)


class InvoiceOutcome(StrEnum):
    """一張發票影像在一個方法（或一條逐步升級）下的判定。"""

    CORRECT = "correct"
    PARTIAL = "partial"
    MISREAD = "misread"
    MISSED = "missed"
    FALSE_POSITIVE = "false_positive"
    TRUE_NEGATIVE = "true_negative"
    ERROR = "error"


def format_invoice_truth(left: bytes, right: bytes) -> str:
    """manifest ``truth`` 欄的寫法：左、右 QR 原始位元組的小寫 hex，以 ``|`` 分隔。"""
    return f"{left.hex()}|{right.hex()}"


def parse_invoice_truth(truth: str) -> frozenset[bytes] | None:
    """解析 ``truth`` 欄；空字串（負樣本）回傳 ``None``。

    須恰為兩段、非空、內容不同的 hex，否則丟 ``ValueError``。
    """
    if not truth.strip():
        return None
    parts = truth.strip().split("|")
    if len(parts) != 2 or not all(parts):
        raise ValueError(f"發票真值須為「左 hex|右 hex」兩段，收到 {truth[:40]!r}")
    try:
        raws = frozenset(bytes.fromhex(p) for p in parts)
    except ValueError as e:
        raise ValueError(f"發票真值不是合法的 hex：{e}") from e
    if len(raws) != 2:
        raise ValueError("發票真值的左右兩個 QR 內容相同")
    return raws


def select_pair(found: Mapping[bytes, float]) -> list[bytes]:
    """（內容 → 面積）中面積最大的兩個，規則同 ``locate_invoice_qrs``（排除背景中較小的 QR）。"""
    return sorted(found, key=lambda raw: found[raw], reverse=True)[:2]


def judge_invoice(selected: Sequence[bytes], truth: frozenset[bytes] | None) -> InvoiceOutcome:
    """判定規則見模組說明；``selected`` 為已取最大兩個的 QR 內容。"""
    got = set(selected)
    if truth is None:
        return InvoiceOutcome.FALSE_POSITIVE if got else InvoiceOutcome.TRUE_NEGATIVE
    if got - truth:
        return InvoiceOutcome.MISREAD
    matched = len(got & truth)
    if matched == 2:
        return InvoiceOutcome.CORRECT
    return InvoiceOutcome.PARTIAL if matched == 1 else InvoiceOutcome.MISSED


def run_invoice_methods(
    manifest: Manifest,
    arms: Sequence[Arm],
    out_dir: str | Path,
    *,
    include_test: bool = False,
    decoder_factory: Callable[[Arm], Decoder] | None = None,
    progress: Callable[[int, int], None] | None = None,
    label: str = "",
) -> RunSummary:
    """對 manifest 的每張影像，執行每個實驗組 ``ladder.rungs`` 中的所有方法（不提早停止）。

    寫入 ``out_dir``：``invoice_methods.csv``（每張影像 × 實驗組 × 方法一列，欄位見
    ``INVOICE_METHOD_COLUMNS``，後接標籤欄）與 ``run.json``（``experiment`` 為 ``e3_invoice_qr``）。
    實驗組的 ``accept_formats`` 不使用：只採用 QR 格式的結果（同 ``locate_invoice_qrs``）。
    測試集鎖定、輸出資料夾不覆寫等檢查與 ``run_methods`` 相同；真值格式錯誤時該影像記為 error。
    """
    out = prepare_run_dir(
        manifest, arms, out_dir, INVOICE_METHOD_COLUMNS, include_test=include_test
    )
    factory = decoder_factory or Arm.make_decoder
    decoders = [factory(a) for a in arms]
    started = datetime.now().astimezone()
    t0 = time.perf_counter()
    counts: Counter[str] = Counter()
    total, done = len(manifest.items) * len(arms), 0
    with (out / INVOICE_METHODS_FILE).open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[*INVOICE_METHOD_COLUMNS, *manifest.tag_columns])
        writer.writeheader()
        for item in manifest.items:
            img: Image | None = None
            truth: frozenset[bytes] | None = None
            load_error = ""
            try:
                truth = parse_invoice_truth(item.truth)
                img = read_image(item.image)
                ops.validate_image(img)
            except Exception as e:  # 單張讀檔或真值錯誤不中斷整批
                img, load_error = None, f"{type(e).__name__}: {e}"
            for arm, decoder in zip(arms, decoders, strict=True):
                base = {
                    "id": item.id,
                    "image": str(item.image),
                    "arm": arm.name,
                    "truth": item.truth,
                    "split": item.split,
                    **item.tags,
                }
                for rung in arm.ladder.rungs:
                    for row in _rung_rows(img, load_error, truth, decoder, arm.ladder, rung):
                        counts[row["outcome"]] += 1
                        writer.writerow({**base, **row})
                done += 1
                if progress is not None:
                    progress(done, total)

    duration = time.perf_counter() - t0
    meta = {
        **run_meta(
            manifest, arms, started, duration, counts, include_test=include_test, label=label
        ),
        "experiment": EXPERIMENT,
        "mode": MODE,
        "methods": {a.name: list(arm_methods(a.ladder)) for a in arms},
    }
    (out / META_FILE).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return RunSummary(out, dict(counts), duration)


def _rung_rows(
    img: Image | None,
    load_error: str,
    truth: frozenset[bytes] | None,
    decoder: Decoder,
    cfg: LadderConfig,
    rung: Rung,
) -> list[dict[str, Any]]:
    """一階（多尺度為每個倍率）的結果列；讀檔失敗或處理丟出例外時每個方法各一列 error。"""
    # 只含這一階、不限格式（QR 由 _attempt_row 過濾），每個方法都由原圖獨立處理、各自計時
    single = replace(cfg, rungs=(rung,), accept_formats=())
    error = load_error
    if img is not None:
        try:
            return [_attempt_row(a, truth) for _, a in iter_attempts(img, decoder, single)]
        except Exception as e:  # 單一方法失敗不影響其他方法
            error = f"{type(e).__name__}: {e}"
    return [
        {"method": m, "rung": rung.value, "outcome": InvoiceOutcome.ERROR.value, "error": error}
        for m in arm_methods(single)
    ]


def _attempt_row(attempt: RungAttempt, truth: frozenset[bytes] | None) -> dict[str, Any]:
    """``invoice_methods.csv`` 一列中的方法與判定欄位。"""
    found: dict[bytes, float] = {}
    for hit in attempt.hits:
        if hit.format is CodeFormat.QR_CODE:
            found.setdefault(hit.raw, hit.area)
    return {
        "method": method_id(attempt.rung, attempt.params),
        "rung": attempt.rung.value,
        "params": json.dumps(_jsonable(dict(attempt.params))),
        "outcome": judge_invoice(select_pair(found), truth).value,
        # decoded 與 areas 一一對應，供離線逐步升級時依面積取最大兩個
        "decoded": "|".join(raw.hex() for raw in found),
        "areas": "|".join(f"{a:.1f}" for a in found.values()),
        "skipped": int(attempt.skipped),
        "elapsed_ms": f"{attempt.elapsed_ms:.3f}",
        "preprocess_ms": f"{attempt.elapsed_ms - attempt.decode_ms:.3f}",
        "decode_ms": f"{attempt.decode_ms:.3f}",
        "error": "",
    }


def read_invoice_methods(run_dir: str | Path) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """讀取一次 E3 的（``run.json`` 內容, ``invoice_methods.csv`` 各列）。"""
    run = Path(run_dir)
    meta = json.loads((run / META_FILE).read_text(encoding="utf-8"))
    with (run / INVOICE_METHODS_FILE).open(encoding="utf-8-sig", newline="") as f:
        return meta, list(csv.DictReader(f))


# ---- 離線計算：逐步升級 ----


@dataclass(frozen=True)
class _InvoiceLadder:
    """一個變體依某順序逐步升級的結果。"""

    outcome: InvoiceOutcome
    tried: int
    elapsed_ms: float
    stop_method: str = ""
    pair: tuple[bytes, ...] = ()
    error: str = ""


def _found(row: Mapping[str, str]) -> list[tuple[bytes, float]]:
    """一列找到的（QR 內容, 面積）。"""
    if not row["decoded"]:
        return []
    raws = [bytes.fromhex(h) for h in row["decoded"].split("|")]
    areas = [float(a) for a in row["areas"].split("|")]
    return list(zip(raws, areas, strict=True))


def _invoice_ladder(v: _Variant, order: Sequence[str]) -> _InvoiceLadder:
    """依 ``order`` 逐一累積找到的 QR，湊滿兩個即停止（規則同 ``locate_invoice_qrs``）。"""
    found: dict[bytes, float] = {}
    elapsed = 0.0
    stop = ""
    tried = 0
    for i, method in enumerate(order):
        row = v.by_method[method]
        if row["outcome"] == InvoiceOutcome.ERROR:
            # 上線時例外會中斷整條階梯；離線計算同樣把整個變體記為 error
            return _InvoiceLadder(InvoiceOutcome.ERROR, i + 1, elapsed, error=row["error"])
        tried = i + 1
        elapsed += float(row["elapsed_ms"])
        for raw, area in _found(row):
            # 同內容只保留最早的階（面積也取那一次），同 locate_invoice_qrs
            found.setdefault(raw, area)
        if len(found) >= 2:
            stop = method
            break
    pair = select_pair(found)
    outcome = judge_invoice(pair, parse_invoice_truth(v.truth))
    return _InvoiceLadder(outcome, tried, elapsed, stop, tuple(pair))


def simulate_invoice_ladder(
    rows: Sequence[Mapping[str, str]],
    order: Sequence[str],
    *,
    arm: str | None = None,
    name: str = "",
) -> list[dict[str, Any]]:
    """由結果表離線計算依 ``order`` 逐步升級的結果，每個變體一列。

    欄位為 ``INVOICE_LADDER_COLUMNS`` 後接標籤欄；``arm`` 欄為 ``name``（省略時以 ``>`` 串接
    方法代碼）。``order`` 中任一方法不在結果表時丟 ``ValueError``。
    """
    if not order:
        raise ValueError("order 不得為空")
    variants = _variants(rows, arm)
    _check_methods(variants, order)
    label = name or ">".join(order)
    out: list[dict[str, Any]] = []
    for v in variants:
        res = _invoice_ladder(v, order)
        tags = {k: val for k, val in v.row.items() if k not in INVOICE_METHOD_COLUMNS}
        out.append(
            {
                "id": v.row["id"],
                "image": v.row["image"],
                "arm": label,
                "truth": v.truth,
                "split": v.row["split"],
                "outcome": res.outcome.value,
                "attempts": res.tried,
                "stop_method": res.stop_method,
                "elapsed_ms": f"{res.elapsed_ms:.3f}",
                "decoded": "|".join(raw.hex() for raw in res.pair),
                "error": res.error,
                **tags,
            }
        )
    return out


# ---- 彙整與報告 ----


def summarize_invoice(
    rows: Sequence[Mapping[str, str]], key: str = "method", by: Sequence[str] = ()
) -> list[dict[str, Any]]:
    """依 ``key`` 欄（單一方法用 ``method``，逐步升級用 ``arm``）與 ``by`` 各欄分組彙整。

    每組欄位：``key``、``by`` 各欄、``n``（正樣本數，不含 error）、``sources``（原始樣本數）、
    ``correct``／``partial``／``misread``／``missed``（次數）、``rate``（正確率）與 Wilson 95%
    ``ci_low``／``ci_high``、``partial_rate``、``misread_rate``、``source_rate``（先在原始樣本內
    平均再平均，設計 9.1 節）、``negatives``、``false_positive``、``errors``、``median_ms``。
    """
    groups: dict[tuple[str, ...], list[Mapping[str, str]]] = {}
    for r in rows:
        groups.setdefault((r[key], *(r.get(k, "") for k in by)), []).append(r)
    order = list(dict.fromkeys(r[key] for r in rows))
    out: list[dict[str, Any]] = []
    for k in sorted(groups, key=lambda g: (order.index(g[0]), *map(_natural, g[1:]))):
        group = groups[k]
        valid = [r for r in group if r["outcome"] != InvoiceOutcome.ERROR]
        pos = [r for r in valid if r["truth"]]
        oc = Counter(r["outcome"] for r in group)
        n, correct = len(pos), oc[InvoiceOutcome.CORRECT]
        lo, hi = wilson_interval(correct, n)
        by_source: dict[str, list[int]] = {}
        for r in pos:
            ok = int(r["outcome"] == InvoiceOutcome.CORRECT)
            by_source.setdefault(r.get(SOURCE_COLUMN) or r["id"], []).append(ok)
        ms = [float(r["elapsed_ms"]) for r in valid if r["elapsed_ms"]]
        out.append(
            {
                key: k[0],
                **dict(zip(by, k[1:], strict=True)),
                "n": n,
                "sources": len(by_source),
                "correct": correct,
                "partial": oc[InvoiceOutcome.PARTIAL],
                "misread": oc[InvoiceOutcome.MISREAD],
                "missed": oc[InvoiceOutcome.MISSED],
                "rate": correct / n if n else None,
                "ci_low": lo if n else None,
                "ci_high": hi if n else None,
                "partial_rate": oc[InvoiceOutcome.PARTIAL] / n if n else None,
                "misread_rate": oc[InvoiceOutcome.MISREAD] / n if n else None,
                "source_rate": statistics.fmean(statistics.fmean(v) for v in by_source.values())
                if by_source
                else None,
                "negatives": len(valid) - n,
                "false_positive": oc[InvoiceOutcome.FALSE_POSITIVE],
                "errors": oc[InvoiceOutcome.ERROR],
                "median_ms": statistics.median(ms) if ms else None,
            }
        )
    return out


def invoice_report_markdown(
    meta: Mapping[str, Any], rows: Sequence[Mapping[str, str]], by: Sequence[str] = ()
) -> str:
    """Markdown 摘要：實驗紀錄、單一方法比較（整體與依各標籤）、各實驗組原順序的逐步升級。"""
    lines = meta_lines(meta, "E3 電子發票 QR")
    lines += ["", "## 單一方法 · Single methods", ""]
    lines.append(invoice_table(summarize_invoice(_method_rows(rows)), "method", ()))
    for tag in by:
        lines += ["", f"### 依 `{tag}` 分組", ""]
        summary = summarize_invoice(_method_rows(rows), "method", (tag,))
        lines.append(invoice_table(summary, "method", (tag,)))
    lines += ["", "## 逐步升級（實驗組原順序，離線計算）", ""]
    ladder: list[dict[str, Any]] = []
    for arm, methods in meta.get("methods", {}).items():
        ladder += simulate_invoice_ladder(rows, methods, arm=arm, name=arm)
    lines.append(invoice_table(summarize_invoice(ladder, "arm"), "arm", ()))
    lines += [
        "",
        "> 正確：兩個 QR 都讀到且位元組一致；部分：只讀到一個且一致；誤讀：任一不一致"
        "（設計 3.3 節）。原始樣本平均：先在原始樣本內平均再平均（設計 9.1 節）。",
    ]
    errors = sum(1 for r in rows if r["outcome"] == InvoiceOutcome.ERROR)
    if errors:
        lines += ["", f"> 有 {errors} 筆 error，未計入；見 {INVOICE_METHODS_FILE}。"]
    return "\n".join(lines) + "\n"


def _method_rows(rows: Sequence[Mapping[str, str]]) -> list[dict[str, str]]:
    """單一方法表的列：結果表有多個實驗組時，方法代碼加上實驗組（``實驗組:方法``）。"""
    multi = len({r["arm"] for r in rows}) > 1
    return [{**r, "method": f"{r['arm']}:{r['method']}" if multi else r["method"]} for r in rows]


def invoice_table(summary: Sequence[Mapping[str, Any]], key: str, by: Sequence[str]) -> str:
    """把 ``summarize_invoice`` 的結果排成 Markdown 表格。"""
    head = ["方法" if key == "method" else "實驗組", *by, "n", "原始樣本", "正確率", "95% CI"]
    head += ["部分", "誤讀", "原始樣本平均", "負樣本誤報", "ms"]
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]

    def pct(v: float | None) -> str:
        return "—" if v is None else f"{v:.1%}"

    for s in summary:
        ci = "—" if s["ci_low"] is None else f"{s['ci_low']:.1%}–{s['ci_high']:.1%}"
        fp = f"{s['false_positive']}/{s['negatives']}" if s["negatives"] else "—"
        cells = [str(s[key]), *(str(s[b]) for b in by), str(s["n"]), str(s["sources"])]
        cells += [pct(s["rate"]), ci, pct(s["partial_rate"]), pct(s["misread_rate"])]
        cells += [pct(s["source_rate"]), fp]
        cells.append("—" if s["median_ms"] is None else f"{s['median_ms']:.0f}")
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)
