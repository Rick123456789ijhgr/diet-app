import csv
import json
from pathlib import Path

import numpy as np
import pytest

from dietai.evaluation import (
    Arm,
    Outcome,
    judge,
    list_runs,
    load_arm,
    load_arms,
    new_run_dir,
    read_manifest,
    read_run,
    report_markdown,
    rescue_counts,
    run_experiment,
    summarize,
    write_image,
    write_manifest,
)
from dietai.evaluation.barcode import ATTEMPT_COLUMNS, RESULT_COLUMNS
from dietai.preprocess import (
    DEFAULT_RUNGS,
    CodeFormat,
    DecodeHit,
    LadderConfig,
    Rung,
    ZxingConfig,
    decode_with_ladder,
)
from dietai.synthetic import write_barcode_dataset
from dietai.synthetic.datasets import BARCODE_CONDITIONS

CONFIGS = Path(__file__).resolve().parents[3] / "research/experiments/e1_barcode/configs"
CORNERS = ((0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0))
IMG = np.full((40, 60, 3), 200, dtype=np.uint8)


def _hit(text: str) -> DecodeHit:
    return DecodeHit(CodeFormat.EAN13, text, text.encode(), CORNERS)


def _ladder(responses, fake_decoder):
    return decode_with_ladder(IMG, fake_decoder(responses), LadderConfig(rungs=(Rung.RAW,)))


# ---- 判定 ----


@pytest.mark.parametrize(
    ("responses", "truth", "expected"),
    [
        ([[_hit("4710088410108")]], "4710088410108", Outcome.CORRECT),
        ([[_hit("4712612300015")]], "4718652300015", Outcome.MISREAD),
        ([[]], "4710088410108", Outcome.MISSED),
        ([[_hit("4710088410108")]], "", Outcome.FALSE_POSITIVE),
        ([[]], "", Outcome.TRUE_NEGATIVE),
    ],
)
def test_judge(fake_decoder, responses, truth, expected):
    assert judge(_ladder(responses, fake_decoder), truth) is expected


def test_judge_accepts_any_matching_hit(fake_decoder):
    result = _ladder([[_hit("4712612300015"), _hit("4718652300015")]], fake_decoder)
    assert judge(result, "4718652300015") is Outcome.CORRECT


# ---- 實驗組設定 ----


def test_arm_defaults_and_roundtrip():
    arm = Arm.from_dict({}, default_name="x")
    assert arm == Arm("x")
    custom = Arm(
        "y",
        "說明",
        "zxing",
        ZxingConfig(try_rotate=False),
        LadderConfig(rungs=(Rung.RAW, Rung.BINARIZE), binarize_c=7.0),
    )
    data = json.loads(json.dumps(custom.to_dict()))
    assert data["ladder"]["rungs"] == ["raw", "binarize"]
    assert Arm.from_dict(data) == custom


def test_arm_accepts_workbench_export_format():
    exported = {"class": "LadderConfig", "values": {"rungs": ["raw"], "binarize_c": 3.0}}
    arm = Arm.from_dict({"name": "w", "ladder": exported})
    assert arm.ladder == LadderConfig(rungs=(Rung.RAW,), binarize_c=3.0)
    with pytest.raises(ValueError, match="類別不符"):
        Arm.from_dict({"name": "w", "ladder": {"class": "ZxingConfig", "values": {}}})


@pytest.mark.parametrize(
    ("data", "match"),
    [
        ({"name": "a", "rungs": []}, "沒有這些欄位"),
        ({"name": "a", "ladder": {"steps": []}}, "沒有這些欄位"),
        ({"name": "a", "decoder": "zbar"}, "decoder"),
        ({"name": "a,b"}, "名稱"),
        ({"name": "a", "ladder": {"rungs": ["raw", "raw"]}}, "重複"),
    ],
)
def test_arm_rejects_invalid(data, match):
    with pytest.raises(ValueError, match=match):
        Arm.from_dict(data)


def test_load_arms_from_folder(tmp_path):
    for name in ("b", "a"):
        (tmp_path / f"{name}.json").write_text(json.dumps({"ladder": {"rungs": ["raw"]}}))
    assert [a.name for a in load_arms(tmp_path)] == ["a", "b"]  # 依檔名排序、名稱取自檔名
    assert [a.name for a in load_arms(tmp_path, ["b", "a"])] == ["b", "a"]
    with pytest.raises(ValueError, match="找不到"):
        load_arms(tmp_path, ["c"])
    (tmp_path / "c.json").write_text(json.dumps({"name": "a"}))
    with pytest.raises(ValueError, match="重複"):
        load_arms(tmp_path)


def test_load_arm_reports_file_name(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"ladder": {"binarize_block_size": 4}}))
    with pytest.raises(ValueError, match="bad.json"):
        load_arm(path)


