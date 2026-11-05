"""參數掃描、資料夾批次、E1 的純邏輯測試。"""

import shutil
from pathlib import Path

import cv2
import numpy as np
import pytest

from dietai.devtools import batch, e1, label_eval, ladder_eval, quality_alarm, sweep
from dietai.devtools.degradations import SWEEP_AXES
from dietai.devtools.images import PathNotFoundError, SplitLockedError, encode_png
from dietai.devtools.scenes import SceneError
from dietai.preprocess import LabelConfig, LadderConfig, QualityConfig, ZxingConfig
from dietai.preprocess.decoders import DecodeHit
from dietai.preprocess.types import CodeFormat
from dietai.synthetic import label_scene


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"axis": "moon"}, "axis"),
        ({"axis": "blur_sigma", "lo": 5, "hi": 1}, "lo"),
        ({"axis": "blur_sigma", "hi": 999}, "hi"),
        ({"axis": "blur_sigma", "lo": -1, "hi": 999}, "lo"),
        ({"axis": "blur_sigma", "n": 2}, "n"),
        ({"axis": "blur_sigma", "lo": "x"}, "lo"),
    ],
)
def test_parse_axis_rejects_bad_params(params, field):
    with pytest.raises(SceneError) as info:
        sweep.parse_axis(params)
    assert info.value.field == field


def test_quality_sweep_triggers_blur_warning():
    img = label_scene(240, 320)
    ax = sweep.parse_axis({"axis": "blur_sigma", "lo": 0, "hi": 8, "n": 5})
    result = sweep.quality_sweep(img, ax, QualityConfig())
    rows = result.data["rows"]
    assert [r["level"] for r in rows] == [0, 2, 4, 6, 8]
    assert rows[0]["blur_score"] > rows[-1]["blur_score"]  # 越模糊分數越低
    trigger = result.data["triggers"]["TOO_BLURRY"]
    assert trigger is not None and trigger > 0
    assert result.data["triggers"]["TOO_DARK"] is None
    assert [t.level for t in result.thumbs] == [0, 4, 8]


def test_barcode_sweep_compares_raw_and_ladder():
    ax = sweep.parse_axis({"axis": "rotate_deg", "lo": 0, "hi": 45, "n": 3})
    result = sweep.barcode_sweep(
        ax,
        samples=2,
        module_px=4,
        seed=0,
        ladder=LadderConfig(),
        zxing=ZxingConfig(),
        quality=QualityConfig(),
    )
    data = result.data
    assert len(data["rows"]) == 6  # 3 個等級 × 2 個樣本
    assert {r["method"] for r in data["rates"]} == {"raw", "ladder"}
    assert data["overall"]["ladder"] >= data["overall"]["raw"]
    assert data["first_failure"]["raw"] == 45  # 只用原圖在 45° 失敗
    # 對真值判定：每列都有真值，結果為 E1 的判定代碼；讀對時解出內容等於真值
    for row in data["rows"]:
        assert row["ladder"] in {"correct", "misread", "missed"}
        if row["ladder"] == "correct":
            assert row["decoded"] == row["truth"]
    # 品質對照的四格加總等於列數，每個品質警告代碼都列出
    assert sum(data["alarms"].values()) == 6
    assert set(data["quality_triggers"]) == {
        "LOW_RESOLUTION",
        "TOO_BLURRY",
        "TOO_DARK",
        "TOO_BRIGHT",
    }
    assert [q["level"] for q in data["quality_rates"]] == [0, 22.5, 45]


def _hit(text: str) -> DecodeHit:
    return DecodeHit(CodeFormat.EAN13, text, text.encode(), ((0, 0), (10, 0), (10, 5), (0, 5)))


def test_ladder_sweep_counts_misread_as_failure():
    """解出檢查碼正確但不是真值的號碼時算誤讀，不算成功（舊版只看有沒有解出）。"""
    wrong = "4710088410115"  # 檢查碼正確的另一個號碼
    img = label_scene(120, 160)
    rows = ladder_eval.ladder_sweep(
        [img],
        ["4710088410108"],
        lambda im, _level: im,
        [0.0],
        lambda _im: [_hit(wrong)],
        LadderConfig(),
        QualityConfig(),
    )
    assert rows[0][ladder_eval.LADDER] == "misread"
    assert rows[0]["解出內容"] == wrong
    rate = next(r for r in ladder_eval.success_rates(rows) if r["方法"] == ladder_eval.LADDER)
    assert rate["成功率"] == 0 and rate["誤讀率"] == 1
    assert ladder_eval.rung_counts(rows) == []  # 誤讀不算救回
    assert ladder_eval.first_failure(rows, ladder_eval.LADDER) == 0


