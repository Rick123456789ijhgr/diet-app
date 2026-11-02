"""E1 規則式自適應策略的離線評估（設計 6.7 節、階段四；ADR 0005 後續 6）。

「每個方法都執行」的結果表（``methods.csv``）已有每個變體 × 每個方法的結果，各方法都從原圖獨立處理，
因此只要再量測每張影像的品質（``features.csv``），任何自適應策略的結果都能離線算出：

- ``measure_manifest``：量測 manifest 中每張影像的品質特徵（``preprocess.features``）。
- ``simulate_adaptive``：依 ``AdaptivePolicy.plan`` 為每個變體排出順序，再以與 ``simulate_ladder``
  相同的規則逐步升級；開頭步驟（原圖）失敗才量測品質，量測耗時只在這時加入。
- ``tune_policy``：在 dev 上以座標搜尋調整各規則門檻（候選值為 dev 量測值的分位數）；
  含測試集時丟 ``SplitLockedError``（根目錄規則 7）。
- ``feature_bins``、``gate_confusion``：依量測值分組的成功率、品質檢查門檻的誤報與漏報
  （設計 6.7 節）。
- ``adaptive_report_markdown``：與指定順序（例如貪婪選出的逐步升級）比較（H4）。
"""

from __future__ import annotations

import csv
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from dietai.evaluation.barcode import (
    Outcome,
    meta_lines,
    source_section,
    summarize,
    summary_table,
)
from dietai.evaluation.manifest import Manifest, SplitLockedError, read_image
from dietai.evaluation.methods import (
    _check_methods,
    _ladder,
    _LadderOutcome,
    _result_row,
    _Variant,
    _variants,
    is_test_row,
    simulate_ladder,
)
from dietai.preprocess.adaptive import AdaptivePolicy, Rule, rule_coverage
from dietai.preprocess.config import QualityConfig
from dietai.preprocess.features import FEATURE_NAMES, measure_features

FEATURES_FILE = "features.csv"
FEATURE_COLUMNS = ("id", *FEATURE_NAMES, "measure_ms")
# 調整門檻時的候選分位數（dev 量測值的 5%、10%、…、95%）
DEFAULT_QUANTILES: tuple[float, ...] = tuple(i / 20 for i in range(1, 20))

Features = Mapping[str, Mapping[str, float]]  # 影像 id → 量測值


# ---------------------------------------------------------------- 量測


def measure_manifest(
    manifest: Manifest,
    cfg: QualityConfig = QualityConfig(),
    *,
    ids: Sequence[str] | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> dict[str, dict[str, float]]:
    """量測 manifest 每張影像（或只量 ``ids``）的品質特徵；讀不到的影像略過。"""
    wanted = set(ids) if ids is not None else None
    items = [it for it in manifest.items if wanted is None or it.id in wanted]
    out: dict[str, dict[str, float]] = {}
    for i, item in enumerate(items, start=1):
        try:
            img = read_image(item.image)
        except (OSError, ValueError):
            continue
        out[item.id] = measure_features(img, cfg).as_dict()
        if progress is not None:
            progress(i, len(items))
    return out


def write_features(path: str | Path, features: Features) -> Path:
    """寫出 ``features.csv``（每張影像一列）。"""
    path = Path(path)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FEATURE_COLUMNS)
        writer.writeheader()
        for image_id, values in features.items():
            writer.writerow({"id": image_id, **{k: values[k] for k in FEATURE_COLUMNS[1:]}})
    return path


def read_features(path: str | Path) -> dict[str, dict[str, float]]:
    """讀取 ``features.csv``；缺欄位時丟 ``ValueError``。"""
    with Path(path).open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in FEATURE_COLUMNS if c not in (reader.fieldnames or ())]
        if missing:
            raise ValueError(f"{path} 缺少欄位 {missing}")
        return {r["id"]: {k: float(r[k]) for k in FEATURE_COLUMNS[1:]} for r in reader}


