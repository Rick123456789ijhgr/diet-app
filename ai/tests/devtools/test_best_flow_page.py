"""工作台「找最佳流程」：執行、真值確認、結論與匯出。"""

import shutil
from pathlib import Path

import pytest

from dietai.devtools import best_flow, e1
from dietai.devtools.configs import config_from_override
from dietai.devtools.images import PathNotFoundError, SplitLockedError
from dietai.devtools.scenes import SceneError
from dietai.evaluation import read_manifest
from dietai.evaluation.manifest import read_image
from dietai.preprocess import LadderConfig
from dietai.synthetic import write_barcode_dataset

CRITERIA = best_flow.criteria_of(0, 0, 0)


@pytest.fixture
def e1_dir(tmp_path, monkeypatch):
    """實驗組設定與結果都放在暫存目錄。"""
    root = tmp_path / "e1_barcode"
    shutil.copytree(e1.E1_DIR / "configs", root / "configs")
    for mod in (e1, best_flow):
        monkeypatch.setattr(mod, "E1_DIR", root)
    monkeypatch.setattr(e1, "DEFAULT_ROOT", root / "runs")
    return root


@pytest.fixture(scope="module")
def dataset(tmp_path_factory) -> Path:
    """一個條碼的合成資料（含模糊、低光等退化，有些讀得到、有些讀不到）。"""
    folder = tmp_path_factory.mktemp("bestflow-data")
    write_barcode_dataset(folder, 1)
    return folder


def _run(**kw) -> dict:
    events = list(best_flow.start_run(**kw))
    assert events[0]["type"] == "start"
    assert events[-1]["type"] == "done"
    return events[-1]


def test_folder_run_infers_truth_and_recommends_a_ladder(e1_dir, dataset):
    done = _run(folder=str(dataset), recursive=True)
    folder = Path(done["path"])
    assert (folder / "best_flow.json").is_file()
    assert (folder / "truth.csv").is_file()
    # methods/ 在子資料夾：E1 消融與自適應策略頁不會列出
    listed = e1.list_runs_json("")
    assert listed["runs"] == [] and listed["method_runs"] == []
    assert best_flow.list_runs_json("") == [{"name": done["name"], "path": str(folder)}]

    out = best_flow.run_json(done["name"], CRITERIA, thumb=lambda p: f"thumb:{Path(p).name}")
    counts = out["counts"]
    assert counts["images"] == len(read_manifest(dataset / "manifest.csv").items)
    assert counts["auto"] > 0
    assert counts["decided"] == counts["auto"]
    assert all(i["thumb_id"].startswith("thumb:") for i in out["images"])
    result = out["result"]
    assert result["greedy"]["order"][0] == "raw"
    arms = [s["arm"] for s in result["compare"]["summary"]]
    assert arms == ["raw", "greedy", "all"]
    # 匯出的設定可以直接建立 LadderConfig
    config_from_override(LadderConfig, result["export"]["values"])


def test_confirming_truth_changes_the_result(e1_dir, dataset):
    name = _run(folder=str(dataset), recursive=True)["name"]
    out = best_flow.run_json(name, CRITERIA)
    unknown = [i["id"] for i in out["images"] if i["status"] == "unknown"]
    assert unknown, "合成資料應有所有方法都讀不到的影像"
    code = next(i["truth"] for i in out["images"] if i["status"] == "auto")

    after = best_flow.set_truth(name, {unknown[0]: code}, CRITERIA)
    assert after["counts"]["decided"] == out["counts"]["decided"] + 1
    image = next(i for i in after["images"] if i["id"] == unknown[0])
    assert image["applied"] == {"truth": code, "source": "manual"}
    # 沒有方法讀得到，成功率下降
    rate = lambda o: next(s for s in o["result"]["compare"]["summary"] if s["arm"] == "all")["rate"]  # noqa: E731
    assert rate(after) < rate(out)

    # None 取消人工確認，回到未定
    reverted = best_flow.set_truth(name, {unknown[0]: None}, CRITERIA)
    assert reverted["counts"] == out["counts"]


@pytest.mark.parametrize(
    ("updates", "message"),
    [({"nope": ""}, "沒有這張圖片"), ({"__first__": "4710088410109"}, "不合法")],
)
def test_set_truth_rejects_bad_input(e1_dir, dataset, updates, message):
    name = _run(folder=str(dataset), recursive=True)["name"]
    first = best_flow.run_json(name, CRITERIA)["images"][0]["id"]
    updates = {first if k == "__first__" else k: v for k, v in updates.items()}
    with pytest.raises(SceneError, match=message):
        best_flow.set_truth(name, updates, CRITERIA)


def test_upload_run_copies_images(e1_dir, dataset):
    img = read_image(next(dataset.rglob("*clean*.png")))
    done = _run(uploads=[("貨架 1.jpg", img), ("貨架 1.jpg", img)])
    inputs = Path(done["path"]) / "inputs"
    assert len(list((inputs / "images").glob("*.png"))) == 2
    ids = [i["id"] for i in best_flow.run_json(done["name"], CRITERIA)["images"]]
    assert ids == ["貨架 1.jpg", "貨架 1.jpg#2"]