def test_repository_configs_are_valid():
    """research/.../configs 的每個檔案都能讀入；a0–a6 為逐步加入的累積消融。"""
    arms = {a.name: a for a in load_arms(CONFIGS)}
    ablation = sorted(n for n in arms if n.startswith("a"))
    full = arms[ablation[-1]].ladder.rungs
    assert len(ablation) == len(DEFAULT_RUNGS) and set(full) == set(DEFAULT_RUNGS)
    for i, name in enumerate(ablation):
        arm = arms[name]
        assert arm.ladder.rungs == full[: i + 1]
        assert arm.ladder.accept_formats == ()
        assert arm.zxing == ZxingConfig(False, False, False)
    # z2 追蹤目前的程式預設；預設改變時本測試失敗，應新增一個實驗組而非修改 z2
    assert arms["z2_default_v2"].ladder == LadderConfig()
    assert arms["z2_default_v2"].zxing == ZxingConfig()


def test_repository_configs_do_not_rely_on_code_defaults():
    """rungs、accept_formats 須明寫：程式預設改變時，舊實驗組的意義不得跟著改變。"""
    for path in sorted(CONFIGS.glob("*.json")):
        ladder = json.loads(path.read_text(encoding="utf-8")).get("ladder", {})
        assert {"rungs", "accept_formats"} <= set(ladder), path.name


# ---- 批次執行 ----


@pytest.fixture(scope="module")
def dataset(tmp_path_factory) -> Path:
    return write_barcode_dataset(tmp_path_factory.mktemp("e1") / "data", n_codes=1)


ARMS = [
    Arm("raw", zxing=ZxingConfig(False, False, False), ladder=LadderConfig(rungs=(Rung.RAW,))),
    Arm("full", zxing=ZxingConfig(False, False, False)),
]


def test_synthetic_dataset_is_deterministic(dataset, tmp_path):
    m = read_manifest(dataset)
    n_levels = sum(len(levels) for _, levels in BARCODE_CONDITIONS.values())
    assert len(m.items) == 1 + n_levels + 2
    assert m.tag_columns == ("condition", "level")
    assert all(i.image.is_file() for i in m.items)
    assert sum(not i.truth for i in m.items) == 2
    again = write_barcode_dataset(tmp_path / "again", n_codes=1)
    assert read_manifest(again).sha256 == m.sha256
    assert json.loads(dataset.with_suffix(".json").read_text())["seed"] == 0


def test_run_experiment_writes_results(dataset, tmp_path):
    manifest = read_manifest(dataset)
    out = tmp_path / "run"
    seen: list[tuple[int, int]] = []
    summary = run_experiment(manifest, ARMS, out, progress=lambda d, t: seen.append((d, t)))

    n = len(manifest.items) * len(ARMS)
    assert seen[-1] == (n, n)
    assert sum(summary.counts.values()) == n
    meta, rows = read_run(out)
    assert len(rows) == n
    assert list(rows[0]) == [*RESULT_COLUMNS, "condition", "level"]
    assert meta["manifest"]["sha256"] == manifest.sha256
    assert meta["manifest"]["dataset"]["n_codes"] == 1
    assert [a["name"] for a in meta["arms"]] == ["raw", "full"]
    assert meta["arms"][1]["ladder"]["rungs"] == [r.value for r in DEFAULT_RUNGS]
    assert "zxing-cpp" in meta["packages"]
    with (out / "attempts.csv").open(encoding="utf-8") as f:
        attempts = list(csv.DictReader(f))
    assert list(attempts[0]) == list(ATTEMPT_COLUMNS)
    assert len(attempts) == sum(int(r["attempts"]) for r in rows)

    by_arm = {s["arm"]: s for s in summarize(rows)}
    assert by_arm["full"]["correct"] > by_arm["raw"]["correct"]  # 階梯救回只用原圖失敗的影像
    assert by_arm["raw"]["false_positive"] == by_arm["full"]["false_positive"] == 0
    clean = [r for r in rows if r["condition"] == "clean"]
    assert all(r["outcome"] == "correct" and r["success_rung"] == "raw" for r in clean)


def test_run_experiment_never_overwrites(dataset, tmp_path):
    out = tmp_path / "run"
    out.mkdir()
    (out / "old.txt").write_text("x")
    with pytest.raises(FileExistsError):
        run_experiment(read_manifest(dataset), ARMS[:1], out)


