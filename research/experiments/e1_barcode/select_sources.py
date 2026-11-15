"""挑出可當變體來源的清楚原圖（ADR 0005：變體由品質良好的原圖產生）。

    python make_variants.py --sources ../../data/e1/sources.csv --out ../../data/e1/clean1600 \
        --clean-only
    python run_methods.py --manifest ../../data/e1/clean1600/manifest.csv --only r0_raw
    python select_sources.py runs/<上一步的執行> --out ../../data/e1/variant_sources.csv

（在 ai/.venv 環境中執行。）

標準：縮到 make_variants 的長邊上限後，指定實驗組（預設 r0_raw：不做前處理、zxing-cpp 內建嘗試
關閉、只收零售格式）判為 correct（只讀出真值一個號碼）的原圖。測試集一律不寫出。
輸出檔再交給 make_variants.py --sources。邏輯在 dietai.evaluation.splits.select_sources。
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from dietai.evaluation import splits

DEFAULT_SOURCES = Path(__file__).resolve().parents[2] / "data" / "e1" / "sources.csv"


def main(argv: list[str] | None = None) -> int:
    """解析參數並執行；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("run", type=Path, help="run_methods.py 對 --clean-only 資料集的執行資料夾")
    p.add_argument("--out", type=Path, required=True, help="輸出的來源 manifest（不覆寫）")
    p.add_argument("--sources", type=Path, default=DEFAULT_SOURCES, help="完整的來源 manifest")
    p.add_argument("--arm", default="r0_raw", help="依哪個實驗組挑選（預設 r0_raw）")
    p.add_argument("--method", default="raw", help="依哪個方法挑選（預設 raw）")
    args = p.parse_args(argv)

    try:
        with (args.run / "methods.csv").open(encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
        meta = json.loads((args.run / "run.json").read_text(encoding="utf-8"))
        path, kept, total = splits.select_sources(
            args.sources, rows, args.out, arm=args.arm, method=args.method
        )
    except (OSError, ValueError) as e:
        p.error(str(e))
    sha = str(meta.get("manifest", {}).get("sha256", ""))[:12]
    print(f"結果表：{args.run}（manifest sha256 {sha}）")
    print(f"保留 {kept}/{total} 張 dev 原圖：{path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