# ---------------------------------------------------------------- 模擬


def _features_of(v: _Variant, features: Features) -> Mapping[str, float]:
    try:
        return features[v.row["id"]]
    except KeyError:
        raise ValueError(f"{v.row['id']} 沒有品質量測值") from None


def _adaptive_outcome(
    v: _Variant, features: Features, policy: AdaptivePolicy, min_agree: int
) -> tuple[tuple[str, ...], _LadderOutcome, float]:
    """一個變體的（順序, 結果, 量測耗時）；開頭步驟就成功時不量測，耗時為 0。"""
    feats = _features_of(v, features)
    order = policy.plan(feats)
    res = _ladder(v, order, min_agree)
    started = res.outcome is not Outcome.ERROR and (
        res.index is None or res.index >= len(policy.start)
    )
    return order, res, float(feats["measure_ms"]) if started else 0.0


def simulate_adaptive(
    rows: Sequence[Mapping[str, str]],
    features: Features,
    policy: AdaptivePolicy,
    *,
    arm: str | None = None,
    min_agree: int = 1,
    name: str = "",
) -> list[dict[str, Any]]:
    """由結果表與量測值離線計算自適應策略的結果，每個變體一列。

    欄位同 ``simulate_ladder``，另加 ``plan``（該變體的嘗試順序，以 ``>`` 串接）與 ``rules``
    （成立的規則編號，以 ``|`` 串接）；``elapsed_ms`` 含品質量測耗時（開頭步驟失敗時）。
    """
    variants = _variants(rows, arm)
    _check_methods(variants, policy.methods())
    label = name or policy.name or "adaptive"
    out = []
    for v in variants:
        order, res, measure_ms = _adaptive_outcome(v, features, policy, min_agree)
        row = _result_row(v, res, order, label, measure_ms)
        feats = _features_of(v, features)
        row["plan"] = ">".join(order)
        row["rules"] = "|".join(str(i) for i, r in enumerate(policy.rules) if r.applies(feats))
        out.append(row)
    return out


@dataclass(frozen=True)
class PolicyScore:
    """策略在一批變體上的計數（排除任一方法為 error 的變體）與每個變體的平均耗時。"""

    correct: int
    misread: int
    missed: int
    false_positive: int
    positives: int
    negatives: int
    mean_ms: float

    @property
    def wrong(self) -> int:
        """誤讀＋負樣本誤報。"""
        return self.misread + self.false_positive

    @property
    def rate(self) -> float | None:
        """成功率（正確／正樣本數）。"""
        return self.correct / self.positives if self.positives else None


def score_policy(
    rows: Sequence[Mapping[str, str]],
    features: Features,
    policy: AdaptivePolicy,
    *,
    arm: str | None = None,
    min_agree: int = 1,
) -> PolicyScore:
    """策略的計數與平均耗時（含量測）。"""
    variants = [v for v in _variants(rows, arm) if not v.has_error]
    _check_methods(variants, policy.methods())
    return _score(variants, features, policy, min_agree)


def _score(
    variants: Sequence[_Variant], features: Features, policy: AdaptivePolicy, min_agree: int
) -> PolicyScore:
    c: Counter[Outcome] = Counter()
    total_ms = 0.0
    for v in variants:
        _, res, measure_ms = _adaptive_outcome(v, features, policy, min_agree)
        c[res.outcome] += 1
        total_ms += res.elapsed_ms + measure_ms
    return PolicyScore(
        correct=c[Outcome.CORRECT],
        misread=c[Outcome.MISREAD],
        missed=c[Outcome.MISSED],
        false_positive=c[Outcome.FALSE_POSITIVE],
        positives=sum(1 for v in variants if v.truth),
        negatives=sum(1 for v in variants if not v.truth),
        mean_ms=total_ms / len(variants) if variants else 0.0,
    )


# ---------------------------------------------------------------- 調整門檻（只用 dev）


