"""以原始樣本為單位切分 dev／test，把照片搬進 splits/ 並寫出來源 manifest（ADR 0005 第 2 點）。

    python make_sources.py ../../data/e1/incoming/o_a01 ../../data/e1/incoming/f_a01 \\
        --test o_a01=0.5                       # 預覽
    python make_sources.py ... --test o_a01=0.5 --apply   # 確認無誤後才真的搬
    python make_sources.py --undo                          # 依 split_moves.csv 搬回原處

（在 ai/.venv 環境中執行；從專案根目錄可用 ai\\.venv\\Scripts\\python 加上本檔的路徑。）

照片須已依規則命名（<類別>_<批次>_<序號>_<條碼>，見 name_images.py），檔名中的條碼即真值。
同一條碼的照片一定分在同一邊；--test 指定各批次分到 test 的比例，未列出的批次全部是 dev。
搬到 <根目錄>/splits/<split>/<類別>_<批次>/，
寫出 <根目錄>/sources.csv（即 make_variants.py 的 --sources）。
**切分後不要再改種子或比例重切**：test 一旦看過結果就不再是乾淨的測試集。
邏輯在 dietai.evaluation.splits。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dietai.evaluation import splits

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "data" / "e1"


def main(argv: list[str] | None = None) -> int:
    """解析參數並執行；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("folders", nargs="*", type=Path, help="照片資料夾（不含子資料夾）")
    p.add_argument(
        "--test", default="", help="各批次分到 test 的比例，例如 o_a01=0.5（未列出的全部 dev）"
    )
    p.add_argument("--seed", type=int, default=0, help="隨機種子（預設 0）")
    p.add_argument(
        "--root", type=Path, default=DEFAULT_ROOT, help=f"資料根目錄（預設 {DEFAULT_ROOT}）"
    )
    p.add_argument("--apply", action="store_true", help="真的搬檔案並寫出 manifest（預設只預覽）")
    p.add_argument("--undo", action="store_true", help="依 split_moves.csv 把照片搬回原處")
    args = p.parse_args(argv)

    if args.undo:
        restored, problems = splits.undo_split(args.root)
        for msg in problems:
            print(f"  {msg}")
        print(f"已搬回 {restored} 張照片。")
        return 1 if problems else 0
    if not args.folders:
        p.error("請指定照片資料夾")

    try:
        plan = splits.plan_split(
            splits.list_images(args.folders), splits.parse_fractions(args.test), seed=args.seed
        )
    except (OSError, ValueError) as e:
        p.error(str(e))

    print(f"{'批次':<8}{'dev 張數':>10}{'dev 組數':>10}{'test 張數':>10}{'test 組數':>10}")
    for row in splits.summarize(plan):
        print(
            f"{row['label']!s:<10}{row['dev']!s:>10}{row['dev_groups']!s:>10}"
            f"{row['test']!s:>10}{row['test_groups']!s:>10}"
        )
    dups = sorted({a.group for a in plan if sum(b.group == a.group for b in plan) > 1})
    if dups:
        print(f"同一條碼多張（整組同一邊）：{len(dups)} 組")
        for g in dups:
            members = [a for a in plan if a.group == g]
            print(f"  {g} → {members[0].split}：{', '.join(a.path.name for a in members)}")

    if not args.apply:
        problems = splits.check_destinations(args.root, plan)
        for msg in problems:
            print(f"  {msg}")
        print(f"（預覽）將搬到 {args.root / 'splits'}；確認無誤後加 --apply。")
        return 1 if problems else 0
    try:
        manifest = splits.apply_split(args.root, plan)
    except OSError as e:  # 含 FileExistsError
        p.error(str(e))
    print(f"已搬移 {len(plan)} 張照片，來源 manifest：{manifest}")
    print(f"搬移紀錄：{args.root / 'split_moves.csv'}（要還原用 --undo）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
