"""規則式自適應策略的離線評估：模擬、門檻調整（只用 dev）、品質檢查門檻、報告。"""

import pytest

from dietai.evaluation import (
    SplitLockedError,
    adaptive_report_markdown,
    feature_bins,
    gate_confusion,
    measure_manifest,
    read_features,
    score_policy,
    simulate_adaptive,
    simulate_ladder,
    tune_policy,
    write_features,
    write_manifest,
)
from dietai.evaluation.barcode import RESULT_COLUMNS
from dietai.preprocess import FEATURE_NAMES, AdaptivePolicy, Rule
from dietai.synthetic import ean13_scene

CODE = "4710088410108"
OTHER = "4712612300015"
METHODS = ("raw", "clahe", "deskew", "multiscale@2")


def _row(vid, method, decoded="", truth=CODE, ms=1.0, split="dev"):
    texts = decoded.split("|") if decoded else []
    if not truth:
        outcome = "false_positive" if texts else "true_negative"
    elif not texts:
        outcome = "missed"
    else:
        outcome = "correct" if truth in texts else "misread"
    return {
        "id": vid,
        "image": f"{vid}.png",
        "arm": "a",
        "method": method,
        "truth": truth,
        "split": split,
        "outcome": outcome,
        "decoded": decoded,
        "formats": "|".join("EAN13" for _ in texts),
        "rejected": "0",
        "skipped": "0",
        "elapsed_ms": str(ms),
        "error": "",
        "source_id": vid[:2],
    }


def _feats(contrast=200.0, skew=0.0, ms=5.0):
    f = dict.fromkeys(FEATURE_NAMES, 0.0)
    f.update(contrast=contrast, skew=skew, measure_ms=ms)
    return f


def _table(split="dev"):
    """四個變體：v1 原圖可讀；v2 低對比，只有 clahe 可讀；v3 傾斜，只有 deskew 可讀；
    v4 低對比但 clahe 會誤讀、multiscale 才讀對。每個方法耗時 10 ms。"""
    reads = {
        "v1": {"raw": CODE},
        "v2": {"clahe": CODE},
        "v3": {"deskew": CODE},
        "v4": {"clahe": OTHER, "multiscale@2": CODE},
    }
    rows = [_row(v, m, reads[v].get(m, ""), ms=10.0, split=split) for v in reads for m in METHODS]
    features = {
        "v1": _feats(),
        "v2": _feats(contrast=40),
        "v3": _feats(skew=12),
        "v4": _feats(contrast=55),
    }
    return rows, features


def _policy(contrast=60.0, skew=5.0, fallback=()):
    rules = (
        Rule("contrast", "<", contrast, ("clahe",)),
        Rule("skew", ">", skew, ("deskew",)),
    )
    return AdaptivePolicy(rules, fallback=fallback, max_attempts=3, name="p")


def test_simulate_adaptive_follows_each_variants_plan():
    rows, features = _table()
    out = simulate_adaptive(rows, features, _policy())
    assert list(out[0])[: len(RESULT_COLUMNS)] == list(RESULT_COLUMNS)
    got = {r["id"]: r for r in out}
    # v1：原圖就成功，不量測品質（耗時不含量測）
    assert (got["v1"]["outcome"], got["v1"]["elapsed_ms"], got["v1"]["plan"]) == (
        "correct",
        "10.000",
        "raw",
    )
    # v2：原圖失敗 → 量測（5 ms）→ clahe 讀對
    assert (got["v2"]["outcome"], got["v2"]["success_rung"], got["v2"]["elapsed_ms"]) == (
        "correct",
        "clahe",
        "25.000",
    )
    assert (got["v3"]["success_rung"], got["v3"]["rules"]) == ("deskew", "1")
    # v4：規則選了 clahe → 誤讀
    assert got["v4"]["outcome"] == "misread" and got["v4"]["arm"] == "p"
    # 同樣的順序以 simulate_ladder 計算，結果一致（只差量測耗時）
    (same,) = simulate_ladder([r for r in rows if r["id"] == "v2"], ["raw", "clahe"])
    assert same["outcome"] == got["v2"]["outcome"] and same["elapsed_ms"] == "20.000"


