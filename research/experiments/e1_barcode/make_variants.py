"""由真實照片產生參數已知的劣化變體與 manifest（半合成資料，ADR 0005 第 1 點）。

    python make_variants.py --sources ../../data/e1/sources.csv --out ../../data/e1/variants
    python make_variants.py --sources ... --out ... --conditions blur,motion,jpeg --max-side 1200
    python make_variants.py --sources ... --out ... --include-test   # 一併產生測試集原圖的變體

來源 manifest 的格式同 run.py（image、truth、split，id 即 source_id），每張原圖都要有 split。
輸出：splits/<split>/<source_id>/<條件>_<等級>.png、
manifest.csv（含 source_id、condition、level、seed）
與 manifest.json（產生參數）。變體跟著原圖的 split；測試集的變體只在正式實驗時使用（規則 7）。
劣化邏輯全部在 dietai.synthetic，這裡只解析參數。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dietai.evaluation import read_manifest
from dietai.synthetic import VARIANT_CONDITIONS, write_variant_dataset


def main(argv: list[str] | None = None) -> int:
    """解析參數並產生變體；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--sources", type=Path, required=True, help="原圖的 manifest CSV")
    p.add_argument("--out", type=Path, required=True, help="輸出資料夾（須不存在或為空）")
    p.add_argument(
        "--conditions",
        default="",
        help=f"劣化條件（逗號分隔，省略時全部）：{','.join(VARIANT_CONDITIONS)}",
    )
    p.add_argument("--seed", type=int, default=0, help="隨機種子（與各原圖的 id 一起決定）")
    p.add_argument(
        "--max-side", type=int, default=1600, help="原圖長邊上限（px），0 為不縮小（預設 1600）"
    )
    p.add_argument(
        "--include-test", action="store_true", help="一併產生測試集原圖的變體（變體仍標為 test）"
    )
    args = p.parse_args(argv)

    conditions = [s.strip() for s in args.conditions.split(",") if s.strip()] or None
    try:
        sources = read_manifest(args.sources, include_test=args.include_test)
        if sources.excluded_test:
            print(f"測試集已鎖定：排除 {sources.excluded_test} 張原圖（要產生請加 --include-test）")
        manifest = write_variant_dataset(
            sources,
            args.out,
            conditions=conditions,
            seed=args.seed,
            max_side=args.max_side or None,
        )
    except (OSError, ValueError) as e:  # 含 SplitLockedError、FileExistsError
        p.error(str(e))
    n = sum(1 for _ in manifest.open(encoding="utf-8")) - 1
    print(f"已寫出 {len(sources.items)} 張原圖的 {n} 張變體與 manifest：{manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
