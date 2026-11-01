import csv
import json
from pathlib import Path

import numpy as np
import pytest

from dietai.evaluation import (
    Arm,
    GreedyCriteria,
    Outcome,
    SplitLockedError,
    arm_methods,
    greedy_ladder,
    judge_attempt,
    list_method_runs,
    list_runs,
    load_arm,
    method_arms,
    method_id,
    methods_in,
    methods_report_markdown,
    pipeline_vs_parts,
    read_manifest,
    read_methods,
    read_run,
    run_experiment,
    run_methods,
    simulate_ladder,
    summarize,
    write_image,
    write_manifest,
)
from dietai.evaluation.barcode import RESULT_COLUMNS
from dietai.evaluation.methods import METHOD_COLUMNS
from dietai.preprocess import CodeFormat, DecodeHit, LadderConfig, Rung
from dietai.preprocess.barcode import RungAttempt
from dietai.synthetic import write_barcode_dataset

CONFIGS = Path(__file__).resolve().parents[3] / "research/experiments/e1_barcode/configs"
CORNERS = ((0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0))
CODE = "4710088410108"
OTHER = "4712612300015"


def _hit(text: str, fmt: CodeFormat = CodeFormat.EAN13) -> DecodeHit:
    return DecodeHit(fmt, text, text.encode(), CORNERS)


def _manifest(tmp_path: Path, rows: list[dict[str, str]]):
    img = np.full((40, 60, 3), 200, dtype=np.uint8)
    for r in rows:
        if not r["image"].startswith("missing"):
            write_image(tmp_path / r["image"], img)
    return read_manifest(write_manifest(tmp_path / "manifest.csv", rows, ("condition",)))


ARM = Arm(
    "t",
    ladder=LadderConfig(rungs=(Rung.RAW, Rung.GRAY, Rung.MULTISCALE), scales=(2.0, 0.5)),
)


# ---- 方法代碼與單一方法判定 ----


def test_method_ids():
    assert method_id(Rung.SHARPEN, {}) == "sharpen"
    assert method_id(Rung.MULTISCALE, {"factor": 2.0}) == "multiscale@2"
    assert arm_methods(ARM.ladder) == ("raw", "gray", "multiscale@2", "multiscale@0.5")
    piped = LadderConfig(
        rungs=(Rung.OTSU, Rung.PIPELINE),
        pipelines=((Rung.DENOISE, Rung.BINARIZE), (Rung.DESKEW, Rung.CLAHE)),
    )
    assert arm_methods(piped) == ("otsu", "pipeline@denoise+binarize", "pipeline@deskew+clahe")
    assert method_id(Rung.PIPELINE, {"steps": "clahe+otsu"}) == "pipeline@clahe+otsu"


@pytest.mark.parametrize(
    ("hits", "truth", "expected"),
    [
        ((_hit(CODE),), CODE, Outcome.CORRECT),
        ((_hit("012345678905", CodeFormat.UPCA),), "0012345678905", Outcome.CORRECT),
        ((_hit(OTHER),), CODE, Outcome.MISREAD),
        ((), CODE, Outcome.MISSED),
        ((_hit(CODE),), "", Outcome.FALSE_POSITIVE),
        ((), "", Outcome.TRUE_NEGATIVE),
    ],
)
def test_judge_attempt(hits, truth, expected):
    attempt = RungAttempt(Rung.RAW, {}, 1.0, hits)
    assert judge_attempt(attempt, truth) is expected


# ---- 執行 ----


