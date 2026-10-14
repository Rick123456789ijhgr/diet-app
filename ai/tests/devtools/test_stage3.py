"""參數掃描、資料夾批次、E1 的純邏輯測試。"""

import shutil
from pathlib import Path

import pytest

from dietai.devtools import batch, e1, sweep
from dietai.devtools.images import SplitLockedError, encode_png
from dietai.devtools.scenes import SceneError
from dietai.preprocess import LadderConfig, QualityConfig, ZxingConfig
from dietai.synthetic import label_scene


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"axis": "moon"}, "axis"),
        ({"axis": "blur_sigma", "lo": 5, "hi": 1}, "lo"),
        ({"axis": "blur_sigma", "hi": 999}, "lo"),
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
        ax, samples=2, module_px=4, seed=0, ladder=LadderConfig(), zxing=ZxingConfig()
    )
    data = result.data
    assert len(data["rows"]) == 6  # 3 個等級 × 2 個樣本
    assert {r["method"] for r in data["rates"]} == {"raw", "ladder"}
    assert data["overall"]["ladder"] >= data["overall"]["raw"]
    assert data["first_failure"]["raw"] == 45  # 只用原圖在 45° 失敗


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

    run = e1.run_json(done["name"])  # 只給名稱時視為預設結果資料夾下的那一次
    assert run["arms"] == ["a0_raw", "a6_full"]
    assert set(run["overall"]) == {"a0_raw", "a6_full"}
    full = next(r for r in run["overall"]["a0_raw"] if r["arm"] == "a6_full")
    assert {"rate", "ci_low", "ci_high", "p_value"} <= set(full)
    assert run["tags"] and set(run["by_tag"]) == set(run["tags"])
    assert run["meta"]["include_test"] is False
    for f in run["failures"]:
        assert f["outcome"] in {o.value for o in e1.FAILURES}


def test_e1_rejects_bad_requests(e1_dir):
    with pytest.raises(SceneError, match="至少選一個"):
        list(e1.start_run([], 1, ""))
    with pytest.raises(SceneError) as info:
        list(e1.start_run(["nope"], 1, ""))
    assert info.value.field == "arms"
    with pytest.raises(FileNotFoundError):
        e1.run_json("no_such_run")
    assert e1.list_runs_json(str(e1_dir / "empty"))["runs"] == []