def _row(level: float, correct: bool, passed: bool, warnings: tuple[str, ...] = ()) -> dict:
    return {"等級": level, "正確": correct, "品質通過": passed, "品質警告": list(warnings)}


def test_alarm_counts_and_quality_triggers():
    rows = [
        _row(0, correct=True, passed=True),
        _row(0, correct=True, passed=False, warnings=("TOO_BRIGHT",)),  # 誤報
        _row(1, correct=False, passed=False, warnings=("TOO_BLURRY",)),  # 該重拍
        _row(1, correct=False, passed=True),  # 漏報
    ]
    counts = quality_alarm.alarm_counts(rows, lambda r: r["正確"])
    assert counts == {"該重拍": 1, "誤報": 1, "漏報": 1, "正常": 1}
    # 半數樣本出現才算觸發：兩個等級各有一半
    triggers = quality_alarm.quality_triggers(rows)
    assert triggers["TOO_BRIGHT"] == 0
    assert triggers["TOO_BLURRY"] == 1
    assert triggers["TOO_DARK"] is None
    assert quality_alarm.quality_rates(rows) == [
        {"等級": 0, "不通過率": 0.5},
        {"等級": 1, "不通過率": 0.5},
    ]
    data = quality_alarm.summary_json(rows, lambda r: r["正確"])
    assert data["alarms"] == {"retake": 1, "false_alarm": 1, "missed_alarm": 1, "ok": 1}


@pytest.fixture
def photos(tmp_path):
    for i in range(3):
        (tmp_path / f"p{i}.png").write_bytes(encode_png(label_scene(240, 320, seed=i)))
    (tmp_path / "broken.png").write_bytes(b"not an image")
    return tmp_path


def test_batch_events(photos):
    events = list(batch.iter_batch(str(photos), QualityConfig()))
    assert events[0] == {"type": "start", "total": 4, "folder": str(photos.resolve())}
    rows = [e for e in events if e["type"] == "row"]
    assert [r["index"] for r in rows] == [0, 1, 2, 3]
    assert sum(r["error"] is not None for r in rows) == 1
    summary = events[-1]
    assert summary["type"] == "summary"
    assert (summary["count"], summary["ok"], summary["failed"]) == (4, 3, 1)
    # 240×320 的短邊低於預設下限 480：三張都是解析度不足
    assert summary["pass_rate"] == 0.0
    assert summary["warning_counts"]["LOW_RESOLUTION"] == 3
    assert summary["warning_counts"]["TOO_DARK"] == 0
    assert "image_id" not in rows[0]  # 資料夾模式不存影像


def test_batch_single_file_keeps_image(photos):
    kept = []
    events = list(
        batch.iter_batch(
            str(photos / "p1.png"),
            QualityConfig(),
            keep=lambda img, name: kept.append((img.shape, name)) or "id-1",
        )
    )
    row = next(e for e in events if e["type"] == "row")
    assert row["image_id"] == "id-1"
    assert (row["width"], row["height"]) == (320, 240)
    assert kept == [((240, 320, 3), "p1.png")]


def test_batch_rejects_test_split(tmp_path):
    locked = tmp_path / "splits" / "test"
    locked.mkdir(parents=True)
    with pytest.raises(SplitLockedError):
        list(batch.iter_batch(str(locked), QualityConfig()))


@pytest.fixture
def e1_dir(tmp_path, monkeypatch):
    """複製實驗組設定到暫存目錄，快速執行的合成資料與結果都寫在這裡。"""
    root = tmp_path / "e1_barcode"
    shutil.copytree(e1.E1_DIR / "configs", root / "configs")
    monkeypatch.setattr(e1, "E1_DIR", root)
    monkeypatch.setattr(e1, "DEFAULT_ROOT", root / "runs")
    return root


