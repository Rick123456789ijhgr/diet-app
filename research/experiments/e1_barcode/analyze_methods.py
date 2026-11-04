"""E1「每個方法都執行」的分析：單一方法比較、貪婪選擇與逐步升級的離線比較（ADR 0005）。

    python analyze_methods.py                                   # 最新一次 run_methods.py 的結果
    python analyze_methods.py runs/<資料夾> --by condition --min-gain 2 --max-new-wrong 0
    python analyze_methods.py runs/<資料夾> --order frozen=raw,sharpen,multiscale@2   # 評估指定順序
    python analyze_methods.py runs/<資料夾> --glmm condition    # 加上混合效果邏輯迴歸

寫出 summary.md、methods_<實驗組>.csv（單一方法比較）與 greedy_<實驗組>.csv（貪婪選擇各步），
並印出 Markdown。
貪婪選擇只在 dev 上進行；結果含測試集時只評估 --order 指定的順序（規則 7）。
統計與選擇全部在 dietai.evaluation，這裡只解析參數與寫檔。
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from dietai.evaluation import (
    GreedyCriteria,
    greedy_ladder,
    grouping_columns,
    is_test_row,
    list_method_runs,
    method_arms,
    methods_in,
    methods_report_markdown,
    mixed_logit_from_rows,
    mixed_logit_table,
    read_methods,
    summarize,
)

HERE = Path(__file__).resolve().parent


def _write_csv(path: Path, rows: Sequence[Mapping[str, Any]]) -> None:
    """把彙整列寫成 CSV；欄位順序取第一列的鍵，沒有任何列時不寫檔。"""
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as f:  # BOM：Excel 直接開啟不亂碼
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
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


def main(argv: list[str] | None = None) -> int:
    """解析參數、讀取一次執行結果並寫出分析；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("run_dir", type=Path, nargs="?", help="執行資料夾（省略時取 runs/ 中最新的）")
    p.add_argument("--by", default=None, help="分組的標籤欄（逗號分隔）；省略時用所有標籤欄")
    p.add_argument("--start", default="raw", help="貪婪法固定的開頭步驟（逗號分隔，預設 raw）")
    p.add_argument("--min-gain", type=int, default=1, help="新增一步至少要救回的樣本數")
    p.add_argument("--max-new-wrong", type=int, default=0, help="新增一步容許增加的誤讀＋誤報數")
    p.add_argument("--max-mean-ms", type=float, default=None, help="每個變體平均耗時上限（ms）")
    p.add_argument(
        "--order", action="append", default=[], help="另外評估的順序：名稱=方法,方法,…（可重複）"
    )
    p.add_argument(
        "--glmm",
        default=None,
        help="加上混合效果邏輯迴歸：固定效果為方法與這些標籤欄（逗號分隔，可為空字串），"
        "原始樣本為隨機截距；方法以 raw、標籤以第一個值（condition 為 clean）為基準",
    )
    args = p.parse_args(argv)

    run_dir = args.run_dir
    if run_dir is None:
        runs = list_method_runs(HERE / "runs")
        if not runs:
            p.error("runs/ 中沒有「每個方法都執行」的結果，請先執行 run_methods.py")
        run_dir = runs[0]
    try:
        meta, rows = read_methods(run_dir)
        tags = list(meta["manifest"]["tag_columns"])
        criteria = GreedyCriteria(
            start=tuple(s.strip() for s in args.start.split(",") if s.strip()),
            min_gain=args.min_gain,
            max_new_wrong=args.max_new_wrong,
            max_mean_ms=args.max_mean_ms,
        )
        orders = _orders(args.order)
    except (OSError, ValueError) as e:  # JSONDecodeError、SplitLockedError 皆為 ValueError
        p.error(f"讀不到執行結果或參數錯誤：{e}")
    except (KeyError, TypeError) as e:
        p.error(f"{run_dir / 'run.json'} 格式不符（缺少或錯誤的欄位 {e}）")
    if not rows:
        p.error(f"{run_dir} 沒有任何結果列")
    by = (
        list(grouping_columns(tags))
        if args.by is None
        else [s.strip() for s in args.by.split(",") if s.strip()]
    )
    unknown = [b for b in by if b not in tags]
    if unknown:
        p.error(f"沒有這些標籤欄：{unknown}；可用：{tags}")
    glmm = None if args.glmm is None else [s.strip() for s in args.glmm.split(",") if s.strip()]
    unknown = [b for b in glmm or [] if b not in tags]
    if unknown:
        p.error(f"--glmm 沒有這些標籤欄：{unknown}；可用：{tags}")

    try:
        report = methods_report_markdown(meta, rows, by, criteria, orders)
    except ValueError as e:  # 例如 --order 或 --start 含結果表沒有的方法
        p.error(str(e))
    min_agree = {a["name"]: int(a["ladder"].get("min_agree", 1)) for a in meta["arms"]}
    tested = any(is_test_row(r) for r in rows)
    for arm in dict.fromkeys(r["arm"] for r in rows):
        sub = [r for r in rows if r["arm"] == arm]
        baseline = "raw" if "raw" in methods_in(sub) else None
        _write_csv(run_dir / f"methods_{arm}.csv", summarize(method_arms(sub), (), baseline))
        if not tested and all(m in methods_in(sub) for m in criteria.start):
            greedy = greedy_ladder(sub, criteria, min_agree=min_agree.get(arm, 1))
            steps = [{**asdict(s), "rate": s.rate} for s in greedy.steps]
            _write_csv(run_dir / f"greedy_{arm}.csv", steps)
    if glmm is not None:
        report += _glmm_section(rows, glmm)
    (run_dir / "summary.md").write_text(report, encoding="utf-8")
    print(report)
    return 0


def _glmm_section(rows: Sequence[Mapping[str, str]], factors: Sequence[str]) -> str:
    """每個實驗組一張混合效果邏輯迴歸表（固定效果：方法＋``factors``；隨機截距：原始樣本）。"""
    lines = ["", "## 混合效果邏輯迴歸 · Mixed-effects logistic regression", ""]
    lines.append("> 輔助方法（設計 9.1 節）；以勝算比表示，相對於基準方法與基準水準。")
    for arm in dict.fromkeys(r["arm"] for r in rows):
        sub = [r for r in rows if r["arm"] == arm]
        reference = {"method": "raw"} if "raw" in methods_in(sub) else {}
        if "condition" in factors and any(r.get("condition") == "clean" for r in sub):
            reference["condition"] = "clean"
        lines += ["", f"### {arm}", ""]
        try:
            result = mixed_logit_from_rows(sub, ["method", *factors], reference=reference)
        except ValueError as e:  # 例如只有一個原始樣本、設計矩陣不滿秩
            lines.append(f"無法擬合：{e}")
            continue
        lines.append(mixed_logit_table(result))
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
