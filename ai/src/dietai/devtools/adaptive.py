"""E1 規則式自適應策略的工作台功能：把「每個方法都執行」的一次執行整理成自適應頁要顯示的 JSON。

所有統計（模擬、成功率、信賴區間、規則成立比例、依量測值分組的成功率）一律由
``dietai.evaluation`` 計算；這裡只挑欄位與組合。品質量測值讀自執行資料夾的 ``features.csv``
（由 ``e1_barcode/adaptive.py`` 寫入）；沒有時回傳 ``features_ready: false``，不在讀取時量測。
由 ``e1.run_json`` 在資料夾為「每個方法都執行」時呼叫，路徑已經過測試集鎖定（``e1.resolve_run``）。
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from dietai.evaluation import (
    FEATURES_FILE,
    GreedyCriteria,
    feature_bins,
    greedy_ladder,
    grouping_columns,
    is_test_row,
    methods_in,
    read_features,
    read_methods,
    simulate_adaptive,
    simulate_ladder,
    summarize,
)
from dietai.evaluation.adaptive import Features
from dietai.preprocess import FEATURE_NAMES, AdaptivePolicy, load_policy
from dietai.preprocess.adaptive import rule_coverage

# ai/src/dietai/devtools/adaptive.py → 專案根目錄
POLICY_DIR = (
    Path(__file__).resolve().parents[4] / "research/experiments/e1_barcode/configs/adaptive"
)
BASELINE = "greedy"
# 「各影像」表最多附上幾列（大型執行的回應不致過大）
MAX_VARIANTS = 3000


def is_methods_run(folder: Path) -> bool:
    """是否為「每個方法都執行」的資料夾（有 ``methods.csv``、沒有逐步升級的 ``results.csv``）。"""
    return (folder / "methods.csv").is_file() and not (folder / "results.csv").is_file()


def _policies(folder: Path) -> list[tuple[str, AdaptivePolicy]]:
    """可用的策略：``configs/adaptive/*.json``（來源 ``config``），再來執行資料夾內調整後的
    ``policy_*.json``（來源 ``run``）。讀不到或格式錯的檔案略過。"""
    out: list[tuple[str, AdaptivePolicy]] = []
    for source, paths in (
        ("config", sorted(POLICY_DIR.glob("*.json"))),
        ("run", sorted(folder.glob("policy_*.json"))),
    ):
        for path in paths:
            try:
                out.append((source, load_policy(path)))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
    return out


def _timing(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """各策略每個變體的平均耗時、總耗時與平均嘗試次數（含負樣本）。"""
    by: dict[str, list[Mapping[str, Any]]] = {}
    for r in rows:
        by.setdefault(str(r["arm"]), []).append(r)
    return [
        {
            "arm": name,
            "n": len(rs),
            "mean_ms": float(np.mean([float(r["elapsed_ms"]) for r in rs])),
            "total_s": sum(float(r["elapsed_ms"]) for r in rs) / 1000,
            "mean_attempts": float(np.mean([int(r["attempts"]) for r in rs])),
        }
        for name, rs in by.items()
    ]


def _policy_json(
    source: str,
    policy: AdaptivePolicy,
    rows: Sequence[Mapping[str, str]],
    features: Features,
    orders: Mapping[str, Sequence[str]],
    min_agree: int,
    tags: Sequence[str],
) -> dict[str, Any]:
    """一個策略在一個實驗組上的結果；策略用到結果表沒有的方法時只回傳 ``error``。"""
    head: dict[str, Any] = {"source": source, **policy.to_dict()}
    try:
        sim = simulate_adaptive(rows, features, policy, min_agree=min_agree)
    except ValueError as e:
        return {**head, "error": str(e)}
    compared = [
        *(
            r
            for name, order in orders.items()
            for r in simulate_ladder(rows, order, min_agree=min_agree, name=name)
        ),
        *sim,
    ]
    str_rows = [{k: str(v) for k, v in r.items()} for r in compared]
    baseline = next(iter(orders), None)
    feats = [features[r["id"]] for r in sim]
    coverage = rule_coverage(policy, feats)
    rules = [
        {**rule, "hits": c["hits"], "rate": c["rate"]}
        for rule, c in zip(head["rules"], coverage, strict=True)
    ]
    plans = Counter(str(r["plan"]) for r in sim)
    variants = [
        {
            **{
                k: r[k]
                for k in (
                    "id",
                    "image",
                    "truth",
                    "outcome",
                    "success_rung",
                    "plan",
                    "rules",
                    "attempts",
                )
            },
            "elapsed_ms": float(r["elapsed_ms"]),
            **{t: r.get(t, "") for t in tags},
            **{f: features[r["id"]][f] for f in FEATURE_NAMES},
        }
        for r in sim[:MAX_VARIANTS]
    ]
    return {
        **head,
        "rules": rules,
        "overall": summarize(str_rows, (), baseline),
        "timing": _timing(compared),
        "plans": [{"plan": p, "count": n} for p, n in plans.most_common()],
        "variants": variants,
        "truncated": len(sim) > MAX_VARIANTS,
    }


def _arm_json(
    arm: str,
    rows: Sequence[Mapping[str, str]],
    features: Features,
    policies: Sequence[tuple[str, AdaptivePolicy]],
    min_agree: int,
    tags: Sequence[str],
) -> dict[str, Any]:
    """一個實驗組：基準（貪婪逐步升級，含測試集時沒有）、各策略、依量測值分組的成功率。"""
    methods = list(methods_in(rows))
    orders: dict[str, list[str]] = {}
    if "raw" in methods and not any(is_test_row(r) for r in rows):
        greedy = greedy_ladder(rows, GreedyCriteria(), min_agree=min_agree)
        orders[BASELINE] = list(greedy.order)
    return {
        "arm": arm,
        "methods": methods,
        "baseline": {"name": BASELINE, "order": orders[BASELINE]} if orders else None,
        "policies": [
            _policy_json(source, p, rows, features, orders, min_agree, tags)
            for source, p in policies
        ],
        "bins": {f: feature_bins(rows, features, f, methods) for f in FEATURE_NAMES},
    }


def adaptive_run_json(folder: Path) -> dict[str, Any]:
    """一次「每個方法都執行」的自適應策略結果（各實驗組 × 各策略）；``folder`` 須已解析並檢查。"""
    meta, rows = read_methods(folder)
    manifest = meta.get("manifest", {})
    tags = list(grouping_columns(manifest.get("tag_columns", [])))
    head = {
        "mode": "methods",
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
        "feature_names": list(FEATURE_NAMES),
        "tags": tags,
        "command": f"python research/experiments/e1_barcode/adaptive.py {folder}",
    }
    feat_path = folder / FEATURES_FILE
    if not feat_path.is_file():
        return {**head, "features_ready": False, "arms": []}
    features = read_features(feat_path)
    policies = _policies(folder)
    min_agree = {a["name"]: int(a["ladder"].get("min_agree", 1)) for a in meta.get("arms", ())}
    arms = list(dict.fromkeys(r["arm"] for r in rows))
    return {
        **head,
        "features_ready": True,
        "arms": [
            _arm_json(
                arm,
                [r for r in rows if r["arm"] == arm],
                features,
                policies,
                min_agree.get(arm, 1),
                tags,
            )
            for arm in arms
        ],
    }
