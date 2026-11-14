"""E1「每個方法都執行」：每個變體執行所有單一方法、不提早停止，輸出「變體 × 方法」結果表。

依 ADR 0005 與 ``docs/preprocess-experiment-design.md`` 6.3、6.5 節：

- ``run_methods``：實驗組 ``ladder.rungs`` 中的每一階都由原圖獨立處理並解碼一次（多尺度的每個
  倍率各算一個方法，例如 ``multiscale@2``），每個「變體 × 方法」寫一列到 ``methods.csv``。
  每個方法以「只含這一階」的設定分別執行，耗時互不影響（每個方法各自轉灰階），
  某個方法丟出例外也只有該方法記為 ``error``。
- ``simulate_ladder``：因為各方法都從原圖獨立處理，任何「方法子集＋順序」的逐步升級結果都能由
  結果表離線算出（依序找第一個已確認的結果，規則同 ``decode_with_ladder``，含 ``min_agree``），
  輸出與 ``results.csv`` 同格式的列，可直接交給 ``summarize``／``report_markdown``。
- ``greedy_ladder``：以貪婪法選擇步驟與順序（設計 6.5 節），每一步即該方法的邊際貢獻。

單一方法的判定與 ``judge`` 相同（``min_agree`` 只作用於逐步升級，不影響單一方法）：
正樣本有採用結果且任一與真值相符 → ``correct``，不符 → ``misread``，沒有 → ``missed``；
負樣本有採用結果 → ``false_positive``，否則 ``true_negative``。略過的方法（傾斜角太小而不旋轉）
不送解碼，判為 ``missed``／``true_negative``，``skipped`` 欄為 1。

逐步升級的耗時為已嘗試方法的耗時總和；每個方法的耗時都含轉灰階，上線時灰階只轉一次，
因此離線算出的耗時略為高估（轉灰階遠快於解碼）。
"""

from __future__ import annotations

import csv
import json
import time
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any

from dietai.evaluation.barcode import (
    META_FILE,
    Arm,
    Outcome,
    RunSummary,
    _gtin13,
    _jsonable,
    meta_lines,
    prepare_run_dir,
    run_meta,
    source_section,
    summarize,
    summary_table,
)
from dietai.evaluation.manifest import (
    TEST_SPLIT,
    Manifest,
    SplitLockedError,
    is_test_split,
    read_image,
)
from dietai.preprocess import ops
from dietai.preprocess.barcode import RungAttempt, iter_attempts
from dietai.preprocess.config import LadderConfig
from dietai.preprocess.decoders import Decoder
from dietai.preprocess.types import Image, Rung

MODE = "methods"  # 寫入 run.json 的 mode，區分逐步升級的執行
METHODS_FILE = "methods.csv"
METHOD_COLUMNS = (
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
    "formats",
    "rejected",
    "skipped",
    "elapsed_ms",
    "preprocess_ms",
    "decode_ms",
    "error",
)
# 逐步升級中「已有結果、之後的方法不再嘗試」以外的判定；貪婪法只對這兩種變體加入新方法
_UNDECIDED = (Outcome.MISSED, Outcome.TRUE_NEGATIVE)
_TEST_NOTE = "結果表含測試集，不做貪婪選擇（規則 7）；請以 `orders` 指定在 dev 上選定的順序。"


def method_id(rung: Rung, params: Mapping[str, Any]) -> str:
    """方法代碼：階的代碼；多尺度加上倍率（``multiscale@2``）、旋轉加上角度（``rotate@90``），
    疊加流程加上步驟（``pipeline@denoise+binarize``、``pipeline@multiscale:0.5+rotate:90``）。"""
    if rung is Rung.MULTISCALE:
        return f"{rung.value}@{float(params['factor']):g}"
    if rung is Rung.ROTATE:
        return f"{rung.value}@{float(params['angle']):g}"
    if rung is Rung.PIPELINE:
        return f"{rung.value}@{params['steps']}"
    return rung.value