def test_unreadable_image_is_recorded_not_fatal(tmp_path, fake_decoder):
    write_image(tmp_path / "good.png", IMG)
    (tmp_path / "bad.png").write_bytes(b"broken")
    rows = [
        {"image": "good.png", "truth": "4710088410108"},
        {"image": "bad.png", "truth": "4710088410108"},
        {"image": "missing.png", "truth": "4710088410108"},
    ]
    manifest = read_manifest(write_manifest(tmp_path / "m.csv", rows))
    out = tmp_path / "run"
    summary = run_experiment(
        manifest,
        [Arm("a", ladder=LadderConfig(rungs=(Rung.RAW,)))],
        out,
        decoder_factory=lambda arm: fake_decoder([[_hit("4710088410108")]]),
    )
    assert summary.counts == {"correct": 1, "error": 2}
    _, results = read_run(out)
    assert "ValueError" in results[1]["error"] and "FileNotFoundError" in results[2]["error"]
    s = summarize(results)[0]
    assert (s["n"], s["correct"], s["errors"], s["rate"]) == (1, 1, 2, 1.0)


def test_run_experiment_refuses_unflagged_test_split(tmp_path, fake_decoder):
    rows = [{"image": "a.png", "truth": "1", "split": "test"}]
    manifest = read_manifest(write_manifest(tmp_path / "m.csv", rows), include_test=True)
    with pytest.raises(ValueError, match="include_test"):
        run_experiment(manifest, [Arm("a")], tmp_path / "run")


def test_tag_column_cannot_shadow_result_column(tmp_path):
    rows = [{"image": "a.png", "truth": "1"}]
    path = write_manifest(tmp_path / "m.csv", rows, ("outcome",))
    with pytest.raises(ValueError, match="同名"):
        run_experiment(read_manifest(path), [Arm("a")], tmp_path / "run")


def test_new_run_dir_and_list_runs(tmp_path):
    first = new_run_dir(tmp_path, "x")
    first.mkdir()
    second = new_run_dir(tmp_path, "x")
    assert second != first and not second.exists()
    second.mkdir()
    (first / "run.json").write_text("{}")
    (second / "run.json").write_text("{}")
    (tmp_path / "incomplete").mkdir()
    assert list_runs(tmp_path) == [second, first]
    assert list_runs(tmp_path / "none") == []


# ---- 彙整 ----


def _row(id_, arm, outcome, truth="1", rung="", ms="1.0", **tags):
    return {
        "id": id_,
        "arm": arm,
        "truth": truth,
        "outcome": outcome,
        "success_rung": rung,
        "elapsed_ms": ms,
        "attempts": "1",
        **tags,
    }


ROWS = [
    _row("1", "base", "correct", rung="raw", light="dark"),
    _row("2", "base", "missed", light="dark"),
    _row("3", "base", "missed", light="10"),
    _row("4", "base", "true_negative", truth="", light="2"),
    _row("1", "new", "correct", rung="raw", light="dark"),
    _row("2", "new", "correct", rung="binarize", light="dark"),
    _row("3", "new", "misread", rung="sharpen", light="10"),
    _row("4", "new", "false_positive", truth="", light="2"),
    _row("5", "new", "error", light="dark", ms=""),
]


def test_summarize_overall_with_baseline():
    base, new = summarize(ROWS, baseline="base")
    assert (base["n"], base["correct"], base["rate"]) == (3, 1, pytest.approx(1 / 3))
    assert (new["n"], new["correct"], new["misread"], new["errors"]) == (3, 2, 1, 1)
    assert (new["negatives"], new["false_positive"]) == (1, 1)
    assert new["ci_low"] < 2 / 3 < new["ci_high"]
    assert (new["lost"], new["gained"]) == (0, 1)
    assert base["p_value"] == 1.0


def test_summarize_by_tag_sorts_numbers_naturally():
    groups = [(s["arm"], s["light"]) for s in summarize(ROWS, ("light",))]
    assert groups[:3] == [("base", "2"), ("base", "10"), ("base", "dark")]
    negatives_only = summarize(ROWS, ("light",))[0]
    assert negatives_only["n"] == 0 and negatives_only["rate"] is None


def test_summarize_unknown_baseline():
    with pytest.raises(ValueError, match="基準"):
        summarize(ROWS, baseline="nope")


def test_rescue_counts():
    assert rescue_counts(ROWS) == [
        {"arm": "base", "rung": "raw", "count": 1},
        {"arm": "new", "rung": "raw", "count": 1},
        {"arm": "new", "rung": "binarize", "count": 1},
    ]


def test_report_markdown():
    meta = {"label": "t", "git": {"commit": "abc", "dirty": True}, "manifest": {"items": 5}}
    text = report_markdown(meta, ROWS, ("light",), "base")
    assert "## 整體 · Overall" in text and "## 依 `light` 分組" in text
    assert "McNemar p" in text and "有未提交的變更" in text
    assert "1 筆 error" in text
    assert "| new | binarize | 1 |" in text