def test_run_methods_runs_every_method_without_stopping(tmp_path, fake_decoder):
    manifest = _manifest(
        tmp_path,
        [
            {"id": "p", "image": "p.png", "truth": CODE, "split": "dev", "condition": "clean"},
            {"id": "n", "image": "n.png", "truth": "", "split": "dev", "condition": "clean"},
        ],
    )
    # raw 就解出正確結果，其餘方法仍然執行；負樣本的 multiscale@0.5 誤報
    decoder = fake_decoder([[_hit(CODE)], [], [_hit(OTHER)], [], [], [], [], [_hit(CODE)]])
    out = tmp_path / "runs" / "m"
    summary = run_methods(manifest, [ARM], out, decoder_factory=lambda a: decoder, label="x")
    assert len(decoder.shapes) == 8  # 2 張 × 4 個方法，沒有提早停止
    # multiscale 以灰階處理並縮放
    assert decoder.shapes[:4] == [(40, 60, 3), (40, 60), (80, 120), (20, 30)]

    meta, rows = read_methods(out)
    assert list(rows[0]) == [*METHOD_COLUMNS, "condition"]
    got = [(r["id"], r["method"], r["outcome"]) for r in rows]
    assert got == [
        ("p", "raw", "correct"),
        ("p", "gray", "missed"),
        ("p", "multiscale@2", "misread"),
        ("p", "multiscale@0.5", "missed"),
        ("n", "raw", "true_negative"),
        ("n", "gray", "true_negative"),
        ("n", "multiscale@2", "true_negative"),
        ("n", "multiscale@0.5", "false_positive"),
    ]
    assert rows[2]["params"] == '{"factor": 2.0}'
    for r in rows:
        total = float(r["preprocess_ms"]) + float(r["decode_ms"])
        assert total == pytest.approx(float(r["elapsed_ms"]), abs=0.01)
    assert meta["mode"] == "methods"
    assert meta["methods"] == {"t": ["raw", "gray", "multiscale@2", "multiscale@0.5"]}
    assert summary.counts["correct"] == 1 and summary.counts["false_positive"] == 1

    # 與逐步升級的執行放在同一個 runs/ 下時各自列出，工作台的 E1 頁不會讀到這次執行
    assert list_method_runs(tmp_path / "runs") == [out]
    assert list_runs(tmp_path / "runs") == []


def test_run_methods_isolates_errors(tmp_path):
    manifest = _manifest(
        tmp_path,
        [
            {"id": "ok", "image": "ok.png", "truth": CODE, "split": "dev", "condition": "c"},
            {"id": "gone", "image": "missing.png", "truth": CODE, "split": "dev", "condition": "c"},
        ],
    )

    def decoder(img):
        if img.ndim == 2:
            raise RuntimeError("gray fails")
        return [_hit(CODE)]

    out = tmp_path / "m"
    run_methods(manifest, [ARM], out, decoder_factory=lambda a: decoder)
    _, rows = read_methods(out)
    got = {(r["id"], r["method"]): r["outcome"] for r in rows}
    # 灰階類方法出錯不影響 raw；多尺度的每個倍率都記一列 error
    assert got[("ok", "raw")] == "correct"
    assert [got[("ok", m)] for m in ("gray", "multiscale@2", "multiscale@0.5")] == ["error"] * 3
    # 讀檔失敗：每個方法都記一列 error，各變體的列數一致
    assert [got[("gone", m)] for m in arm_methods(ARM.ladder)] == ["error"] * 4
    assert "RuntimeError: gray fails" in next(r["error"] for r in rows if r["method"] == "gray")


def test_run_methods_refuses_test_split_and_existing_output(tmp_path, fake_decoder):
    manifest = read_manifest(
        write_manifest(
            tmp_path / "m.csv", [{"id": "a", "image": "a.png", "truth": CODE, "split": "test"}]
        ),
        include_test=True,
    )
    with pytest.raises(ValueError, match="include_test"):
        run_methods(manifest, [ARM], tmp_path / "o", decoder_factory=lambda a: fake_decoder([]))
    (tmp_path / "busy").mkdir()
    (tmp_path / "busy" / "x").write_text("x")
    dev = _manifest(tmp_path, [{"id": "a", "image": "a.png", "truth": CODE, "split": "dev"}])
    with pytest.raises(FileExistsError):
        run_methods(dev, [ARM], tmp_path / "busy", decoder_factory=lambda a: fake_decoder([]))


# ---- 離線計算：手工結果表 ----


def _row(vid, method, decoded="", truth=CODE, ms=1.0, arm="a", fmt="EAN13", error=False):
    texts = decoded.split("|") if decoded else []
    if error:
        outcome = "error"
    elif not truth:
        outcome = "false_positive" if texts else "true_negative"
    elif not texts:
        outcome = "missed"
    else:
        outcome = "correct" if truth in texts else "misread"
    return {
        "id": vid,
        "image": f"{vid}.png",
        "arm": arm,
        "method": method,
        "truth": truth,
        "split": "dev",
        "outcome": outcome,
        "decoded": decoded,
        "formats": "|".join(fmt for _ in texts),
        "rejected": "0",
        "skipped": "0",
        "elapsed_ms": "" if error else str(ms),
        "error": "boom" if error else "",
        "level": "1",
    }


