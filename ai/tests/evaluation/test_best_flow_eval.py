"""找最佳流程：真值推定、依確認的真值重新判定、truth.csv 讀寫。"""

import pytest

from dietai.evaluation import GreedyCriteria, greedy_ladder
from dietai.evaluation.best_flow import (
    TruthSource,
    TruthStatus,
    apply_truth,
    infer_truth,
    normalize_truth,
    read_truth,
    resolve_truths,
    write_truth,
)

CODE = "4710088410108"
OTHER = "4712612300015"
BAD = "4710088410109"  # 檢查碼錯誤


def _row(image_id: str, method: str, decoded: str = "", outcome: str = "") -> dict[str, str]:
    """methods.csv 的一列（不帶真值執行：解到內容為 false_positive，否則 true_negative）。"""
    if not outcome:
        outcome = "false_positive" if decoded else "true_negative"
    return {
        "id": image_id,
        "image": f"/data/{image_id}.png",
        "arm": "c0_all_methods",
        "method": method,
        "truth": "",
        "split": "dev",
        "outcome": outcome,
        "decoded": decoded,
        "formats": "|".join("ean13" for _ in decoded.split("|")) if decoded else "",
        "rejected": "0",
        "skipped": "0",
        "elapsed_ms": "1.0",
        "error": "boom" if outcome == "error" else "",
    }


def _status(rows, **kw):
    return {g.id: (g.status, g.truth) for g in infer_truth(rows, **kw)}


def test_two_methods_agreeing_on_a_valid_code_is_auto():
    rows = [_row("a", "raw", CODE), _row("a", "gray", CODE), _row("a", "otsu")]
    assert _status(rows) == {"a": (TruthStatus.AUTO, CODE)}


def test_upc_a_is_normalised_before_voting():
    upc = "036000291452"  # UPC-A（12 位），等於開頭補 0 的 EAN-13
    rows = [_row("a", "raw", upc), _row("a", "gray", upc.zfill(13))]
    (g,) = infer_truth(rows)
    assert g.status is TruthStatus.AUTO
    assert g.truth == upc.zfill(13)
    assert g.candidates[0].methods == ("raw", "gray")


@pytest.mark.parametrize(
    ("rows", "status"),
    [
        # 只有一個方法讀到
        ([_row("a", "raw", CODE), _row("a", "gray")], TruthStatus.REVIEW),
        # 兩個方法讀出不同號碼
        (
            [_row("a", "raw", CODE), _row("a", "gray", CODE), _row("a", "otsu", OTHER)],
            TruthStatus.REVIEW,
        ),
        # 檢查碼錯誤
        ([_row("a", "raw", BAD), _row("a", "gray", BAD)], TruthStatus.REVIEW),
        # 沒有任何方法讀到
        ([_row("a", "raw"), _row("a", "gray")], TruthStatus.UNKNOWN),
        # error 不計票
        ([_row("a", "raw", CODE), _row("a", "gray", CODE, "error")], TruthStatus.REVIEW),
    ],
)
def test_not_auto(rows, status):
    assert _status(rows) == {"a": (status, "")}


def test_min_methods_is_configurable():
    rows = [_row("a", "raw", CODE), _row("a", "gray", CODE)]
    assert _status(rows, min_methods=3)["a"][0] is TruthStatus.REVIEW
    assert _status(rows[:1], min_methods=1)["a"][0] is TruthStatus.AUTO
    with pytest.raises(ValueError):
        infer_truth(rows, min_methods=0)


def test_candidates_sorted_by_votes():
    rows = [_row("a", "raw", OTHER), _row("a", "gray", CODE), _row("a", "otsu", CODE)]
    (g,) = infer_truth(rows)
    assert [c.code for c in g.candidates] == [CODE, OTHER]
    assert g.candidates[0].checksum_ok


def test_resolve_prefers_confirmed_and_skips_undecided():
    rows = [
        *(_row("auto", m, CODE) for m in ("raw", "gray")),
        _row("review", "raw", CODE),
        _row("unknown", "raw"),
        *(_row("fixed", m, CODE) for m in ("raw", "gray")),
    ]
    confirmed = {"fixed": ("", TruthSource.MANUAL), "unknown": (OTHER, TruthSource.MANUAL)}
    assert resolve_truths(infer_truth(rows), confirmed) == {
        "auto": (CODE, TruthSource.AUTO),
        "unknown": (OTHER, TruthSource.MANUAL),
        "fixed": ("", TruthSource.MANUAL),
    }


def test_apply_truth_rejudges_and_keeps_errors():
    rows = [
        _row("a", "raw", CODE),
        _row("a", "gray", OTHER),
        _row("a", "otsu"),
        _row("a", "clahe", outcome="error"),
        _row("neg", "raw", CODE),
        _row("neg", "gray"),
        _row("skip", "raw", CODE),
    ]
    out = apply_truth(rows, {"a": CODE, "neg": ""})
    assert [(r["id"], r["method"], r["truth"], r["outcome"]) for r in out] == [
        ("a", "raw", CODE, "correct"),
        ("a", "gray", CODE, "misread"),
        ("a", "otsu", CODE, "missed"),
        ("a", "clahe", CODE, "error"),
        ("neg", "raw", "", "false_positive"),
        ("neg", "gray", "", "true_negative"),
    ]


def test_greedy_runs_on_rejudged_rows():
    rows = [
        _row("a", "raw", CODE),
        _row("a", "gray", CODE),
        _row("b", "raw"),
        _row("b", "gray", OTHER),
    ]
    judged = apply_truth(rows, {"a": CODE, "b": OTHER})
    result = greedy_ladder(judged, GreedyCriteria())
    assert result.order == ("raw", "gray")
    assert result.steps[-1].correct == 2


def test_normalize_truth():
    assert normalize_truth(" 4710088 410108 ") == CODE
    assert normalize_truth("036000291452") == "0036000291452"
    assert normalize_truth("") == ""


def test_truth_file_round_trip(tmp_path):
    assert read_truth(tmp_path) == {}
    truths = {"a": (CODE, TruthSource.AUTO), "b": ("", TruthSource.MANUAL)}
    write_truth(tmp_path, truths)
    assert read_truth(tmp_path) == truths
    assert not list(tmp_path.glob("*.tmp"))