@pytest.mark.slow
def test_e1_quick_run_and_summary(e1_dir):
    events = list(e1.start_run(["a0_raw", "a6_full"], 1, ""))
    assert events[0]["type"] == "start"
    assert any(e["type"] == "progress" for e in events)
    done = events[-1]
    assert done["type"] == "done"
    assert Path(done["path"]).parent == e1_dir / "runs"

    listed = e1.list_runs_json("")
    assert listed["runs"][0]["name"] == done["name"]
    assert "a6_full" in listed["arms"]
    assert listed["default_arms"] == ["a0_raw", "a6_full"]
    assert set(listed["arm_descriptions"]) == set(listed["arms"])

    run = e1.run_json(done["name"])  # 只給名稱時視為預設結果資料夾下的那一次
    assert run["arms"] == ["a0_raw", "a6_full"]
    assert set(run["overall"]) == {"a0_raw", "a6_full"}
    full = next(r for r in run["overall"]["a0_raw"] if r["arm"] == "a6_full")
    assert {"rate", "ci_low", "ci_high", "p_value"} <= set(full)
    assert run["tags"] and set(run["by_tag"]) == set(run["tags"])
    assert "source_id" not in run["tags"]  # 原始樣本代碼不做分組熱度圖
    assert run["meta"]["include_test"] is False
    for f in run["failures"]:
        assert f["outcome"] in {o.value for o in e1.FAILURES}


def test_e1_rejects_bad_requests(e1_dir):
    with pytest.raises(SceneError, match="至少選一個"):
        list(e1.start_run([], 1, ""))
    with pytest.raises(SceneError) as info:
        list(e1.start_run(["nope"], 1, ""))
    assert info.value.field == "arms"
    with pytest.raises(PathNotFoundError):
        e1.run_json("no_such_run")
    assert e1.list_runs_json(str(e1_dir / "empty"))["runs"] == []


def test_frontend_sweep_axes_match_python():
    """workbench/src/lib/sweepAxes.ts 是 SWEEP_AXES 的前端副本，範圍必須一致。"""
    import re

    from dietai.devtools.degradations import SWEEP_AXES

    ts = (
        Path(__file__).resolve().parents[3] / "workbench" / "src" / "lib" / "sweepAxes.ts"
    ).read_text(encoding="utf-8")
    found = {}
    for m in re.finditer(r"\{([^{}]*?key: '(\w+)'[^{}]*)\}", ts, flags=re.S):
        body, key = m.group(1), m.group(2)
        nums = {
            k: float(v) for k, v in re.findall(r"(lo|hi|defaultLo|defaultHi): (-?[\d.]+)", body)
        }
        found[key] = nums
    assert set(found) == set(SWEEP_AXES)
    for key, axis in SWEEP_AXES.items():
        assert found[key] == {
            "lo": axis.lo,
            "hi": axis.hi,
            "defaultLo": axis.default_lo,
            "defaultHi": axis.default_hi,
        }, key


@pytest.mark.slow
def test_e1_cancel_stops_run_and_removes_partial_results(e1_dir):
    import time

    gen = e1.start_run(["a0_raw"], 3, "")
    assert next(gen)["type"] == "start"
    assert next(gen)["type"] == "progress"
    gen.close()  # 使用者取消
    runs = e1_dir / "runs"
    for _ in range(100):  # 工作執行緒在下一次進度回呼時中止並清掉資料夾
        if not any(runs.iterdir()):
            break
        time.sleep(0.05)
    assert not any(runs.iterdir())
    assert e1.list_runs_json("")["runs"] == []
    # 未完成執行的合成資料也一併刪除
    assert not any((e1_dir / "synthetic").iterdir())


def test_e1_cancel_before_worker_starts_removes_data(e1_dir):
    gen = e1.start_run(["a0_raw"], 1, "")
    assert next(gen)["type"] == "start"
    gen.close()
    assert not any((e1_dir / "runs").iterdir())
    assert not any((e1_dir / "synthetic").iterdir())