def arm_methods(cfg: LadderConfig) -> tuple[str, ...]:
    """設定中 ``rungs`` 展開後的方法代碼（依階梯順序，多尺度依 ``scales``、旋轉依 ``angles``、
    疊加流程依 ``pipelines`` 的順序）。"""
    out: list[str] = []
    for rung in cfg.rungs:
        if rung is Rung.MULTISCALE:
            out += [method_id(rung, {"factor": f}) for f in cfg.scales]
        elif rung is Rung.ROTATE:
            out += [method_id(rung, {"angle": a}) for a in cfg.angles]
        elif rung is Rung.PIPELINE:
            out += [method_id(rung, {"steps": "+".join(str(s) for s in p)}) for p in cfg.pipelines]
        else:
            out.append(rung.value)
    return tuple(out)


def judge_attempt(attempt: RungAttempt, truth: str) -> Outcome:
    """單一方法（一次嘗試）的判定，規則見模組說明。"""
    if not truth:
        return Outcome.FALSE_POSITIVE if attempt.hits else Outcome.TRUE_NEGATIVE
    if not attempt.hits:
        return Outcome.MISSED
    if any(_gtin13(h.text) == _gtin13(truth) for h in attempt.hits):
        return Outcome.CORRECT
    return Outcome.MISREAD