def test_start_run_validates_before_creating_anything(e1_dir, tmp_path, dataset):
    with pytest.raises(SceneError):
        list(best_flow.start_run())
    with pytest.raises(SceneError):
        list(best_flow.start_run(folder=str(dataset), limit=best_flow.MAX_IMAGES + 1))
    (tmp_path / "empty").mkdir()
    with pytest.raises(PathNotFoundError):
        list(best_flow.start_run(folder=str(tmp_path / "empty")))
    locked = tmp_path / "splits" / "test"
    locked.mkdir(parents=True)
    with pytest.raises(SplitLockedError):
        list(best_flow.start_run(folder=str(locked)))
    assert not (e1_dir / "runs").exists() or not any((e1_dir / "runs").iterdir())


def test_presets_are_valid_and_complete(e1_dir):
    presets = best_flow.presets_json()["presets"]
    ids = [p["id"] for p in presets]
    assert ids[0] == "all_methods" and len(ids) == len(set(ids)) >= 5
    for p in presets:
        assert p["name"] and p["description"]
        # 補齊所有預設值的完整設定，可以原樣送回 start_run
        assert set(p["arm"]) == {"name", "description", "decoder", "zxing", "ladder"}
        assert "binarize_block_size" in p["arm"]["ladder"]
        assert best_flow.arm_of(p["arm"]).name == p["id"]
    # 「全部方法」與沒指定方案時的 c0_all_methods 執行同一組方法
    c0 = best_flow.arm_of(None)
    assert best_flow.arm_of(presets[0]["arm"]).ladder == c0.ladder


def test_run_with_a_custom_arm(e1_dir, dataset):
    arm = {
        "name": "mine",
        "zxing": {"try_rotate": False},
        "ladder": {"rungs": ["raw", "multiscale"], "scales": [0.5]},
    }
    done = _run(folder=str(dataset), recursive=True, arm=arm, preset_id="multiscale")
    meta = best_flow.run_json(done["name"], CRITERIA)["meta"]
    assert meta["arm"] == "mine" and meta["preset_id"] == "multiscale"
    methods = best_flow.run_json(done["name"], CRITERIA)["result"]["methods"]
    assert {m["arm"] for m in methods} == {"raw", "multiscale@0.5"}


@pytest.mark.parametrize(
    "arm",
    [
        {"ladder": {"rungs": ["nope"]}},
        {"ladder": {"pipelines": [["denoise"]]}},
        {"unknown": 1},
        {"name": "../x"},
        {"decoder": "magic"},
    ],
)
def test_bad_arm_is_rejected_before_creating_anything(e1_dir, dataset, arm):
    with pytest.raises(SceneError) as e:
        list(best_flow.start_run(folder=str(dataset), arm=arm))
    assert e.value.field == "arm"
    assert not (e1_dir / "runs").exists() or not any((e1_dir / "runs").iterdir())


def test_cancel_removes_the_run(e1_dir, dataset):
    gen = best_flow.start_run(folder=str(dataset), recursive=True)
    assert next(gen)["type"] == "start"
    gen.close()
    assert not any((e1_dir / "runs").iterdir())


def test_resolve_run_requires_a_finished_best_flow_run(e1_dir, tmp_path):
    (tmp_path / "half").mkdir()
    with pytest.raises(PathNotFoundError):
        best_flow.resolve_run(str(tmp_path / "half"))
    with pytest.raises(SceneError):
        best_flow.resolve_run("")


@pytest.mark.parametrize(
    ("order", "values", "exact"),
    [
        (["raw", "otsu"], {"rungs": ["raw", "otsu"]}, True),
        (
            ["raw", "multiscale@2", "pipeline@denoise+binarize"],
            {
                "rungs": ["raw", "multiscale", "pipeline"],
                "scales": [2.0],
                "pipelines": [["denoise", "binarize"]],
            },
            True,
        ),
        # 多尺度的兩個倍率被其他方法隔開：設定只能把它們併在一起
        (
            ["raw", "multiscale@2", "otsu", "multiscale@0.5"],
            {"rungs": ["raw", "multiscale", "otsu"], "scales": [2.0, 0.5]},
            False,
        ),
    ],
)
def test_ladder_export(order, values, exact):
    out = best_flow.ladder_export(order)
    assert out == {"class": "LadderConfig", "values": values, "exact": exact}


def test_criteria_of():
    c = best_flow.criteria_of(0, 0, 0)
    assert (c.min_gain, c.max_new_wrong, c.max_mean_ms) == (1, 0, None)
    assert best_flow.criteria_of(3, 1, 20.0).max_mean_ms == 20.0
    with pytest.raises(SceneError):
        best_flow.criteria_of(0, -1, 0)


def test_scheme_filename_truth_is_manual(e1_dir, dataset):
    """規則化檔名中的條碼（條碼機掃描過）直接當作人工確認的真值，包括讀不到的圖片。"""
    img = read_image(next(dataset.rglob("*clean*.png")))
    code = "4710088410108"
    done = _run(
        uploads=[
            (f"food_b01_001_{code}.jpg", img),
            ("food_b01_002_nocode.jpg", img),
            ("food_b01_003.jpg", img),
        ]
    )
    out = best_flow.run_json(done["name"], CRITERIA)
    assert out["meta"]["truth_from_names"] == 2
    applied = {i["id"]: i["applied"] for i in out["images"]}
    assert applied[f"food_b01_001_{code}.jpg"] == {"truth": code, "source": "manual"}
    assert applied["food_b01_002_nocode.jpg"] == {"truth": "", "source": "manual"}
    assert applied["food_b01_003.jpg"] is None or applied["food_b01_003.jpg"]["source"] == "auto"
