"""依工作台「找最佳流程」確認過的真值，把原始照片改名成條碼號碼。

    python rename_by_truth.py <執行> --folder <照片資料夾>            # 預覽
    python rename_by_truth.py <執行> --folder <照片資料夾> --apply    # 確認無誤後才真的改名
    python rename_by_truth.py <執行> --undo                           # 依紀錄還原

（在 ai/.venv 環境中執行；從專案根目錄可用 ai\\.venv\\Scripts\\python 加上本檔的路徑。）

<執行> 為執行資料夾的路徑，或預設結果資料夾（runs/）下的名稱，例如 20261110-001313_bestflow。
上傳來源的執行要用 --folder 指定照片所在的資料夾（以檔名對應）；資料夾來源的執行直接改原檔。
有條碼 → <號碼>.jpg（同號碼多張加 _2）；沒有條碼 → 沒有條碼_<原檔名>。
預設只改人工確認過的；程式自動推定的加 --include-auto 才改；真值未定的不改。
不覆寫既有檔案；每筆改名記在執行資料夾的 rename_log.csv。邏輯在 dietai.devtools.rename_by_truth。
"""

from __future__ import annotations

import argparse
import sys

from dietai.devtools import rename_by_truth as rbt
from dietai.devtools.images import PathNotFoundError, SplitLockedError
from dietai.devtools.scenes import SceneError

STATUS_TEXT = {
    "rename": "改名",
    "same": "已正確",
    "undecided": "略過",
    "missing": "找不到",
    "ambiguous": "無法對應",
}


def main(argv: list[str] | None = None) -> int:
    """解析參數並執行；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("run", help="找最佳流程的執行資料夾（路徑或名稱）")
    p.add_argument("--folder", default="", help="照片所在的資料夾（上傳來源的執行必填）")
    p.add_argument("--recursive", action="store_true", help="在 --folder 的子資料夾中也找同名檔案")
    p.add_argument(
        "--include-auto", action="store_true", help="程式自動推定的真值也改（預設只改人工確認的）"
    )
    p.add_argument("--apply", action="store_true", help="真的改名（預設只顯示預覽）")
    p.add_argument("--undo", action="store_true", help="依 rename_log.csv 還原先前的改名")
    args = p.parse_args(argv)

    try:
        if args.undo:
            restored, problems = rbt.undo(args.run)
            for msg in problems:
                print(f"  {msg}")
            print(f"已還原 {restored} 個檔案。")
            return 1 if problems else 0
        renames = rbt.plan(
            args.run, args.folder or None, recursive=args.recursive, include_auto=args.include_auto
        )
        for r in renames:
            status = STATUS_TEXT.get(r.status, r.status)
            if r.status == "rename" and r.src and r.dst:
                print(f"  {status:　<4} {r.src}  →  {r.dst.name}")
            elif r.status == "same" and r.src:
                print(f"  {status:　<4} {r.src}")
            else:
                print(f"  {status:　<4} {r.id}（{r.note}）")
        todo = sum(1 for r in renames if r.status == "rename")
        if not args.apply:
            print(f"\n預覽：{todo} 個檔案會改名。確認無誤後加上 --apply 執行。")
            return 0
        done = rbt.apply(args.run, renames)
        print(f"\n已改名 {done} 個檔案；紀錄在執行資料夾的 {rbt.LOG_FILE}，可用 --undo 還原。")
        return 0 if done == todo else 1
    except (OSError, ValueError, SceneError, PathNotFoundError, SplitLockedError) as e:
        p.error(str(e))


if __name__ == "__main__":
    sys.exit(main())