@dataclass(frozen=True)
class TuneStep:
    """座標搜尋的一次門檻變更：第 ``rule`` 條規則由 ``before`` 改為 ``after`` 後的分數。"""

    round: int
    rule: int
    feature: str
    before: float
    after: float
    score: PolicyScore


@dataclass(frozen=True)
class TuneResult:
    """``tune_policy`` 的結果：調整後的策略、起始與最終分數、每次變更。"""

    policy: AdaptivePolicy
    initial: PolicyScore
    final: PolicyScore
    steps: tuple[TuneStep, ...]
    max_wrong: int


def tune_policy(
    rows: Sequence[Mapping[str, str]],
    features: Features,
    policy: AdaptivePolicy,
    *,
    max_wrong: int | None = None,
    rounds: int = 2,
    quantiles: Sequence[float] = DEFAULT_QUANTILES,
    arm: str | None = None,
    min_agree: int = 1,
) -> TuneResult:
    """在 dev 上以座標搜尋調整各規則的門檻（設計 6.7 節：門檻只依 dev 調整）。

    每一輪依序對每條規則，在「dev 量測值的分位數＋目前門檻」中選分數最好的門檻：
    誤讀＋誤報不超過 ``max_wrong``（省略時為起始策略的數量，即不得變差）的前提下正確數最多，
    再來誤讀＋誤報較少、平均耗時較短，最後選離原門檻最近者（保守）。沒有改善時保留原門檻。
    結果表含測試集時丟 ``SplitLockedError``（規則 7）。
    """
    if rounds < 1:
        raise ValueError(f"rounds 至少為 1，收到 {rounds}")
    variants = _variants(rows, arm)
    if any(is_test_row(v.row) for v in variants):
        raise SplitLockedError("門檻只能用 dev 的結果調整，結果表含測試集（規則 7）")
    _check_methods(variants, policy.methods())
    valid = [v for v in variants if not v.has_error]
    if not valid:
        raise ValueError("沒有可計算的變體（全部有 error）")

    initial = _score(valid, features, policy, min_agree)
    limit = initial.wrong if max_wrong is None else max_wrong

    def key(score: PolicyScore, threshold: float, original: float) -> tuple[float, ...]:
        feasible = score.wrong <= limit
        return (feasible, score.correct, -score.wrong, -score.mean_ms, -abs(threshold - original))

    steps: list[TuneStep] = []
    current = policy
    best = initial
    for rnd in range(1, rounds + 1):
        changed = False
        for i, rule in enumerate(current.rules):
            values = [float(_features_of(v, features)[rule.feature]) for v in valid]
            candidates = sorted({*np.quantile(values, quantiles).tolist(), rule.threshold})
            scored = [
                (_score(valid, features, current.with_threshold(i, t), min_agree), t)
                for t in candidates
            ]
            score, threshold = max(scored, key=lambda st: key(st[0], st[1], rule.threshold))
            if threshold != rule.threshold and key(score, threshold, threshold) > key(
                best, rule.threshold, rule.threshold
            ):
                current = current.with_threshold(i, threshold)
                best = score
                changed = True
                steps.append(TuneStep(rnd, i, rule.feature, rule.threshold, threshold, score))
        if not changed:
            break
    return TuneResult(current, initial, best, tuple(steps), limit)


# ---------------------------------------------------------------- 品質檢查門檻


