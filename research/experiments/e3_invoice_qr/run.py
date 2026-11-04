"""E3 電子發票 QR（ADR 0005）：每張影像執行實驗組階梯中的所有方法，判定正確／部分／誤讀／未讀到。

    python run.py --manifest synthetic/variants/manifest.csv
    python run.py --manifest ... --only q0_raw,q2_raw_pyzbar --label stage0   # 階段零
    python run.py --manifest ... --include-test --label final                # 正式實驗才可讀測試集

輸出到 runs/<時間>_<label>/：invoice_methods.csv（影像 × 方法結果表）、run.json 與 summary.md
（單一方法比較、各實驗組原順序的逐步升級）。處理與判定全部在 dietai.evaluation，這裡只解析參數。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dietai.evaluation import (
    grouping_columns,
    invoice_report_markdown,
    load_arms,
    new_run_dir,
    read_invoice_methods,
    read_manifest,
    run_invoice_methods,
)

HERE = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    """解析參數並執行一次；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--manifest", type=Path, required=True, help="manifest CSV（truth 為左右 hex）")
    p.add_argument("--configs", type=Path, default=HERE / "configs", help="實驗組設定資料夾")
    p.add_argument(
        "--only",
        default="q0_raw,q1_all_methods",
        help="實驗組（逗號分隔）；方法為各組 ladder.rungs 的每一階",
    )
    p.add_argument("--out", type=Path, default=HERE / "runs", help="執行結果的上層資料夾")
    p.add_argument("--label", default="", help="執行名稱，加在資料夾名稱後")
    p.add_argument(
        "--include-test", action="store_true", help="納入測試集（只限正式實驗，會記錄在 run.json）"
    )
    args = p.parse_args(argv)

    only = [s.strip() for s in args.only.split(",") if s.strip()]
    if not only:
        p.error("--only 至少要有一個實驗組")
    try:
        arms = load_arms(args.configs, only)
        manifest = read_manifest(args.manifest, include_test=args.include_test)
    except (OSError, ValueError) as e:
        p.error(str(e))
    if manifest.excluded_test:
        print(f"測試集已鎖定：排除 {manifest.excluded_test} 張（正式實驗請加 --include-test）")
    if not manifest.items:
        p.error("manifest 沒有可執行的影像")
    out = new_run_dir(args.out, args.label)
    print(f"{len(manifest.items)} 張影像 × {len(arms)} 個實驗組（各執行所有方法）→ {out}")

    def progress(done: int, total: int) -> None:
        """每 50 次與最後一次印出進度。"""
        if done % 50 == 0 or done == total:
            print(f"  {done}/{total}", flush=True)

    try:
        summary = run_invoice_methods(
            manifest,
            arms,
            out,
            include_test=args.include_test,
            progress=progress,
            label=args.label,
        )
    except (OSError, ValueError) as e:
        p.error(str(e))
    meta, rows = read_invoice_methods(out)
    report = invoice_report_markdown(meta, rows, grouping_columns(meta["manifest"]["tag_columns"]))
    (out / "summary.md").write_text(report, encoding="utf-8")
    print(f"完成（{summary.duration_s:.1f} 秒）：{dict(summary.counts)}")
    print(f"摘要：{out / 'summary.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
