"""E1 分析：依拍攝條件分組計算各實驗組的成功率（Wilson 95% CI）與相對基準的 McNemar 檢定。

    python analyze.py                          # 最新一次執行，依所有標籤欄分組
    python analyze.py runs/20261012-153000 --by lighting,material --baseline a0_raw

寫出 summary.md 與 summary.csv（整體）、summary_<標籤>.csv（各分組），並印出 Markdown。
統計全部在 dietai.evaluation，這裡只解析參數與寫檔。
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from dietai.evaluation import list_runs, read_run, report_markdown, summarize

# 以腳本所在資料夾為基準，從任何工作目錄執行都找得到 runs/
HERE = Path(__file__).resolve().parent


def _write_csv(path: Path, rows: Sequence[Mapping[str, Any]]) -> None:
    """把彙整列寫成 CSV；欄位順序取第一列的鍵，沒有任何列時不寫檔。"""
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as f:  # BOM：Excel 直接開啟不亂碼
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    """解析參數、讀取一次執行結果並寫出摘要；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("run_dir", type=Path, nargs="?", help="執行資料夾（省略時取 runs/ 中最新的）")
    p.add_argument("--by", default=None, help="分組的標籤欄（逗號分隔）；省略時用所有標籤欄")
    p.add_argument("--baseline", default=None, help="McNemar 檢定的基準實驗組（預設為第一組）")
    args = p.parse_args(argv)

    run_dir = args.run_dir
    if run_dir is None:
        runs = list_runs(HERE / "runs")
        if not runs:
            p.error("runs/ 中沒有任何執行結果，請先執行 run.py")
        run_dir = runs[0]
    # 參數錯誤一律用 p.error：印出用法並以代碼 2 結束，不丟 traceback
    try:
        meta, rows = read_run(run_dir)
    except OSError as e:
        p.error(f"讀不到執行結果：{e}")
    if not rows:
        p.error(f"{run_dir} 沒有任何結果列")
    # 可分組的標籤欄（如 lighting、material）記錄在 run.json，由 manifest 的額外欄位而來
    tags = meta["manifest"]["tag_columns"]
    by = tags if args.by is None else [s.strip() for s in args.by.split(",") if s.strip()]
    unknown = [b for b in by if b not in tags]
    if unknown:
        p.error(f"沒有這些標籤欄：{unknown}；可用：{tags}")
    arm_names = [a["name"] for a in meta["arms"]]
    # 預設基準為第一個實驗組（run.py 依 configs/ 檔名或 --only 的順序）
    baseline = args.baseline or arm_names[0]
    if baseline not in arm_names:
        p.error(f"找不到基準實驗組 {baseline!r}；可用：{arm_names}")

    # 寫回同一個執行資料夾：整體一份，每個分組標籤各一份（只依單一標籤分組，不做交叉）
    _write_csv(run_dir / "summary.csv", summarize(rows, (), baseline))
    for tag in by:
        _write_csv(run_dir / f"summary_{tag}.csv", summarize(rows, (tag,), baseline))
    report = report_markdown(meta, rows, by, baseline)
    (run_dir / "summary.md").write_text(report, encoding="utf-8")
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
