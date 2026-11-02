"""實驗評測：manifest 讀取、批次執行（逐步升級、每個方法都執行）、判定與統計彙整。

處理邏輯一律呼叫 ``dietai.preprocess`` 等套件，這裡只負責「跑哪些設定、怎麼判對錯、
怎麼記錄與彙整」。測試集鎖定（根目錄 CLAUDE.md 規則 7）由 ``read_manifest`` 執行。
需要 ``vision`` extra（讀取影像與解碼）。
"""

# E1 條碼消融：實驗組設定、單張判定、批次執行、讀取與彙整報告
from dietai.evaluation.barcode import (
    Arm,
    Outcome,
    RunSummary,
    compare_by_source,
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

# 營養標示：真值格式、欄位完全正確率、定位誤差、CER（ADR 0005 第 8 點）
from dietai.evaluation.label import (
    DEFAULT_QUAD_TOL,
    FieldScore,
    LabelTruth,
    cer,
    load_label_truth,
    located,
    quad_error,
    score_fields,
)

# 營養標示 OCR 的批次評估與彙整
from dietai.evaluation.label_run import (
    label_report_markdown,
    load_label_methods,
    read_label_run,
    run_label_ocr,
    summarize_label,
)

# manifest 讀寫與測試集鎖定、影像讀寫（支援中文路徑）
from dietai.evaluation.manifest import (
    Manifest,
    ManifestItem,
    SplitLockedError,
    grouping_columns,
    is_test_split,
    read_image,
    read_manifest,
    write_image,
    write_manifest,
)

# 每個方法都執行（ADR 0005）：「變體 × 方法」結果表、離線計算逐步升級、貪婪選擇
from dietai.evaluation.methods import (
    GreedyCriteria,
    GreedyResult,
    GreedyStep,
    arm_methods,
    greedy_ladder,
    is_test_row,
    judge_attempt,
    list_method_runs,
    method_arms,
    method_id,
    methods_in,
    methods_report_markdown,
    pipeline_vs_parts,
    read_methods,
    run_methods,
    simulate_ladder,
)

# 統計：Wilson 信賴區間、McNemar 精確檢定與其配對計數、以原始樣本為單位的集群 bootstrap、Holm 校正
from dietai.evaluation.stats import (
    ClusterComparison,
    cluster_bootstrap_diff,
    holm,
    mcnemar_exact,
    paired_counts,
    wilson_interval,
)

__all__ = [
    "Arm",
    "ClusterComparison",
    "DEFAULT_QUAD_TOL",
    "FieldScore",
    "GreedyCriteria",
    "GreedyResult",
    "GreedyStep",
    "LabelTruth",
    "Manifest",
    "ManifestItem",
    "Outcome",
    "RunSummary",
    "SplitLockedError",
    "arm_methods",
    "cer",
    "cluster_bootstrap_diff",
    "compare_by_source",
    "evaluate",
    "first_rung",
    "greedy_ladder",
    "grouping_columns",
    "holm",
    "is_test_row",
    "is_test_split",
    "judge",
    "judge_attempt",
    "label_report_markdown",
    "list_method_runs",
    "list_runs",
    "load_arm",
    "load_arms",
    "load_label_methods",
    "load_label_truth",
    "located",
    "mcnemar_exact",
    "method_arms",
    "method_id",
    "methods_in",
    "methods_report_markdown",
    "new_run_dir",
    "paired_counts",
    "pipeline_vs_parts",
    "quad_error",
    "read_image",
    "read_label_run",
    "read_manifest",
    "read_methods",
    "read_run",
    "report_markdown",
    "rescue_counts",
    "run_experiment",
    "run_label_ocr",
    "run_methods",
    "score_fields",
    "simulate_ladder",
    "summarize",
    "summarize_label",
    "wilson_interval",
    "write_image",
    "write_manifest",
]