def test_simulate_ladder_stops_at_first_result():
    rows = [
        _row("v1", "raw"),
        _row("v1", "gray", OTHER, ms=2.0),
        _row("v1", "sharpen", CODE, ms=4.0),
        _row("v2", "raw", CODE),
        _row("v2", "gray"),
        _row("v2", "sharpen"),
    ]
    out = simulate_ladder(rows, ["raw", "gray", "sharpen"])
    assert list(out[0])[: len(RESULT_COLUMNS)] == list(RESULT_COLUMNS)
    v1, v2 = out
    # 依序找第一個有結果的方法：gray 誤讀，之後的 sharpen 不再嘗試
    assert (v1["outcome"], v1["success_rung"], v1["attempts"]) == ("misread", "gray", 2)
    assert v1["elapsed_ms"] == "3.000" and v1["arm"] == "raw>gray>sharpen"
    assert (v2["outcome"], v2["success_index"], v2["level"]) == ("correct", 0, "1")
    # 換一個順序就不同：sharpen 在 gray 之前時救回 v1
    v1b, _ = simulate_ladder(rows, ["raw", "sharpen", "gray"], name="b")
    assert (v1b["outcome"], v1b["arm"]) == ("correct", "b")
    # 都沒有結果
    (none,) = simulate_ladder(rows[3:], ["gray"])
    assert (none["outcome"], none["success_rung"], none["attempts"]) == ("missed", "", 1)


def test_simulate_ladder_min_agree():
    rows = [
        _row("v", "raw", OTHER),
        _row("v", "gray", CODE),
        _row("v", "sharpen", CODE, ms=3.0),
        _row("v", "denoise", OTHER),
    ]
    # min_agree=2：CODE 在 sharpen 湊滿兩票；first_rung 為最早解出 CODE 的 gray
    (r,) = simulate_ladder(rows, ["raw", "gray", "sharpen", "denoise"], min_agree=2)
    assert (r["outcome"], r["success_rung"], r["first_rung"]) == ("correct", "sharpen", "gray")
    assert r["decoded"] == CODE and r["formats"] == "EAN13"
    # 只有零星的單票：負樣本不算誤報
    neg = [_row("n", "raw", OTHER, truth=""), _row("n", "gray", CODE, truth="")]
    (n,) = simulate_ladder(neg, ["raw", "gray"], min_agree=2)
    assert n["outcome"] == "true_negative"


def test_simulate_ladder_errors_and_validation():
    rows = [_row("v", "raw"), _row("v", "gray", error=True), _row("v", "sharpen", CODE)]
    (r,) = simulate_ladder(rows, ["raw", "gray", "sharpen"])
    assert (r["outcome"], r["error"]) == ("error", "boom")
    # error 之前已有結果時不受影響
    (ok,) = simulate_ladder(rows, ["sharpen", "gray"])
    assert ok["outcome"] == "correct"
    with pytest.raises(ValueError, match="denoise"):
        simulate_ladder(rows, ["raw", "denoise"])
    with pytest.raises(ValueError, match="不得為空"):
        simulate_ladder(rows, [])
    two = [*rows, _row("v", "raw", arm="b")]
    with pytest.raises(ValueError, match="指定 arm"):
        simulate_ladder(two, ["raw"])
    (b,) = simulate_ladder(two, ["raw"], arm="b")
    assert b["outcome"] == "missed"


def _greedy_table():
    """raw 讀到 v1；A 救回 v2、v3 但誤讀 v4；B 救回 v4；C 救回 v2 但較慢；負樣本 n 被 A 誤報。"""
    found = {
        "raw": {"v1": CODE},
        "A": {"v2": CODE, "v3": CODE, "v4": OTHER},
        "B": {"v4": CODE},
        "C": {"v2": CODE},
    }
    ms = {"raw": 1.0, "A": 2.0, "B": 3.0, "C": 9.0}
    rows = []
    for vid in ("v1", "v2", "v3", "v4", "n"):
        for m in ("raw", "A", "B", "C"):
            truth = "" if vid == "n" else CODE
            decoded = found[m].get(vid, "")
            if vid == "n" and m == "A":
                decoded = OTHER
            rows.append(_row(vid, m, decoded, truth=truth, ms=ms[m]))
    return rows