def feature_bins(
    rows: Sequence[Mapping[str, str]],
    features: Features,
    feature: str,
    methods: Sequence[str],
    *,
    bins: int = 4,
    arm: str | None = None,
) -> list[dict[str, Any]]:
    """依 ``feature`` 的分位數把正樣本分成 ``bins`` 組，列出各組中每個方法的成功率。

    用來觀察「成功率開始下滑」的量測值範圍（設計 6.7 節：品質檢查門檻）。
    """
    if feature not in FEATURE_NAMES:
        raise ValueError(f"未知的量測值 {feature!r}")
    variants = [v for v in _variants(rows, arm) if v.truth and not v.has_error]
    _check_methods(variants, methods)
    if not variants:
        return []
    values = np.array([float(_features_of(v, features)[feature]) for v in variants])
    edges = np.quantile(values, np.linspace(0, 1, bins + 1))
    out = []
    for b in range(bins):
        lo, hi = float(edges[b]), float(edges[b + 1])
        last = b == bins - 1
        members = [
            v
            for v, x in zip(variants, values, strict=True)
            if lo <= x and (x <= hi if last else x < hi)
        ]
        row: dict[str, Any] = {"bin": b, "low": lo, "high": hi, "n": len(members)}
        for m in methods:
            ok = sum(v.by_method[m]["outcome"] == Outcome.CORRECT for v in members)
            row[m] = ok / len(members) if members else None
        out.append(row)
    return out


def gate_confusion(
    sim_rows: Sequence[Mapping[str, Any]], features: Features, gate: Rule
) -> dict[str, Any]:
    """品質檢查（``gate`` 成立即判為「品質不佳」）對某策略結果的誤報與漏報（只計正樣本）。

    誤報：判為品質不佳但策略讀對；漏報：判為品質良好但策略沒讀對（設計 6.7 節）。
    ``gate.methods`` 不使用。
    """
    tp = fa = miss = ok = 0
    for r in sim_rows:
        if not r["truth"] or r["outcome"] == Outcome.ERROR:
            continue
        flagged = gate.applies(features[str(r["id"])])
        correct = r["outcome"] == Outcome.CORRECT
        if flagged and not correct:
            tp += 1
        elif flagged:
            fa += 1
        elif correct:
            ok += 1
        else:
            miss += 1
    n = tp + fa + miss + ok
    return {
        "gate": f"{gate.feature} {gate.op} {gate.threshold:g}",
        "n": n,
        "flagged_wrong": tp,
        "false_alarm": fa,
        "miss": miss,
        "passed_correct": ok,
        "false_alarm_rate": fa / n if n else None,
        "miss_rate": miss / n if n else None,
    }


# ---------------------------------------------------------------- 報告


def _ms_table(rows: Sequence[Mapping[str, Any]]) -> list[str]:
    """各策略每個變體的平均耗時與平均嘗試次數（H4 比較的是總處理時間）。"""
    by: dict[str, list[Mapping[str, Any]]] = {}
    for r in rows:
        by.setdefault(str(r["arm"]), []).append(r)
    lines = ["| 策略 | n | 平均耗時 ms | 總耗時 s | 平均嘗試次數 |", "|---|---|---|---|---|"]
    for name, rs in by.items():
        ms = [float(r["elapsed_ms"]) for r in rs]
        tries = [int(r["attempts"]) for r in rs]
        lines.append(
            f"| {name} | {len(rs)} | {np.mean(ms):.1f} | {sum(ms) / 1000:.2f} "
            f"| {np.mean(tries):.2f} |"
        )
    return lines