def test_e1_claim_run_dir_never_hands_out_the_same_folder(e1_dir, monkeypatch):
    """同一秒內開始的兩次執行：new_run_dir 給出相同名稱時，第二次要拿到別的資料夾。"""
    root = e1_dir / "runs"
    names = iter(["same", "same", "other"])
    monkeypatch.setattr(e1, "new_run_dir", lambda folder, label: folder / next(names))
    first = e1.claim_run_dir(root, "workbench")
    second = e1.claim_run_dir(root, "workbench")
    assert first.is_dir() and second.is_dir()
    assert (first.name, second.name) == ("same", "other")


@pytest.mark.slow
def test_e1_quick_runs_keep_their_own_data(e1_dir):
    first = list(e1.start_run(["a0_raw"], 1, ""))[-1]
    second = list(e1.start_run(["a0_raw"], 2, ""))[-1]
    data = e1_dir / "synthetic"
    assert (data / first["name"] / "manifest.csv").is_file()
    assert (data / second["name"] / "manifest.csv").is_file()
    # 失敗影像的路徑指向該次執行自己的資料
    run = e1.run_json(first["name"])
    assert all(first["name"] in f["image"] for f in run["failures"])


@pytest.mark.parametrize(
    ("axis", "level"), [("rotate_deg", 30.0), ("scale", 0.5), ("perspective", 0.3)]
)
def test_axis_warp_follows_the_image(axis, level):
    """幾何類退化的 warp 要與影像的變形一致：在原圖畫一個白點，退化後白點的位置等於 warp 的結果。"""
    img = np.zeros((240, 320, 3), dtype=np.uint8)
    point = np.array([[100.0, 60.0]])
    cv2.circle(img, (100, 60), 4, (255, 255, 255), -1)
    ax = SWEEP_AXES[axis]
    out = ax.fn(img, level)
    ys, xs = np.nonzero(out[..., 0] > 128)
    found = np.array([xs.mean(), ys.mean()])
    assert ax.warp is not None
    expected = ax.warp(point, img.shape, level)[0]
    assert np.linalg.norm(found - expected) < 1.5


def test_corner_errors_ignore_starting_corner():
    truth = np.array([[0, 0], [100, 0], [100, 50], [0, 50]], dtype=np.float64)
    shifted = np.roll(truth, 1, axis=0) + 1.0  # 同一個四邊形、起點不同、每點偏 (1, 1)
    errors = label_eval.corner_errors(shifted.astype(np.float32), truth)
    assert errors == pytest.approx([2**0.5] * 4)
    assert label_eval.mean_side(truth) == 75
    # 容許誤差 3% × 平均邊長 75 = 2.25 px：偏 1.41 px 算正確，偏 5 px 算偏移
    assert label_eval.judge(shifted.astype(np.float32), truth, 0.03)[0] == "correct"
    assert label_eval.judge((truth + 5).astype(np.float32), truth, 0.03)[0] == "off"
    assert label_eval.judge(None, truth, 0.03) == ("missed", None)


def test_label_sweep_reports_locate_outcomes_and_quality_alarms():
    ax = sweep.parse_axis({"axis": "rotate_deg", "lo": 0, "hi": 20, "n": 3})
    result = sweep.label_sweep(
        ax, samples=2, seed=0, tol=0.03, label=LabelConfig(), quality=QualityConfig()
    )
    data = result.data
    assert len(data["rows"]) == 6  # 3 個等級 × 2 個樣本
    # 未退化的合成標示一定找得到，且四角在容許誤差內
    assert all(r["outcome"] == "correct" for r in data["rows"] if r["level"] == 0)
    assert data["rates"][0]["rate"] == 1
    assert set(data["rates"][0]["warnings"]) == {"LABEL_NOT_LOCATED", "GLARE_RETAKE"}
    assert set(data["overall"]) == {"correct", "off", "missed"}
    assert sum(data["overall"].values()) == pytest.approx(1)
    assert sum(data["alarms"].values()) == 6
    assert [t.level for t in result.thumbs] == [0, 10, 20]


@pytest.mark.parametrize("tol", [0.001, 0.5, "x"])
def test_tolerance_param_rejects_out_of_range(tol):
    with pytest.raises(SceneError) as info:
        sweep.tolerance_param({"tol": tol})
    assert info.value.field == "tol"