def test_greedy_ladder_does_not_add_misreads_by_default():
    result = greedy_ladder(_greedy_table())
    # A 會帶來誤讀與誤報而被排除；B 與 C 各救回 1 個，B 較快先選；C 接著救回 v2
    assert result.order == ("raw", "B", "C")
    first, b, c = result.steps
    assert (first.rescued, first.correct, first.positives, first.negatives) == (1, 1, 4, 1)
    assert (b.rescued, b.new_misread, b.correct) == (1, 0, 2)
    assert (c.rescued, c.correct, c.missed) == (1, 3, 1)
    # 平均耗時：v1 只跑 raw（1），其餘四個跑完 raw+B（4），再加 C 時 v2 停在 C（13）、v3 與 n 也跑 C
    assert b.mean_ms == pytest.approx((1 + 4 * 4) / 5)
    assert c.mean_ms == pytest.approx((1 + 13 + 13 + 4 + 13) / 5)
    assert result.stop == "constraints" and result.excluded == 0


def test_greedy_ladder_criteria():
    rows = _greedy_table()
    # 容許兩個錯誤（誤讀＋誤報）時 A 救回最多而先選
    loose = greedy_ladder(rows, GreedyCriteria(max_new_wrong=2))
    assert loose.order[:2] == ("raw", "A")
    assert (loose.steps[1].rescued, loose.steps[1].new_misread) == (2, 1)
    assert loose.steps[1].new_false_positive == 1
    # 救回數下限 2：B、C 都只救回 1 個
    assert greedy_ladder(rows, GreedyCriteria(min_gain=2)).stop == "min_gain"
    # 耗時上限排除 C
    capped = greedy_ladder(rows, GreedyCriteria(max_mean_ms=5.0))
    assert capped.order == ("raw", "B") and capped.stop == "constraints"
    # 候選只限 B：加完即結束
    only_b = greedy_ladder(rows, candidates=["B"])
    assert only_b.order == ("raw", "B") and only_b.stop == "exhausted"
    with pytest.raises(ValueError, match="start"):
        GreedyCriteria(start=())


def test_greedy_ladder_excludes_error_variants():
    rows = [*_greedy_table(), _row("bad", "raw", error=True)]
    rows += [_row("bad", m) for m in ("A", "B", "C")]
    result = greedy_ladder(rows)
    assert result.excluded == 1 and result.steps[0].positives == 4


def test_method_arms_feeds_summarize():
    rows = _greedy_table()
    summary = {s["arm"]: s for s in summarize(method_arms(rows), (), "raw")}
    assert list(summary) == ["raw", "A", "B", "C"]
    assert (summary["A"]["correct"], summary["A"]["misread"], summary["A"]["gained"]) == (2, 1, 2)
    assert summary["A"]["lost"] == 1  # raw 對、A 錯（v1）：退步
    assert summary["A"]["false_positive"] == 1
    multi = method_arms([*rows, _row("v1", "raw", arm="b")])
    assert {r["arm"] for r in multi} >= {"a:raw", "b:raw"}
    assert methods_in(rows) == ("raw", "A", "B", "C")


# ---- 與實際逐步升級一致（真實 zxing-cpp、合成資料）----


