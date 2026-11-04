"""產生 E3 的合成電子發票（原圖＋劣化變體＋manifest），讓 run.py 不必等真實發票就能端到端跑通。

    python make_synthetic.py                      # 寫到 ./synthetic/（已 gitignore）
    python make_synthetic.py --n 1 --out DIR      # 最小資料集

輸出 sources/（原圖與 sources.csv）與 variants/（變體與 manifest.csv，交給 run.py）。
合成資料只用來驗證腳本與觀察趨勢，結論必須以真實發票重跑。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dietai.synthetic import INVOICE_CONDITIONS, write_invoice_dataset

HERE = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    """解析參數並寫出合成資料集；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--out", type=Path, default=HERE / "synthetic", help="輸出資料夾")
    p.add_argument("--n", type=int, default=4, help="不同發票的數量")
    p.add_argument("--seed", type=int, default=0, help="隨機種子（QR 內容、劣化）")
    p.add_argument("--module-px", type=int, default=4, help="QR 模組寬（像素）")
    p.add_argument(
        "--conditions",
        default=",".join(INVOICE_CONDITIONS),
        help="劣化條件（逗號分隔，見 dietai.synthetic.VARIANT_CONDITIONS）",
    )
    p.add_argument("--no-negatives", action="store_true", help="不加入沒有 QR 的負樣本")
    args = p.parse_args(argv)

    conditions = tuple(s.strip() for s in args.conditions.split(",") if s.strip())
    try:
        manifest = write_invoice_dataset(
            args.out,
            args.n,
            args.seed,
            args.module_px,
            conditions=conditions,
            negatives=not args.no_negatives,
        )
    except (OSError, ValueError) as e:  # 含 FileExistsError
        p.error(str(e))
    n = sum(1 for _ in manifest.open(encoding="utf-8")) - 1
    print(f"已寫出 {n} 張合成發票影像與 manifest：{manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
