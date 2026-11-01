import json

import numpy as np
import pytest

from dietai.evaluation import (
    SplitLockedError,
    grouping_columns,
    read_image,
    read_manifest,
    write_image,
    write_manifest,
)
from dietai.synthetic import VARIANT_CONDITIONS, label_scene, write_variant_dataset
from dietai.synthetic.variants import limit_side, source_seed


def _sources(tmp_path, rows=None, size=(300, 400)):
    rows = rows or [
        {"id": "p1", "image": "p1.png", "truth": "4710088410108", "split": "dev", "lighting": "in"},
        {
            "id": "p2",
            "image": "p2.png",
            "truth": "4712612300015",
            "split": "test",
            "lighting": "out",
        },
    ]
    img = label_scene(*size, seed=2)
    for r in rows:
        write_image(tmp_path / "src" / r["image"], img)
    return write_manifest(tmp_path / "src" / "sources.csv", rows, ("lighting",))


def test_writes_every_condition_level_with_source_id(tmp_path):
    sources = read_manifest(_sources(tmp_path), include_test=True)
    out = write_variant_dataset(sources, tmp_path / "out", conditions=["blur", "jpeg"])
    per_source = 1 + len(VARIANT_CONDITIONS["blur"].levels) + len(VARIANT_CONDITIONS["jpeg"].levels)

    full = read_manifest(out, include_test=True)
    assert full.tag_columns == ("source_id", "condition", "level", "seed", "lighting")
    assert len(full.items) == 2 * per_source
    assert all(i.image.is_file() for i in full.items)
    by_source = {i.tags["source_id"] for i in full.items}
    assert by_source == {"p1", "p2"}
    # 變體照抄原圖的真值、split 與標籤；測試集的變體放在 splits/test 下
    p2 = [i for i in full.items if i.tags["source_id"] == "p2"]
    assert {(i.truth, i.split, i.tags["lighting"]) for i in p2} == {
        ("4712612300015", "test", "out")
    }
    assert all("splits/test" in i.image.as_posix() for i in p2)
    first = full.items[0]
    assert (first.id, first.tags["condition"], first.tags["level"]) == ("p1__clean_0", "clean", "0")
    assert first.tags["seed"] == str(source_seed("p1", 0))
    # 預設讀取時測試集的變體一律排除（規則 7）
    dev = read_manifest(out)
    assert dev.excluded_test == per_source and len(dev.items) == per_source
    assert grouping_columns(dev.tag_columns) == ("condition", "level", "lighting")

    params = json.loads(out.with_suffix(".json").read_text(encoding="utf-8"))
    assert params["sources"]["sha256"] == sources.sha256
    assert list(params["conditions"]) == ["blur", "jpeg"]
    assert params["conditions"]["jpeg"]["levels"] == [90.0, 70.0, 50.0, 30.0]


def test_variants_are_reproducible_and_independent_of_order(tmp_path):
    path = _sources(tmp_path)
    sources = read_manifest(path, include_test=True)
    a = write_variant_dataset(sources, tmp_path / "a", conditions=["motion", "salt_pepper"])
    b = write_variant_dataset(sources, tmp_path / "b", conditions=["motion", "salt_pepper"])
    assert read_manifest(a, include_test=True).sha256 == read_manifest(b, include_test=True).sha256
    rel = "splits/dev/p1/salt_pepper_0.03.png"
    np.testing.assert_array_equal(read_image(a.parent / rel), read_image(b.parent / rel))
    # 只留 p1 時 p1 的變體不變（種子由 source_id 決定，與順序無關）
    only = tmp_path / "only"
    only.mkdir()
    rows = [{"id": "p1", "image": "p1.png", "truth": "4710088410108", "split": "dev"}]
    single = read_manifest(_sources(only, rows))
    c = write_variant_dataset(single, tmp_path / "c", conditions=["salt_pepper"])
    np.testing.assert_array_equal(read_image(a.parent / rel), read_image(c.parent / rel))
    # 換整體種子則不同
    d = write_variant_dataset(single, tmp_path / "d", conditions=["salt_pepper"], seed=1)
    assert not np.array_equal(read_image(a.parent / rel), read_image(d.parent / rel))


def test_limit_side(tmp_path):
    img = np.zeros((300, 400, 3), dtype=np.uint8)
    assert limit_side(img, 200).shape == (150, 200, 3)
    assert limit_side(img, 1000) is img and limit_side(img, None) is img
    sources = read_manifest(_sources(tmp_path))
    out = write_variant_dataset(sources, tmp_path / "out", conditions=[], max_side=100)
    (clean,) = read_manifest(out).items
    assert read_image(clean.image).shape[:2] == (75, 100)


def test_rejects_bad_input(tmp_path):
    sources = read_manifest(_sources(tmp_path))
    with pytest.raises(ValueError, match="沒有這些劣化條件"):
        write_variant_dataset(sources, tmp_path / "o1", conditions=["nope"])
    busy = tmp_path / "busy"
    busy.mkdir()
    (busy / "x").write_text("x")
    with pytest.raises(FileExistsError):
        write_variant_dataset(sources, busy, conditions=[])
    rows = [{"id": "u", "image": "u.png", "truth": "1", "split": ""}]
    unsplit = tmp_path / "unsplit"
    unsplit.mkdir()
    with pytest.raises(ValueError, match="沒有 split"):
        write_variant_dataset(read_manifest(_sources(unsplit, rows)), tmp_path / "o2")
    # 原圖 manifest 本身位於 splits/test 時，未明示正式實驗就讀不到
    locked = tmp_path / "data" / "splits" / "test"
    locked.mkdir(parents=True)
    with pytest.raises(SplitLockedError):
        read_manifest(_sources(locked, rows))


def test_every_condition_runs():
    img = label_scene(120, 160, seed=1)
    for name, cond in VARIANT_CONDITIONS.items():
        for level in cond.levels:
            out = cond.fn(img, level, 7)
            assert out.dtype == np.uint8 and out.ndim == 3, name