@pytest.mark.parametrize("config", ["a6_full", "m1_agree2", "c0_all_methods"])
def test_simulated_ladder_matches_decode_with_ladder(tmp_path, config):
    # 離線計算成立的前提：各方法由原圖獨立處理，依序找第一個已確認結果，
    # 必須與 decode_with_ladder 實際執行的判定完全相同
    manifest = read_manifest(write_barcode_dataset(tmp_path / "data", n_codes=1))
    arm = load_arm(CONFIGS / f"{config}.json")
    run_methods(manifest, [arm], tmp_path / "methods")
    run_experiment(manifest, [arm], tmp_path / "ladder")
    meta, rows = read_methods(tmp_path / "methods")
    _, actual = read_run(tmp_path / "ladder")

    simulated = simulate_ladder(rows, arm_methods(arm.ladder), min_agree=arm.ladder.min_agree)
    keys = ("id", "outcome", "attempts", "success_index", "decoded")
    got = [tuple(str(r[k]) for k in keys) for r in simulated]
    assert got == [tuple(r[k] for k in keys) for r in actual]
    outcomes = {r["outcome"] for r in actual}
    assert {"correct", "missed"} <= outcomes  # 資料集有救回也有失敗，比較才有意義

    report = methods_report_markdown(meta, rows, ("condition",))
    assert f"## {arm.name}：單一方法" in report
    assert f"## {arm.name}：貪婪選擇（min_agree={arm.ladder.min_agree}）" in report
    assert "依 `condition` 分組" in report and "configured" in report
    if config == "c0_all_methods":
        assert "疊加流程 vs 所含最佳單一步驟（H3）" in report
        assert "| pipeline@denoise+binarize |" in report
    assert "逐步升級比較 · 以原始樣本為單位" in report
    if any(r["skipped"] == "1" for r in rows):
        assert "略過（不送解碼、判為未讀到）：deskew" in report


def test_report_compares_engines(tmp_path, fake_decoder):
    manifest = _manifest(
        tmp_path, [{"id": "p", "image": "p.png", "truth": CODE, "split": "dev", "condition": "c"}]
    )
    arms = [ARM, Arm("u", ladder=LadderConfig(rungs=(Rung.RAW,)))]
    decoder = fake_decoder([[], [_hit(CODE)], [], [], [_hit(CODE)]])
    run_methods(manifest, arms, tmp_path / "m", decoder_factory=lambda a: decoder)
    meta, rows = read_methods(tmp_path / "m")
    report = methods_report_markdown(meta, rows)
    assert "## 引擎比較（皆不做前處理）" in report
    assert "| t:raw |" in report and "| u:raw |" in report
    assert "## u：貪婪選擇" in report
    assert json.loads((tmp_path / "m" / "run.json").read_text(encoding="utf-8"))["counts"]
    with (tmp_path / "m" / "methods.csv").open(encoding="utf-8") as f:
        assert len(list(csv.DictReader(f))) == 5


def test_greedy_refuses_test_split_and_report_uses_fixed_orders():
    rows = _greedy_table()
    for r in rows:
        r["split"] = "test"
    # 規則 7：測試集只能評估在 dev 上選定的順序，不得用來選擇
    with pytest.raises(SplitLockedError):
        greedy_ladder(rows)
    meta = {"arms": [{"name": "a", "ladder": {"min_agree": 1}}]}
    report = methods_report_markdown(meta, rows, orders={"frozen": ["raw", "B", "C"]})
    assert "不做貪婪選擇（規則 7）" in report and "- greedy" not in report
    assert "| frozen | 4 | 75.0%" in report
    # 路徑含 splits/test 也算測試集
    dev = _greedy_table()
    dev[0]["image"] = "data/splits/test/v1.png"
    with pytest.raises(SplitLockedError):
        greedy_ladder(dev)


def test_pipeline_vs_parts():
    # 流程 A+B 救回 v1、v2；A 單獨救回 v1、v2、v3（流程反而較差）；B 救回 v1
    rows = []
    for vid in ("v1", "v2", "v3", "v4"):
        rows.append(_row(vid, "A", CODE if vid in ("v1", "v2", "v3") else ""))
        rows.append(_row(vid, "B", CODE if vid == "v1" else ""))
        rows.append(_row(vid, "pipeline@A+B", CODE if vid in ("v1", "v2") else OTHER))
        rows.append(_row(vid, "pipeline@B+Z", ""))
    by = {c["pipeline"]: c for c in pipeline_vs_parts(rows)}
    ab = by["pipeline@A+B"]
    assert (ab["rate"], ab["best_part"], ab["best_rate"]) == (0.5, "A", 0.75)
    assert ab["diff"] == pytest.approx(-0.25) and (ab["misread"], ab["best_misread"]) == (2, 0)
    # Z 沒有單獨執行：只和 B 比
    assert by["pipeline@B+Z"]["best_part"] == "B"
    with pytest.raises(ValueError, match="指定 arm"):
        pipeline_vs_parts([*rows, _row("v1", "A", arm="b")])
    assert pipeline_vs_parts([*rows, _row("v1", "A", arm="b")], arm="b") == []