def run_methods(
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

    寫入 ``out_dir``：``methods.csv``（每張影像 × 實驗組 × 方法一列，欄位見 ``METHOD_COLUMNS``，
    後接標籤欄）與 ``run.json``（``mode`` 為 ``"methods"``，``methods`` 為各組的方法代碼）。
    測試集鎖定、輸出資料夾不覆寫等檢查與 ``run_experiment`` 相同；``progress`` 以
    「影像 × 實驗組」為單位回報。
    """
    out = prepare_run_dir(manifest, arms, out_dir, METHOD_COLUMNS, include_test=include_test)
    factory = decoder_factory or Arm.make_decoder
    decoders = [factory(a) for a in arms]
    started = datetime.now().astimezone()
    t0 = time.perf_counter()
    counts: Counter[str] = Counter()
    total, done = len(manifest.items) * len(arms), 0
    with (out / METHODS_FILE).open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[*METHOD_COLUMNS, *manifest.tag_columns])
        writer.writeheader()
        for item in manifest.items:
            img: Image | None = None
            load_error = ""
            try:
                img = read_image(item.image)
                ops.validate_image(img)
            except Exception as e:  # 單張讀檔失敗不中斷整批
                load_error = f"{type(e).__name__}: {e}"
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
                    for row in _rung_rows(img, load_error, item.truth, decoder, arm.ladder, rung):
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
        "mode": MODE,
        "methods": {a.name: list(arm_methods(a.ladder)) for a in arms},
    }
    (out / META_FILE).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return RunSummary(out, dict(counts), duration)


def _rung_rows(
    img: Image | None,
    load_error: str,
    truth: str,
    decoder: Decoder,
    cfg: LadderConfig,
    rung: Rung,
) -> list[dict[str, Any]]:
    """一階（多尺度為每個倍率）的結果列；讀檔失敗或處理丟出例外時每個方法各一列 error。"""
    # 以只含這一階的設定執行，每個方法都由原圖獨立處理、各自計時
    single = replace(cfg, rungs=(rung,))
    error = load_error
    if img is not None:
        try:
            return [_attempt_row(a, truth) for _, a in iter_attempts(img, decoder, single)]
        except Exception as e:  # 單一方法失敗不影響其他方法
            error = f"{type(e).__name__}: {e}"
    return [
        {"method": m, "rung": rung.value, "outcome": Outcome.ERROR.value, "error": error}
        for m in arm_methods(single)
    ]


def _attempt_row(attempt: RungAttempt, truth: str) -> dict[str, Any]:
    """``methods.csv`` 一列中的方法與判定欄位。"""
    return {
        "method": method_id(attempt.rung, attempt.params),
        "rung": attempt.rung.value,
        "params": json.dumps(_jsonable(dict(attempt.params))),
        "outcome": judge_attempt(attempt, truth).value,
        # decoded 與 formats 一一對應（同一位置為同一個結果），供離線計算 min_agree 的票數
        "decoded": "|".join(h.text for h in attempt.hits),
        "formats": "|".join(h.format.value for h in attempt.hits),
        "rejected": len(attempt.rejected),
        "skipped": int(attempt.skipped),
        "elapsed_ms": f"{attempt.elapsed_ms:.3f}",
        "preprocess_ms": f"{attempt.elapsed_ms - attempt.decode_ms:.3f}",
        "decode_ms": f"{attempt.decode_ms:.3f}",
        "error": "",
    }


def read_methods(run_dir: str | Path) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """讀取一次「每個方法都執行」的（``run.json`` 內容, ``methods.csv`` 各列）。"""
    run = Path(run_dir)
    meta = json.loads((run / META_FILE).read_text(encoding="utf-8"))
    with (run / METHODS_FILE).open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    return meta, rows


def list_method_runs(root: str | Path) -> list[Path]:
    """``root`` 下所有完整的「每個方法都執行」資料夾（含 ``methods.csv``），新的在前。"""
    root = Path(root)
    if not root.is_dir():
        return []
    return sorted(
        (p.parent for p in root.glob(f"*/{META_FILE}") if (p.parent / METHODS_FILE).is_file()),
        reverse=True,
    )


# ---- 離線計算：逐步升級與貪婪選擇 ----


@dataclass(frozen=True)
class _Variant:
    """結果表中一個變體（一張影像在一個實驗組下）的各方法結果。"""

    row: Mapping[str, str]  # 任一方法列，取 id、truth、標籤等共同欄位
    by_method: Mapping[str, Mapping[str, str]]

    @property
    def truth(self) -> str:
        return self.row["truth"]

    @property
    def has_error(self) -> bool:
        return any(r["outcome"] == Outcome.ERROR for r in self.by_method.values())


@dataclass(frozen=True)
class _LadderOutcome:
    """一個變體依某順序逐步升級的結果。``index`` 為確認結果的方法在順序中的位置。"""

    outcome: Outcome
    tried: int
    elapsed_ms: float
    index: int | None = None
    first: str = ""
    hits: tuple[tuple[str, str], ...] = ()  # 已確認的（格式, 內容）
    rejected: int = 0
    error: str = ""


def _hits(row: Mapping[str, str]) -> list[tuple[str, str]]:
    """一列的採用結果（格式, 內容），依原順序去除重複。"""
    if not row["decoded"]:
        return []
    pairs = zip(row["formats"].split("|"), row["decoded"].split("|"), strict=True)
    return list(dict.fromkeys(pairs))


def _ladder(v: _Variant, order: Sequence[str], min_agree: int) -> _LadderOutcome:
    """依 ``order`` 逐一嘗試，有結果達 ``min_agree`` 票即停止（規則同 ``decode_with_ladder``）。"""
    votes: Counter[tuple[str, str]] = Counter()
    elapsed, rejected = 0.0, 0
    for i, method in enumerate(order):
        row = v.by_method[method]
        if row["outcome"] == Outcome.ERROR:
            # 上線時例外會中斷整條階梯；離線計算同樣把整個變體記為 error
            return _LadderOutcome(Outcome.ERROR, i + 1, elapsed, error=row["error"])
        elapsed += float(row["elapsed_ms"])
        rejected += int(row["rejected"])
        hits = _hits(row)
        votes.update(hits)  # 同一次嘗試只算一票（_hits 已去重）
        confirmed = tuple(h for h in hits if votes[h] >= min_agree)
        if not confirmed:
            continue
        if not v.truth:
            outcome = Outcome.FALSE_POSITIVE
        elif any(_gtin13(text) == _gtin13(v.truth) for _, text in confirmed):
            outcome = Outcome.CORRECT
        else:
            outcome = Outcome.MISREAD
        # 第一次解出任一已確認結果的方法，即救回這個變體的步驟（同 barcode.first_rung）
        first = next(m for m in order[: i + 1] if set(_hits(v.by_method[m])) & set(confirmed))
        return _LadderOutcome(outcome, i + 1, elapsed, i, first, confirmed, rejected)
    outcome = Outcome.TRUE_NEGATIVE if not v.truth else Outcome.MISSED
    return _LadderOutcome(outcome, len(order), elapsed, rejected=rejected)


def _variants(rows: Sequence[Mapping[str, str]], arm: str | None) -> list[_Variant]:
    """把結果表整理成各變體（依第一次出現的順序）；``arm`` 省略時結果表只能有一個實驗組。"""
    arms = list(dict.fromkeys(r["arm"] for r in rows))
    if arm is None:
        if len(arms) > 1:
            raise ValueError(f"結果表有多個實驗組 {arms}，請指定 arm")
        arm = arms[0] if arms else ""
    elif arm not in arms:
        raise ValueError(f"找不到實驗組 {arm!r}；可用：{arms}")
    grouped: dict[str, dict[str, Mapping[str, str]]] = {}
    for r in rows:
        if r["arm"] == arm:
            grouped.setdefault(r["id"], {})[r["method"]] = r
    return [_Variant(next(iter(ms.values())), ms) for ms in grouped.values()]


def methods_in(rows: Sequence[Mapping[str, str]], arm: str | None = None) -> tuple[str, ...]:
    """結果表中某實驗組的方法代碼（依第一次出現的順序，即執行時的階梯順序）。"""
    return tuple(dict.fromkeys(m for v in _variants(rows, arm) for m in v.by_method))


def is_test_row(row: Mapping[str, str]) -> bool:
    """結果列是否屬於鎖定的測試集（規則同 ``ManifestItem.is_test``）。"""
    return row["split"].lower() == TEST_SPLIT or is_test_split(row["image"])


def _check_methods(variants: Sequence[_Variant], methods: Sequence[str]) -> None:
    """每個變體都必須有這些方法的結果，否則丟 ``ValueError``。"""
    for v in variants:
        missing = [m for m in methods if m not in v.by_method]
        if missing:
            raise ValueError(f"{v.row['id']} 沒有方法 {missing} 的結果")


def simulate_ladder(
    rows: Sequence[Mapping[str, str]],
    order: Sequence[str],
    *,
    arm: str | None = None,
    min_agree: int = 1,
    name: str = "",
) -> list[dict[str, Any]]:
    """由結果表離線計算依 ``order`` 逐步升級的結果，每個變體一列。

    輸出欄位同 ``results.csv``（``RESULT_COLUMNS`` 後接標籤欄），``arm`` 欄為 ``name``
    （省略時以 ``>`` 串接方法代碼）；``success_rung``／``first_rung`` 為方法代碼。
    ``order`` 中任一方法不在結果表時丟 ``ValueError``。
    """
    if not order:
        raise ValueError("order 不得為空")
    if min_agree < 1:
        raise ValueError(f"min_agree 至少為 1，收到 {min_agree}")
    variants = _variants(rows, arm)
    _check_methods(variants, order)
    label = name or ">".join(order)
    return [_result_row(v, _ladder(v, order, min_agree), order, label) for v in variants]


def _result_row(
    v: _Variant, res: _LadderOutcome, order: Sequence[str], label: str, extra_ms: float = 0.0
) -> dict[str, Any]:
    """一個變體依 ``order`` 逐步升級的結果列（欄位同 ``RESULT_COLUMNS``，後接標籤欄）。

    ``extra_ms`` 加到耗時（例如自適應策略的品質量測）。
    """
    tags = {k: val for k, val in v.row.items() if k not in METHOD_COLUMNS}
    return {
        # 欄位順序同 RESULT_COLUMNS
        "id": v.row["id"],
        "image": v.row["image"],
        "arm": label,
        "truth": v.truth,
        "split": v.row["split"],
        "outcome": res.outcome.value,
        "success_rung": "" if res.index is None else order[res.index],
        "success_index": "" if res.index is None else res.index,
        "first_rung": res.first,
        "attempts": res.tried,
        "elapsed_ms": f"{res.elapsed_ms + extra_ms:.3f}",
        "decoded": "|".join(text for _, text in res.hits),
        "formats": "|".join(fmt for fmt, _ in res.hits),
        "rejected": res.rejected,
        "error": res.error,
        **tags,
    }


def method_arms(rows: Sequence[Mapping[str, str]]) -> list[dict[str, str]]:
    """把結果表的每個方法當成一個「實驗組」，供 ``summarize`` 產生單一方法比較表。

    ``arm`` 欄改為方法代碼；結果表有多個實驗組時為 ``實驗組:方法``（例如 ``p1_full_pyzbar:raw``）。
    ``attempts`` 為 1（略過的方法為 0）。
    """
    multi = len({r["arm"] for r in rows}) > 1
    return [
        {
            **r,
            "arm": f"{r['arm']}:{r['method']}" if multi else r["method"],
            "attempts": "0" if r.get("skipped") == "1" else "1",
        }
        for r in rows
    ]


@dataclass(frozen=True)
class GreedyCriteria:
    """貪婪法的停止與篩選準則（設計 6.5 節；正式實驗前寫定）。

    ``start`` 為固定的開頭步驟（預設 A0，即原圖）；每一步只考慮新增的誤讀＋負樣本誤報
    不超過 ``max_new_wrong`` 的方法，且加入後的平均耗時（每個變體，含負樣本）不超過
    ``max_mean_ms``（``None`` 為不限）；救回的樣本少於 ``min_gain`` 時停止。
    """

    start: tuple[str, ...] = (Rung.RAW.value,)
    min_gain: int = 1
    max_new_wrong: int = 0
    max_mean_ms: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "start", tuple(self.start))
        if not self.start:
            raise ValueError("start 至少要有一個方法")
        if self.min_gain < 1 or self.max_new_wrong < 0:
            raise ValueError("須滿足 min_gain ≥ 1、max_new_wrong ≥ 0")
        if self.max_mean_ms is not None and self.max_mean_ms <= 0:
            raise ValueError("max_mean_ms 須大於 0")


@dataclass(frozen=True)
class GreedyStep:
    """貪婪法的一步：加入 ``method`` 的邊際貢獻與加入後的累計結果。

    ``rescued``／``new_misread``／``new_false_positive`` 為這一步新增的正確、誤讀、誤報數
    （第一步相對於「什麼都不做」）；``correct`` 等為加入後的累計數，``mean_ms`` 為每個變體的
    平均耗時。
    """

    method: str
    rescued: int
    new_misread: int
    new_false_positive: int
    correct: int
    misread: int
    missed: int
    positives: int
    false_positive: int
    negatives: int
    mean_ms: float

    @property
    def rate(self) -> float | None:
        """累計成功率（正確／正樣本數）；沒有正樣本時為 ``None``。"""
        return self.correct / self.positives if self.positives else None


@dataclass(frozen=True)
class GreedyResult:
    """``greedy_ladder`` 的結果。``excluded`` 為因任一方法 error 而排除的變體數。

    ``stop`` 為停止原因：``min_gain``（救回數低於下限）、``constraints``（剩下的方法都會增加
    誤讀或超過耗時上限）、``exhausted``（所有方法都已加入）。
    """

    steps: tuple[GreedyStep, ...]
    excluded: int
    stop: str

    @property
    def order(self) -> tuple[str, ...]:
        """選出的方法順序（含開頭步驟）。"""
        return tuple(s.method for s in self.steps)


def greedy_ladder(
    rows: Sequence[Mapping[str, str]],
    criteria: GreedyCriteria = GreedyCriteria(),
    *,
    arm: str | None = None,
    candidates: Sequence[str] | None = None,
    min_agree: int = 1,
) -> GreedyResult:
    """以貪婪法選擇逐步升級的步驟與順序（設計 6.5 節）。

    從 ``criteria.start`` 開始，每一步在尚未加入的 ``candidates``（省略時為結果表中的所有方法）
    中，選擇救回最多「目前仍未讀到的正樣本」的方法加到最後；救回數相同時選平均耗時較低者，
    再相同時依 ``candidates`` 的順序。任一方法為 error 的變體不納入。
    只能用 dev 的結果表選擇（規則 7）：含測試集的列時丟 ``SplitLockedError``。
    """
    variants = _variants(rows, arm)
    if any(is_test_row(v.row) for v in variants):
        raise SplitLockedError("貪婪選擇只能用 dev 的結果，結果表含測試集（規則 7）")
    pool = list(candidates) if candidates is not None else list(methods_in(rows, arm))
    _check_methods(variants, [*criteria.start, *pool])
    valid = [v for v in variants if not v.has_error]
    if not valid:
        raise ValueError("沒有可計算的變體（全部有 error）")
    n = len(valid)

    def step(
        method: str, before: Sequence[_LadderOutcome], after: Sequence[_LadderOutcome]
    ) -> GreedyStep:
        """由加入前後各變體的結果計算一步的邊際貢獻與累計結果。"""

        def gained(outcome: Outcome) -> int:
            """這一步由其他判定變成 ``outcome`` 的變體數。"""
            return sum(
                a.outcome is outcome and b.outcome is not outcome
                for b, a in zip(before, after, strict=True)
            )

        c = Counter(a.outcome for a in after)
        return GreedyStep(
            method=method,
            rescued=gained(Outcome.CORRECT),
            new_misread=gained(Outcome.MISREAD),
            new_false_positive=gained(Outcome.FALSE_POSITIVE),
            correct=c[Outcome.CORRECT],
            misread=c[Outcome.MISREAD],
            missed=c[Outcome.MISSED],
            positives=sum(1 for v in valid if v.truth),
            false_positive=c[Outcome.FALSE_POSITIVE],
            negatives=sum(1 for v in valid if not v.truth),
            mean_ms=sum(a.elapsed_ms for a in after) / n,
        )

    # 什麼都不做：正樣本全部未讀到、負樣本全部正確拒絕、耗時 0
    nothing = [
        _LadderOutcome(Outcome.MISSED if v.truth else Outcome.TRUE_NEGATIVE, 0, 0.0) for v in valid
    ]
    order: list[str] = []
    state = nothing
    steps: list[GreedyStep] = []
    for method in criteria.start:
        order.append(method)
        new = [_ladder(v, order, min_agree) for v in valid]
        steps.append(step(method, state, new))
        state = new

    remaining = [m for m in pool if m not in order]
    stop = "exhausted"
    while remaining:
        best: tuple[GreedyStep, list[_LadderOutcome]] | None = None
        for method in remaining:
            trial = order + [method]
            # 已有結果的變體在新方法之前就停止，只需重算仍未決定的變體
            new = [
                s if s.outcome not in _UNDECIDED else _ladder(v, trial, min_agree)
                for v, s in zip(valid, state, strict=True)
            ]
            cand = step(method, state, new)
            if cand.new_misread + cand.new_false_positive > criteria.max_new_wrong:
                continue
            if criteria.max_mean_ms is not None and cand.mean_ms > criteria.max_mean_ms:
                continue
            if best is None or (cand.rescued, -cand.mean_ms) > (best[0].rescued, -best[0].mean_ms):
                best = (cand, new)
        if best is None:
            stop = "constraints"
            break
        if best[0].rescued < criteria.min_gain:
            stop = "min_gain"
            break
        steps.append(best[0])
        order.append(best[0].method)
        remaining.remove(best[0].method)
        state = best[1]
    return GreedyResult(tuple(steps), len(variants) - n, stop)


def pipeline_vs_parts(
    rows: Sequence[Mapping[str, str]], arm: str | None = None
) -> list[dict[str, Any]]:
    """每條疊加流程與其所含步驟的單一方法比較（研究假設 H3：方法之間會互相干擾）。

    每條流程一列：``pipeline``、``rate``（流程的成功率）、``best_part``（所含步驟中成功率最高的
    單一方法；並列時取流程中較前者）、``best_rate``、``diff``（流程 − 最佳單一方法）、
    ``misread``／``best_misread``（誤讀數）。所含步驟沒有單獨執行時 ``best_part`` 為空字串、
    ``best_rate``／``diff`` 為 ``None``。成功率以正樣本為分母、排除 error（同 ``summarize``）。
    """
    if arm is not None:
        rows = [r for r in rows if r["arm"] == arm]
    elif len({r["arm"] for r in rows}) > 1:
        raise ValueError("結果表有多個實驗組，請指定 arm")
    stats = {s["arm"]: s for s in summarize(method_arms(rows))}
    out: list[dict[str, Any]] = []
    prefix = f"{Rung.PIPELINE.value}@"
    for name, s in stats.items():
        if not name.startswith(prefix):
            continue
        # 帶參數的步驟（multiscale:0.5）對應的單一方法代碼為 multiscale@0.5
        parts = [
            p
            for p in (s.replace(":", "@", 1) for s in name[len(prefix) :].split("+"))
            if p in stats and stats[p]["rate"] is not None
        ]
        best = max(parts, key=lambda p: stats[p]["rate"], default="")
        out.append(
            {
                "pipeline": name,
                "rate": s["rate"],
                "misread": s["misread"],
                "best_part": best,
                "best_rate": stats[best]["rate"] if best else None,
                "best_misread": stats[best]["misread"] if best else None,
                "diff": s["rate"] - stats[best]["rate"] if best and s["rate"] is not None else None,
            }
        )
    return out


def pipeline_table(comparison: Sequence[Mapping[str, Any]]) -> str:
    """把 ``pipeline_vs_parts`` 的結果排成 Markdown 表格。"""
    head = ["疊加流程", "成功率", "誤讀", "最佳單一步驟", "成功率", "誤讀", "差異"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for c in comparison:
        rate = "—" if c["rate"] is None else f"{c['rate']:.1%}"
        if c["best_part"]:
            best = [c["best_part"], f"{c['best_rate']:.1%}", str(c["best_misread"])]
        else:
            best = ["—", "—", "—"]
        diff = "—" if c["diff"] is None else f"{c['diff']:+.1%}"
        lines.append(
            "| " + " | ".join([c["pipeline"], rate, str(c["misread"]), *best, diff]) + " |"
        )
    return "\n".join(lines)


# ---- 報告 ----

_STOP_TEXT = {
    "min_gain": "下一步救回的樣本少於下限",
    "constraints": "剩下的方法都會增加誤讀／誤報或超過耗時上限",
    "exhausted": "所有方法都已加入",
}


def greedy_table(result: GreedyResult) -> str:
    """把貪婪法的結果排成 Markdown 表格。"""
    head = ["步驟", "方法", "救回", "新增誤讀", "新增誤報", "累計正確", "成功率", "平均耗時 ms"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for i, s in enumerate(result.steps, start=1):
        rate = "—" if s.rate is None else f"{s.rate:.1%}"
        cells = [str(i), s.method, str(s.rescued), str(s.new_misread), str(s.new_false_positive)]
        cells += [f"{s.correct}/{s.positives}", rate, f"{s.mean_ms:.1f}"]
        lines.append("| " + " | ".join(cells) + " |")
    lines += ["", f"停止原因：{_STOP_TEXT[result.stop]}。"]
    if result.excluded:
        lines.append(f"有 {result.excluded} 個變體因 error 未納入。")
    return "\n".join(lines)


def methods_report_markdown(
    meta: Mapping[str, Any],
    rows: Sequence[Mapping[str, str]],
    by: Sequence[str] = (),
    criteria: GreedyCriteria = GreedyCriteria(),
    orders: Mapping[str, Sequence[str]] | None = None,
    *,
    seed: int = 0,
) -> str:
    """「每個方法都執行」的 Markdown 摘要。

    每個實驗組：單一方法比較表（相對原圖的救回／退步與 McNemar；依各標籤分組另列）、
    貪婪選擇的步驟，以及開頭步驟（``start``）、設定的階梯順序（``configured``）、貪婪選出的順序
    （``greedy``）與 ``orders`` 中各順序的離線比較（McNemar 以第一個順序為基準）。
    結果表含測試集時不做貪婪選擇（規則 7），以 ``orders`` 評估在 dev 上選定的順序。
    有多個實驗組時另列各引擎不做前處理的結果（階段零）。
    逐步升級的 ``min_agree`` 取自 ``run.json`` 中各實驗組的設定。
    逐步升級比較另以原始樣本為單位列出（``compare_by_source``，``seed`` 為隨機種子）。
    """
    lines = meta_lines(meta, "E1 每個方法都執行")
    lines += [
        "",
        "> 信賴區間與 McNemar 以變體為單位計算，變體不獨立時會過窄（ADR 0005 第 4 點），"
        "僅供探索；正式結論以原始樣本為單位分析。",
    ]
    arm_cfg = {str(a["name"]): a for a in meta.get("arms", ())}
    arms = list(dict.fromkeys(r["arm"] for r in rows))
    raw = Rung.RAW.value
    if len(arms) > 1:
        engines = [r for r in method_arms(rows) if r["method"] == raw]
        lines += ["", "## 引擎比較（皆不做前處理）", "", summary_table(summarize(engines), ())]
    for arm in arms:
        sub = [r for r in rows if r["arm"] == arm]
        methods = methods_in(sub)
        baseline = raw if raw in methods else None
        per_method = method_arms(sub)
        lines += [
            "",
            f"## {arm}：單一方法",
            "",
            summary_table(summarize(per_method, (), baseline), ()),
        ]
        skipped = Counter(r["method"] for r in sub if r.get("skipped") == "1")
        if skipped:
            counts = "、".join(f"{m} {n} 次" for m, n in skipped.items())
            lines += [
                "",
                f"> 略過（不送解碼、判為未讀到）：{counts}。例如 deskew 在估計角度小於門檻時略過，"
                "單獨的成功率只反映需要校正的影像，應以逐步升級的結果解讀。",
            ]
        for tag in by:
            table = summary_table(summarize(per_method, (tag,), baseline), (tag,))
            lines += ["", f"### {arm}：依 `{tag}` 分組", "", table]
        pipelines = pipeline_vs_parts(sub)
        if pipelines:
            lines += [
                "",
                f"### {arm}：疊加流程 vs 所含最佳單一步驟（H3）",
                "",
                "差異為負表示疊加後反而不如只做其中一步（方法互相干擾）。",
                "",
                pipeline_table(pipelines),
            ]
        min_agree = int(arm_cfg.get(arm, {}).get("ladder", {}).get("min_agree", 1))
        # 要比較的逐步升級順序：開頭步驟（基準）、設定的階梯順序、貪婪選出的順序、呼叫端指定的順序
        ladders: dict[str, Sequence[str]] = {}
        if all(m in methods for m in criteria.start):
            ladders["start"] = criteria.start
        ladders["configured"] = methods
        if any(is_test_row(r) for r in sub):
            lines += ["", f"## {arm}：貪婪選擇", "", _TEST_NOTE]
        elif "start" in ladders:
            greedy = greedy_ladder(sub, criteria, min_agree=min_agree)
            title = f"## {arm}：貪婪選擇（min_agree={min_agree}）"
            lines += ["", title, "", greedy_table(greedy)]
            ladders["greedy"] = greedy.order
        ladders.update(orders or {})
        simulated = [
            r
            for name, order in ladders.items()
            for r in simulate_ladder(sub, order, min_agree=min_agree, name=name)
        ]
        lines += ["", f"### {arm}：逐步升級比較（離線計算）", ""]
        lines += [f"- {name}：{' > '.join(order)}" for name, order in ladders.items()]
        first = next(iter(ladders))
        lines += ["", summary_table(summarize(simulated, (), first), ())]
        lines += ["", f"#### {arm}：逐步升級比較 · 以原始樣本為單位", ""]
        lines += source_section(simulated, first, None, seed)
    errors = sum(1 for r in rows if r["outcome"] == Outcome.ERROR)
    if errors:
        lines += ["", f"> 有 {errors} 筆 error（讀檔或處理失敗），未計入成功率；見 methods.csv。"]
    return "\n".join(lines) + "\n"