def adaptive_report_markdown(
    meta: Mapping[str, Any],
    rows: Sequence[Mapping[str, str]],
    features: Features,
    policy: AdaptivePolicy,
    orders: Mapping[str, Sequence[str]],
    by: Sequence[str] = (),
    *,
    arm: str | None = None,
    min_agree: int = 1,
    tuned: TuneResult | None = None,
    gates: Sequence[Rule] = (),
    seed: int = 0,
) -> str:
    """自適應策略與 ``orders``（名稱 → 順序；第一個為比較基準，例如貪婪選出的逐步升級）的比較。

    ``gates`` 為要評估的品質檢查門檻，對自適應策略的結果計算誤報與漏報。
    """
    label = policy.name or "adaptive"
    sim = simulate_adaptive(rows, features, policy, arm=arm, min_agree=min_agree, name=label)
    compared: list[Mapping[str, Any]] = [
        *(
            r
            for name, order in orders.items()
            for r in simulate_ladder(rows, order, arm=arm, min_agree=min_agree, name=name)
        ),
        *sim,
    ]
    baseline = next(iter(orders), None)
    str_rows = [{k: str(v) for k, v in r.items()} for r in compared]
    lines = meta_lines(meta, f"E1 自適應策略 {label}")
    lines += [f"- 策略：{policy.description or label}；開頭 `{'>'.join(policy.start)}`，"]
    lines[-1] += f"候補 `{'>'.join(policy.fallback) or '—'}`，最多 {policy.max_attempts} 次"
    for name, order in orders.items():
        lines.append(f"- `{name}`：`{'>'.join(order)}`")
    lines += ["", "## 規則", "", "| # | 規則 | 成立 | 比例 |", "|---|---|---|---|"]
    feats = [_features_of(v, features) for v in _variants(rows, arm)]
    for c in rule_coverage(policy, feats):
        rate = "—" if c["rate"] is None else f"{c['rate']:.1%}"
        lines.append(f"| {c['rule']} | `{c['describe']}` | {c['hits']} | {rate} |")
    lines += ["", "## 整體 · Overall", "", summary_table(summarize(str_rows, (), baseline), ())]
    lines += ["", "## 耗時", "", *_ms_table(compared)]
    if by:
        lines += [
            "",
            f"## 依 {', '.join(f'`{b}`' for b in by)} 分組",
            "",
            summary_table(summarize(str_rows, by, baseline), by),
        ]
    if baseline is not None:
        lines += ["", "## 以原始樣本為單位", ""]
        lines += source_section(str_rows, baseline, label, seed)
    plans = Counter(str(r["plan"]) for r in sim)
    lines += ["", "## 嘗試順序分布", "", "| 順序 | 變體數 |", "|---|---|"]
    lines += [f"| `{p}` | {n} |" for p, n in plans.most_common(10)]
    if gates:
        lines += ["", "## 品質檢查門檻（正樣本）", ""]
        lines += [
            "| 門檻（成立即判為品質不佳） | n | 判不佳且讀錯 | 誤報 | 漏報 | 誤報率 | 漏報率 |",
            "|---|---|---|---|---|---|---|",
        ]
        for gate in gates:
            g = gate_confusion(sim, features, gate)
            fa = "—" if g["false_alarm_rate"] is None else f"{g['false_alarm_rate']:.1%}"
            miss = "—" if g["miss_rate"] is None else f"{g['miss_rate']:.1%}"
            lines.append(
                f"| `{g['gate']}` | {g['n']} | {g['flagged_wrong']} | {g['false_alarm']} "
                f"| {g['miss']} | {fa} | {miss} |"
            )
    if tuned is not None:
        lines += ["", "## 門檻調整（dev）", ""]
        lines.append(
            f"誤讀＋誤報上限 {tuned.max_wrong}；"
            f"正確 {tuned.initial.correct} → {tuned.final.correct}，"
            f"誤讀＋誤報 {tuned.initial.wrong} → {tuned.final.wrong}，"
            f"平均耗時 {tuned.initial.mean_ms:.1f} → {tuned.final.mean_ms:.1f} ms"
        )
        if tuned.steps:
            lines += ["", "| 輪 | 規則 | 量測值 | 原門檻 | 新門檻 | 正確 | 誤讀＋誤報 |"]
            lines.append("|---|---|---|---|---|---|---|")
            for s in tuned.steps:
                lines.append(
                    f"| {s.round} | {s.rule} | {s.feature} | {s.before:g} | {s.after:g} "
                    f"| {s.score.correct} | {s.score.wrong} |"
                )
    lines += [
        "",
        "> 自適應策略先試開頭步驟，失敗才量測品質；耗時含量測。H4：成功率不低於基準"
        "（差距在預先設定的容許範圍內）且總耗時較短。",
    ]
    return "\n".join(lines) + "\n"