def test_simulate_adaptive_validation():
    rows, features = _table()
    with pytest.raises(ValueError, match="沒有品質量測值"):
        simulate_adaptive(rows, {k: v for k, v in features.items() if k != "v3"}, _policy())
    bad = AdaptivePolicy((Rule("blur", "<", 1, ("sharpen",)),))
    with pytest.raises(ValueError, match="sharpen"):
        simulate_adaptive(rows, features, bad)


def test_tune_policy_moves_threshold_without_adding_errors():
    rows, features = _table()
    start = _policy(contrast=30.0, fallback=("multiscale@2",))
    before = score_policy(rows, features, start)
    # 門檻 30：v2（40）、v4（55）都不觸發 → v2 未讀到、v4 由候補讀對
    assert (before.correct, before.wrong) == (3, 0)
    result = tune_policy(rows, features, start)
    # 門檻提高到能涵蓋 v2（40）但不涵蓋 v4（55）才能全對且不誤讀
    assert 40 < result.policy.rules[0].threshold <= 55
    assert (result.final.correct, result.final.wrong) == (4, 0)
    assert result.steps and result.steps[0].feature == "contrast"
    # 容許誤讀時仍以正確數優先、誤讀少者次之
    loose = tune_policy(rows, features, start, max_wrong=5)
    assert loose.final.correct == 4 and loose.final.wrong == 0
    with pytest.raises(ValueError, match="rounds"):
        tune_policy(rows, features, start, rounds=0)


def test_tune_policy_refuses_test_split():
    rows, features = _table(split="test")
    with pytest.raises(SplitLockedError):
        tune_policy(rows, features, _policy())


def test_feature_bins_and_gate():
    rows, features = _table()
    bins = feature_bins(rows, features, "contrast", ["raw", "clahe"], bins=2)
    assert [b["n"] for b in bins] == [2, 2]
    low, high = bins
    # 低對比的那一半：原圖都讀不到、clahe 讀對 1 張
    assert (low["raw"], low["clahe"]) == (0.0, 0.5) and high["raw"] == 0.5
    with pytest.raises(ValueError, match="未知的量測值"):
        feature_bins(rows, features, "nope", ["raw"])
    sim = simulate_adaptive(rows, features, _policy())
    g = gate_confusion(sim, features, Rule("contrast", "<", 60, ("gate",)))
    # 判為不佳：v2（讀對 → 誤報）、v4（誤讀 → 正確攔下）；判為良好：v1、v3 皆讀對
    assert (g["flagged_wrong"], g["false_alarm"], g["miss"], g["passed_correct"]) == (1, 1, 0, 2)


def test_report_compares_with_orders(tmp_path):
    rows, features = _table()
    meta = {"label": "t", "manifest": {"tag_columns": ["source_id"]}}
    policy = _policy(fallback=("multiscale@2",))
    tuned = tune_policy(rows, features, _policy(contrast=30.0, fallback=("multiscale@2",)))
    md = adaptive_report_markdown(
        meta,
        rows,
        features,
        policy,
        {"greedy": ["raw", "clahe", "deskew"]},
        tuned=tuned,
        gates=[Rule("contrast", "<", 60, ("gate",))],
    )
    for heading in ("## 規則", "## 耗時", "## 以原始樣本為單位", "## 品質檢查門檻", "## 門檻調整"):
        assert heading in md
    assert "`contrast < 60 → clahe`" in md and "| greedy |" in md


def test_measure_and_features_csv_roundtrip(tmp_path):
    from dietai.evaluation import read_manifest, write_image

    write_image(tmp_path / "a.png", ean13_scene())
    write_manifest(
        tmp_path / "manifest.csv",
        [
            {"id": "a", "image": "a.png", "truth": CODE},
            {"id": "b", "image": "nope.png", "truth": ""},
        ],
    )
    feats = measure_manifest(read_manifest(tmp_path / "manifest.csv"))
    assert list(feats) == ["a"]  # 讀不到的影像略過
    path = write_features(tmp_path / "features.csv", feats)
    assert read_features(path)["a"] == pytest.approx(feats["a"])
    (tmp_path / "bad.csv").write_text("id,blur\na,1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="缺少欄位"):
        read_features(tmp_path / "bad.csv")
