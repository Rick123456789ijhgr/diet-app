"""E1 條碼前處理消融：對 manifest 的每張影像執行 configs/ 中的每個實驗組。

    python run.py --manifest synthetic/manifest.csv
    python run.py --manifest ../../data/e1/manifest.csv --only a0_raw,a6_full --label pilot
    python run.py --manifest ... --include-test --label final   # 正式實驗才可讀測試集

輸出到 runs/<時間>_<label>/：results.csv、attempts.csv、run.json（實驗紀錄）與 summary.md。
處理與判定全部在 dietai.evaluation，這裡只解析參數。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dietai.evaluation import (
    load_arms,
    new_run_dir,
    read_manifest,
    read_run,
    report_markdown,
    run_experiment,
)

# 以腳本所在資料夾為基準，--configs、--out 的預設值不受工作目錄影響
HERE = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    """解析參數並執行一次 E1；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--manifest", type=Path, required=True, help="manifest CSV 路徑")
    p.add_argument("--configs", type=Path, default=HERE / "configs", help="實驗組設定資料夾")
    p.add_argument("--only", default="", help="只跑這些實驗組（逗號分隔，依此順序）")
    p.add_argument("--out", type=Path, default=HERE / "runs", help="執行結果的上層資料夾")
    p.add_argument("--label", default="", help="執行名稱，加在資料夾名稱後")
    p.add_argument(
        "--include-test", action="store_true", help="納入測試集（只限正式實驗，會記錄在 run.json）"
    )
    args = p.parse_args(argv)

    only = [s.strip() for s in args.only.split(",") if s.strip()]
    # 測試集鎖定（根目錄 CLAUDE.md 規則 7）：未加 --include-test 時 read_manifest 排除
    # split=test 或路徑含 splits/test 的列；manifest 本身位於 splits/test 時丟
    # SplitLockedError（ValueError 的子類別），與設定錯誤一樣由 p.error 回報
    try:
        arms = load_arms(args.configs, only)
        manifest = read_manifest(args.manifest, include_test=args.include_test)
    except (OSError, ValueError) as e:
        p.error(str(e))
    if manifest.excluded_test:
        print(f"測試集已鎖定：排除 {manifest.excluded_test} 張（正式實驗請加 --include-test）")
    if not manifest.items:
        p.error("manifest 沒有可執行的影像")
    # 只決定路徑（runs/<時間>_<label>/），資料夾由 run_experiment 建立
    out = new_run_dir(args.out, args.label)
    total = len(manifest.items) * len(arms)
    print(f"{len(manifest.items)} 張影像 × {len(arms)} 個實驗組 = {total} 次 → {out}")

    def progress(done: int, total: int) -> None:
        """每 50 次與最後一次印出進度。"""
        if done % 50 == 0 or done == total:
            print(f"  {done}/{total}", flush=True)

    # include_test 再傳一次：run_experiment 會二次檢查 manifest 不含測試集列，
    # 並把這個旗標寫進 run.json，事後可辨認哪些執行讀過測試集
    # 執行前的檢查（標籤欄與結果欄同名、輸出資料夾非空等）丟 ValueError，以 p.error 回報；
    # 單張影像的讀取或處理錯誤由 run_experiment 記成 error 列，不會丟到這裡
    try:
        summary = run_experiment(
            manifest,
            arms,
            out,
            include_test=args.include_test,
            progress=progress,
            label=args.label,
        )
    except (OSError, ValueError) as e:
        p.error(str(e))
    # 從剛寫出的檔案重新讀回再產生摘要，與 analyze.py 走同一條路徑；
    # 依所有標籤欄分組，以第一個實驗組為 McNemar 基準
    meta, rows = read_run(out)
    report = report_markdown(meta, rows, tuple(meta["manifest"]["tag_columns"]), arms[0].name)
    (out / "summary.md").write_text(report, encoding="utf-8")
    print(f"完成（{summary.duration_s:.1f} 秒）：{dict(summary.counts)}")
    print(f"摘要：{out / 'summary.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
