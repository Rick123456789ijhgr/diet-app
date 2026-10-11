"""產生 E1 的合成資料（影像＋manifest），讓 run.py 不必等真實照片就能端到端跑通。

    python make_synthetic.py                      # 寫到 ./synthetic/（已 gitignore）
    python make_synthetic.py --codes 1 --out DIR  # 最小資料集

合成資料只用來驗證腳本與觀察趨勢，結論必須以真實照片（DVC）重跑。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dietai.synthetic import write_barcode_dataset

HERE = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--out", type=Path, default=HERE / "synthetic", help="輸出資料夾")
    p.add_argument("--codes", type=int, default=4, help="不同條碼的數量（每個條碼產生所有退化）")
    p.add_argument("--seed", type=int, default=0, help="隨機種子（條碼內容、雜訊）")
    p.add_argument("--module-px", type=int, default=3, help="條碼模組寬（像素）")
    p.add_argument("--no-negatives", action="store_true", help="不加入沒有條碼的負樣本")
    args = p.parse_args(argv)

    manifest = write_barcode_dataset(
        args.out, args.codes, args.seed, args.module_px, negatives=not args.no_negatives
    )
    n = sum(1 for _ in manifest.open(encoding="utf-8")) - 1
    print(f"已寫出 {n} 張影像與 manifest：{manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
