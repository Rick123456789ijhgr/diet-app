"""產生 E2 的合成資料：透視變形的英文營養標示＋真值 JSON＋manifest（只供演練流程）。

    python make_synthetic.py                      # → synthetic/（gitignore）
    python make_synthetic.py --out tmp --n 8 --strength 0.25

合成標示為英文（OpenCV 無法繪製中文），不代表真實營養標示；正式結論以真實照片為準。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dietai.synthetic import write_label_dataset

HERE = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    """解析參數並寫出合成資料；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--out", type=Path, default=HERE / "synthetic", help="輸出資料夾")
    p.add_argument("--n", type=int, default=6, help="影像數")
    p.add_argument("--seed", type=int, default=0, help="隨機種子")
    p.add_argument("--strength", type=float, default=0.15, help="透視變形強度（0–0.3）")
    args = p.parse_args(argv)
    try:
        manifest = write_label_dataset(args.out, args.n, args.seed, args.strength)
    except ValueError as e:
        p.error(str(e))
    print(f"已寫出 {args.n} 張合成營養標示與 manifest：{manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
