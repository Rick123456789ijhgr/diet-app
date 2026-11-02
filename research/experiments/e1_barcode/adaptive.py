"""E1 規則式自適應策略（ADR 0005 後續 6、設計 6.7 節）：由「每個方法都執行」的結果離線評估。

    python adaptive.py                      # 最新一次 run_methods.py 的結果、預設策略
    python adaptive.py runs/<資料夾> --policy configs/adaptive/r0_default.json --tune
    python adaptive.py runs/<資料夾> --gate "blur<100" --gate "contrast<60" --by condition
    python adaptive.py runs/<資料夾> --order frozen=raw,deskew,multiscale@2   # 測試集用凍結的順序

第一次執行時量測每張影像的品質，寫到 <執行資料夾>/features.csv（之後沿用）。
比較基準預設為在同一份結果上貪婪選出的逐步升級（`greedy`）；結果含測試集時不做貪婪選擇與門檻調整
（規則 7），須以 --order 與凍結的策略檔評估。
--tune 在 dev 上調整門檻，調整後的策略寫到 <執行資料夾>/policy_<名稱>_tuned.json（含調整紀錄）；
要沿用就把它複製到 configs/adaptive/ 並改名，不覆寫原檔。
寫出 summary_adaptive_<名稱>.md、adaptive_<名稱>.csv（每個變體一列）與 feature_bins.csv。
處理與統計全部在 dietai，這裡只解析參數與寫檔。
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

from dietai.evaluation import (
    FEATURES_FILE,
    GreedyCriteria,
    adaptive_report_markdown,
    feature_bins,
    greedy_ladder,
    grouping_columns,
    is_test_row,
    list_method_runs,
    measure_manifest,
    methods_in,
    read_features,
    read_manifest,
    read_methods,
    simulate_adaptive,
    tune_policy,
    write_features,
)
from dietai.preprocess import FEATURE_NAMES, Rule, load_policy, save_policy

HERE = Path(__file__).resolve().parent
DEFAULT_POLICY = HERE / "configs" / "adaptive" / "r0_default.json"
_GATE = re.compile(r"^\s*(\w+)\s*([<>])\s*([-+0-9.eE]+)\s*$")


def _write_csv(path: Path, rows: Sequence[Mapping[str, Any]]) -> None:
    """寫成 CSV（BOM，Excel 直接開啟不亂碼）；欄位取所有列的鍵，沒有任何列時不寫檔。"""
    if not rows:
        return
    fields = list(dict.fromkeys(k for r in rows for k in r))
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _orders(values: Sequence[str]) -> dict[str, list[str]]:
    """解析 ``--order 名稱=方法,方法,…``（可重複）。"""
    out: dict[str, list[str]] = {}
    for v in values:
        name, sep, methods = v.partition("=")
        order = [m.strip() for m in methods.split(",") if m.strip()]
        if not sep or not name.strip() or not order:
            raise ValueError(f"--order 格式為 名稱=方法,方法,…，收到 {v!r}")
        out[name.strip()] = order
    return out


def _gates(values: Sequence[str]) -> list[Rule]:
    """解析 ``--gate 量測值<門檻``（可重複）；``methods`` 不使用。"""
    gates = []
    for v in values:
        m = _GATE.match(v)
        if not m:
            raise ValueError(f"--gate 格式為 量測值<門檻 或 量測值>門檻，收到 {v!r}")
        gates.append(Rule(m[1], m[2], float(m[3]), ("gate",)))
    return gates


def main(argv: list[str] | None = None) -> int:
    """解析參數、評估自適應策略並寫出報告；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("run_dir", type=Path, nargs="?", help="執行資料夾（省略時取 runs/ 中最新的）")
    p.add_argument("--policy", type=Path, default=DEFAULT_POLICY, help="策略檔（JSON）")
    p.add_argument("--arm", default=None, help="結果表的實驗組（只有一組時可省略）")
    p.add_argument("--by", default=None, help="分組的標籤欄（逗號分隔）；省略時用所有標籤欄")
    p.add_argument("--tune", action="store_true", help="在 dev 上調整門檻（含測試集時拒絕）")
    p.add_argument(
        "--max-wrong", type=int, default=None, help="調整時誤讀＋誤報上限（預設不得變差）"
    )
    p.add_argument("--remeasure", action="store_true", help="重新量測品質（覆寫 features.csv）")
    p.add_argument(
        "--order", action="append", default=[], help="比較的順序：名稱=方法,方法,…（可重複）"
    )
    p.add_argument(
        "--gate", action="append", default=[], help="評估的品質檢查門檻，例如 blur<100（可重複）"
    )
    p.add_argument("--seed", type=int, default=0, help="bootstrap 亂數種子")
    args = p.parse_args(argv)

    run_dir = args.run_dir
    if run_dir is None:
        runs = list_method_runs(HERE / "runs")
        if not runs:
            p.error("runs/ 中沒有「每個方法都執行」的結果，請先執行 run_methods.py")
        run_dir = runs[0]
    try:
        meta, rows = read_methods(run_dir)
        policy = load_policy(args.policy)
        orders = _orders(args.order)
        gates = _gates(args.gate)
    except (OSError, ValueError) as e:
        p.error(f"讀不到執行結果、策略檔或參數錯誤：{e}")
    if not rows:
        p.error(f"{run_dir} 沒有任何結果列")
    arms = list(dict.fromkeys(r["arm"] for r in rows))
    arm = args.arm or (arms[0] if len(arms) == 1 else None)
    if arm not in arms:
        p.error(f"請以 --arm 指定實驗組；可用：{arms}")
    rows = [r for r in rows if r["arm"] == arm]
    min_agree = next(
        (int(a["ladder"].get("min_agree", 1)) for a in meta["arms"] if a["name"] == arm), 1
    )
    tags = list(meta["manifest"]["tag_columns"])
    by = (
        list(grouping_columns(tags))
        if args.by is None
        else [s.strip() for s in args.by.split(",") if s.strip()]
    )
    unknown = [b for b in by if b not in tags]
    if unknown:
        p.error(f"沒有這些標籤欄：{unknown}；可用：{tags}")
    tested = any(is_test_row(r) for r in rows)

    feat_path = Path(run_dir) / FEATURES_FILE
    if feat_path.is_file() and not args.remeasure:
        features = read_features(feat_path)
    else:
        try:
            manifest = read_manifest(meta["manifest"]["path"], include_test=tested)
        except (OSError, ValueError) as e:
            p.error(f"讀不到 manifest（量測品質需要原始影像）：{e}")
        ids = list(dict.fromkeys(r["id"] for r in rows))
        print(f"量測 {len(ids)} 張影像的品質 → {feat_path}")
        features = measure_manifest(manifest, ids=ids)
        write_features(feat_path, features)

    tuned = None
    try:
        if args.tune:
            if tested:
                p.error("結果含測試集，不能調整門檻（規則 7）；請在 dev 的結果上調整")
            tuned = tune_policy(
                rows, features, policy, max_wrong=args.max_wrong, arm=arm, min_agree=min_agree
            )
            policy = replace(tuned.policy, name=f"{policy.name}_tuned")
            record = {
                "tuned_from": str(args.policy),
                "tuned_on": str(run_dir),
                "max_wrong": tuned.max_wrong,
                "steps": [
                    {
                        "round": s.round,
                        "rule": s.rule,
                        "feature": s.feature,
                        "before": s.before,
                        "after": s.after,
                        "correct": s.score.correct,
                        "wrong": s.score.wrong,
                    }
                    for s in tuned.steps
                ],
            }
            out = save_policy(policy, Path(run_dir) / f"policy_{policy.name}.json", record)
            print(f"調整後的策略：{out}")
        if not orders and not tested:
            start = tuple(m for m in ("raw",) if m in methods_in(rows))
            if start:
                greedy = greedy_ladder(rows, GreedyCriteria(start=start), min_agree=min_agree)
                orders = {"greedy": list(greedy.order)}
        report = adaptive_report_markdown(
            meta,
            rows,
            features,
            policy,
            orders,
            by,
            arm=arm,
            min_agree=min_agree,
            tuned=tuned,
            gates=gates,
            seed=args.seed,
        )
        sim = simulate_adaptive(rows, features, policy, arm=arm, min_agree=min_agree)
        bins = [
            {"feature": f, **b}
            for f in FEATURE_NAMES
            for b in feature_bins(rows, features, f, policy.methods(), arm=arm)
        ]
    except ValueError as e:  # 策略用到結果表沒有的方法、缺量測值等
        p.error(str(e))
    _write_csv(Path(run_dir) / f"adaptive_{policy.name}.csv", sim)
    _write_csv(Path(run_dir) / "feature_bins.csv", bins)
    (Path(run_dir) / f"summary_adaptive_{policy.name}.md").write_text(report, encoding="utf-8")
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
