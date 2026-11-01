"""E2 營養標示 OCR：對 manifest 的每張影像，以每個前處理方法 × 每個 OCR 引擎辨識並評分。

    python run.py --manifest synthetic/manifest.csv
    python run.py --manifest ... --engines tesseract,tesseract:eng --only l0_raw --label stage0
    python run.py --manifest ... --include-test --label final   # 正式實驗才可讀測試集

引擎描述見 dietai.adapters.ocr.make_engine（例如 tesseract:chi_tra+eng:6）；OCR 結果快取在
--cache（預設 .ocr_cache/，gitignore），同一引擎設定對同一張影像只辨識一次。
輸出到 runs/<時間>_<label>/：label_results.csv、run.json 與 summary.md。
處理與評分全部在 dietai，這裡只解析參數。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dietai.adapters.cache import FileCache
from dietai.adapters.ocr import CachedOcr, make_engine
from dietai.evaluation import (
    grouping_columns,
    label_report_markdown,
    load_label_methods,
    new_run_dir,
    read_label_run,
    read_manifest,
    run_label_ocr,
)

HERE = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    """解析參數並執行一次 E2；``argv`` 供測試傳入，省略時讀命令列。"""
    for stream in (sys.stdout, sys.stderr):  # Windows 主控台與管線預設非 UTF-8
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--manifest", type=Path, required=True, help="manifest CSV（truth 為真值 JSON）")
    p.add_argument("--engines", default="tesseract", help="OCR 引擎描述（逗號分隔）")
    p.add_argument("--configs", type=Path, default=HERE / "configs", help="前處理方法設定資料夾")
    p.add_argument("--only", default="", help="只跑這些前處理方法（逗號分隔，依此順序）")
    p.add_argument("--tessdata", type=Path, default=None, help="Tesseract 語言包資料夾")
    p.add_argument("--cache", type=Path, default=HERE / ".ocr_cache", help="OCR 結果快取資料夾")
    p.add_argument("--out", type=Path, default=HERE / "runs", help="執行結果的上層資料夾")
    p.add_argument("--label", default="", help="執行名稱，加在資料夾名稱後")
    p.add_argument(
        "--include-test", action="store_true", help="納入測試集（只限正式實驗，會記錄在 run.json）"
    )
    args = p.parse_args(argv)

    specs = [s.strip() for s in args.engines.split(",") if s.strip()]
    only = [s.strip() for s in args.only.split(",") if s.strip()]
    if not specs:
        p.error("--engines 至少要有一個引擎")
    try:
        methods = load_label_methods(args.configs, only)
        manifest = read_manifest(args.manifest, include_test=args.include_test)
        cache = FileCache(args.cache)
        # 簡稱即命令列上的描述；完整名稱（版本、語言包雜湊）寫進 run.json
        engines = {s: CachedOcr(make_engine(s, args.tessdata), cache) for s in specs}
    except (OSError, ValueError, RuntimeError) as e:  # 含找不到 tesseract 程式
        p.error(str(e))
    if manifest.excluded_test:
        print(f"測試集已鎖定：排除 {manifest.excluded_test} 張（正式實驗請加 --include-test）")
    if not manifest.items:
        p.error("manifest 沒有可執行的影像")
    out = new_run_dir(args.out, args.label)
    print(f"{len(manifest.items)} 張影像 × {len(methods)} 個方法 × {len(engines)} 個引擎 → {out}")

    def progress(done: int, total: int) -> None:
        """每 20 次與最後一次印出進度。"""
        if done % 20 == 0 or done == total:
            print(f"  {done}/{total}", flush=True)

    try:
        summary = run_label_ocr(
            manifest,
            engines,
            out,
            methods=methods,
            include_test=args.include_test,
            progress=progress,
            label=args.label,
        )
    except (OSError, ValueError) as e:
        p.error(str(e))
    meta, rows = read_label_run(out)
    by = grouping_columns(meta["manifest"]["tag_columns"])
    (out / "summary.md").write_text(label_report_markdown(meta, rows, by), encoding="utf-8")
    cached = sum(e.hits for e in engines.values())
    print(f"完成（{summary.duration_s:.1f} 秒，快取命中 {cached} 次）：{dict(summary.counts)}")
    print(f"摘要：{out / 'summary.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
