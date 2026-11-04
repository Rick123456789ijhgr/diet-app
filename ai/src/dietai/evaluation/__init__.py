"""實驗評測：manifest 讀取、批次執行（逐步升級、每個方法都執行）、判定與統計彙整。

處理邏輯一律呼叫 ``dietai.preprocess`` 等套件，這裡只負責「跑哪些設定、怎麼判對錯、
怎麼記錄與彙整」。測試集鎖定（根目錄 CLAUDE.md 規則 7）由 ``read_manifest`` 執行。
需要 ``vision`` extra（讀取影像與解碼）。
"""

# E1 規則式自適應策略的離線評估（ADR 0005 後續 6）
from dietai.evaluation.adaptive import (
    FEATURES_FILE,
    PolicyScore,
    TuneResult,
    adaptive_report_markdown,
    feature_bins,
    gate_confusion,
    measure_manifest,
    read_features,
    score_policy,
    simulate_adaptive,
    tune_policy,
    write_features,
)

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

# E3 電子發票 QR：真值格式、正確／部分／誤讀判定、每個方法都執行與離線逐步升級
from dietai.evaluation.invoice import (
    InvoiceOutcome,
    format_invoice_truth,
    invoice_report_markdown,
    judge_invoice,
    parse_invoice_truth,
    read_invoice_methods,
    run_invoice_methods,
    simulate_invoice_ladder,
    summarize_invoice,
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
    "FEATURES_FILE",
    "FieldScore",
    "GreedyCriteria",
    "GreedyResult",
    "GreedyStep",
    "InvoiceOutcome",
    "LabelTruth",
    "Manifest",
    "ManifestItem",
    "Outcome",
    "PolicyScore",
    "RunSummary",
    "SplitLockedError",
    "TuneResult",
    "adaptive_report_markdown",
    "arm_methods",
    "cer",
    "cluster_bootstrap_diff",
    "compare_by_source",
    "evaluate",
    "feature_bins",
    "first_rung",
    "format_invoice_truth",
    "gate_confusion",
    "greedy_ladder",
    "grouping_columns",
    "holm",
    "invoice_report_markdown",
    "is_test_row",
    "is_test_split",
    "judge",
    "judge_attempt",
    "judge_invoice",
    "label_report_markdown",
    "list_method_runs",
    "list_runs",
    "load_arm",
    "load_arms",
    "load_label_methods",
    "load_label_truth",
    "located",
    "mcnemar_exact",
    "measure_manifest",
    "method_arms",
    "method_id",
    "methods_in",
    "methods_report_markdown",
    "new_run_dir",
    "paired_counts",
    "parse_invoice_truth",
    "pipeline_vs_parts",
    "quad_error",
    "read_features",
    "read_image",
    "read_invoice_methods",
    "read_label_run",
    "read_manifest",
    "read_methods",
    "read_run",
    "report_markdown",
    "rescue_counts",
    "run_experiment",
    "run_invoice_methods",
    "run_label_ocr",
    "run_methods",
    "score_fields",
    "score_policy",
    "simulate_adaptive",
    "simulate_invoice_ladder",
    "simulate_ladder",
    "summarize",
    "summarize_invoice",
    "summarize_label",
    "tune_policy",
    "wilson_interval",
    "write_features",
    "write_image",
    "write_manifest",
]
