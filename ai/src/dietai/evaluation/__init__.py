"""實驗評測：manifest 讀取、批次執行、判定與統計彙整（研究腳本與工作台共用）。

處理邏輯一律呼叫 ``dietai.preprocess`` 等套件，這裡只負責「跑哪些設定、怎麼判對錯、
怎麼記錄與彙整」。測試集鎖定（根目錄 CLAUDE.md 規則 7）由 ``read_manifest`` 執行。
需要 ``vision`` extra（讀取影像與解碼）。
"""

# E1 條碼消融：實驗組設定、單張判定、批次執行、讀取與彙整報告
from dietai.evaluation.barcode import (
    Arm,
    Outcome,
    RunSummary,
    evaluate,
    first_rung,
    judge,
    list_runs,
    load_arm,
    load_arms,
    new_run_dir,
    read_run,
    report_markdown,
    rescue_counts,
    run_experiment,
    summarize,
)

# manifest 讀寫與測試集鎖定、影像讀寫（支援中文路徑）
from dietai.evaluation.manifest import (
    Manifest,
    ManifestItem,
    SplitLockedError,
    is_test_split,
    read_image,
    read_manifest,
    write_image,
    write_manifest,
)

# 統計：Wilson 信賴區間、McNemar 精確檢定與其配對計數
from dietai.evaluation.stats import mcnemar_exact, paired_counts, wilson_interval

__all__ = [
    "Arm",
    "Manifest",
    "ManifestItem",
    "Outcome",
    "RunSummary",
    "SplitLockedError",
    "evaluate",
    "is_test_split",
    "judge",
    "list_runs",
    "load_arm",
    "load_arms",
    "mcnemar_exact",
    "new_run_dir",
    "paired_counts",
    "read_image",
    "read_manifest",
    "read_run",
    "report_markdown",
    "first_rung",
    "rescue_counts",
    "run_experiment",
    "summarize",
    "wilson_interval",
    "write_image",
    "write_manifest",
]
