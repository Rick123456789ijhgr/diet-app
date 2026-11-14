"""把「檔名就是條碼」的實驗照片批次改成規則化檔名：<類別>_<批次>_<序號>_<條碼>。

    python name_images.py <資料夾> --category f --batch a01             # 預覽
    python name_images.py <資料夾> --category f --batch a01 --apply     # 確認無誤後才真的改名
    python name_images.py <資料夾> --undo                                 # 依紀錄還原

（在 ai/.venv 環境中執行；從專案根目錄可用 ai\\.venv\\Scripts\\python 加上本檔的路徑。）

  4710088410108.jpg、4710088410108_2.jpg  →  f_a01_001_4710088410108.jpg
  沒有條碼_IMG_1234.jpg                    →  f_a01_002_nocode.jpg

類別建議用一個字母：f＝食物包裝、o＝其他物品（書、用品等），兩類規則相同、檔名長度一致。
類別、批次只用小寫英數字與連字號；序號預設 3 位補零，--start 自訂起始號碼，依修改時間
（通常即拍攝順序）編號，--order name 改依原檔名。同類別批次已有的序號不重複使用，新照片
接在後面。看不出條碼的檔名預設略過，--include-unknown 時只編號不帶條碼。
找最佳流程會把規則化檔名中的條碼直接當作人工確認的真值。

預設只預覽；不覆寫既有檔案；每筆改名記在資料夾的 _rename_log.csv，--undo 依相反順序還原
紀錄中的全部改名。邏輯在 dietai.devtools.image_naming，命名規則在 dietai.evaluation.image_names。
"""

from __future__ import annotations

import argparse
import sys

from dietai.devtools import image_naming as naming
from dietai.devtools.images import PathNotFoundError, SplitLockedError
from dietai.evaluation.image_names import NO_CODE

STATUS_TEXT = {"rename": "改名", "same": "不變", "skip": "略過"}


def main(argv: list[str] | None = None) -> int:
    """解析參數並執行；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("folder", help="照片所在的資料夾（不含子資料夾）")
    p.add_argument("--category", default="", help="類別，例如 f（食物包裝）、o（其他物品）")
    p.add_argument("--batch", default="", help="批次，例如 a01、a02")
    p.add_argument("--start", type=int, default=0, help="第一個序號（預設接在既有的最大序號之後）")
    p.add_argument("--width", type=int, default=3, help="序號位數（3–6，預設 3：001）")
    p.add_argument(
        "--order",
        choices=("mtime", "name"),
        default="mtime",
        help="編號順序：mtime＝修改時間（預設，通常即拍攝順序）、name＝原檔名",
    )
    p.add_argument(
        "--no-code",
        default=NO_CODE,
        help="沒有條碼時寫在條碼欄的標記（小寫字母，預設 nocode）",
    )
    p.add_argument(
        "--include-unknown", action="store_true", help="看不出條碼的檔名也編號（不帶條碼）"
    )
    p.add_argument("--apply", action="store_true", help="真的改名（預設只顯示預覽）")
    p.add_argument("--undo", action="store_true", help="依 _rename_log.csv 還原先前的改名")
    args = p.parse_args(argv)

    try:
        if args.undo:
            restored, problems = naming.undo(args.folder)
            for msg in problems:
                print(f"  {msg}")
            print(f"已還原 {restored} 個檔案。")
            return 1 if problems else 0
        if not args.category or not args.batch:
            p.error("請指定 --category 與 --batch")
        planned = naming.plan(
            args.folder,
            args.category,
            args.batch,
            start=args.start,
            width=args.width,
            order=args.order,
            include_unknown=args.include_unknown,
            no_code=args.no_code,
        )
        for r in planned:
            status = STATUS_TEXT[r.status]
            if r.status == "rename" and r.dst:
                print(f"  {status}  {r.src.name}  →  {r.dst.name}")
            elif r.status == "skip":
                print(f"  {status}  {r.src.name}（{r.note}）")
        counts = {s: sum(1 for r in planned if r.status == s) for s in STATUS_TEXT}
        print("\n" + "、".join(f"{STATUS_TEXT[s]} {n}" for s, n in counts.items() if n))
        todo = counts["rename"]
        if not args.apply:
            print(f"預覽：{todo} 個檔案會改名。確認無誤後加上 --apply 執行。")
            return 0
        done = naming.apply(args.folder, planned)
        print(f"已改名 {done} 個檔案；紀錄在資料夾的 {naming.LOG_FILE}，可用 --undo 還原。")
        return 0 if done == todo else 1
    except (OSError, ValueError, PathNotFoundError, SplitLockedError) as e:
        p.error(str(e))


if __name__ == "__main__":
    sys.exit(main())
