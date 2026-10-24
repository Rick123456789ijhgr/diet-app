"""dietai.devtools 的單元測試：設定覆寫驗證、表單結構、暫存區、合成場景、診斷檢視。"""

import json

import numpy as np
import pytest

from dietai.devtools.configs import ConfigError, config_from_override
from dietai.devtools.degradations import Degradation
from dietai.devtools.scenes import SceneError, synthesize
from dietai.devtools.schema import SCHEMA_CLASSES, config_schemas
from dietai.devtools.store import ImageNotFoundError, ImageStore
from dietai.devtools.views import gray_histogram_counts
from dietai.preprocess import LadderConfig, QualityConfig


@pytest.mark.parametrize("override", [None, "", "{}", {}])
def test_override_empty_means_defaults(override):
    assert config_from_override(QualityConfig, override) == QualityConfig()


def test_override_converts_int_to_float_field():
    cfg = config_from_override(QualityConfig, '{"blur_min": 150}')
    assert cfg.blur_min == 150.0
    assert isinstance(cfg.blur_min, float)


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ('{"nope": 1}', "nope"),
        ('{"blur_min": "x"}', "blur_min"),
        ('{"min_short_side": true}', "min_short_side"),  # bool 不當成 int
        ('{"min_short_side": 1.5}', "min_short_side"),
        ('{"dark_level": 250}', "dark_level"),  # __post_init__：dark_level <= bright_level
        ("[1, 2]", None),
        ("{bad json", None),
    ],
)
def test_override_errors_name_the_field(override, field):
    with pytest.raises(ConfigError) as info:
        config_from_override(QualityConfig, override)
    assert info.value.field == field


def test_override_accepts_sequence_fields():
    cfg = config_from_override(LadderConfig, {"rungs": ["raw", "gray"], "scales": [2]})
    assert [r.value for r in cfg.rungs] == ["raw", "gray"]
    assert cfg.scales == (2.0,)


def test_schema_covers_every_param_field_and_is_json():
    schemas = config_schemas()
    json.dumps(schemas)  # 可直接序列化
    by_name = {c["name"]: c for c in schemas["classes"]}
    assert set(by_name) == {cls.__name__ for cls in SCHEMA_CLASSES}
    quality = {f["name"]: f for f in by_name["QualityConfig"]["fields"]}
    assert quality["blur_min"] == {
        "name": "blur_min",
        "type": "float",
        "default": 100.0,
        "label": "模糊下限",
        "label_en": "Blur min",
        "help": "拉普拉斯變異數低於此值視為過於模糊。",
        "calibrate": True,
        "group": "blur",
        "min": 0.0,
        "max": 2000.0,
        "step": 5.0,
    }
    # 序列欄位不產生表單，但預設值仍提供
    ladder = by_name["LadderConfig"]
    assert "rungs" not in {f["name"] for f in ladder["fields"]}
    assert ladder["defaults"]["rungs"][0] == "raw"
    assert "TOO_BLURRY" in schemas["enums"]["PreprocessWarning"]
    assert {f["name"] for f in by_name["Degradation"]["fields"]} >= {"blur_sigma", "seed"}


def test_degradation_rejects_invalid_values():
    with pytest.raises(ValueError):
        Degradation(scale=0)
    with pytest.raises(ValueError):
        Degradation(blur_sigma=-1)


def _img(h=10, w=10):
    return np.zeros((h, w, 3), dtype=np.uint8)


def test_store_put_get_and_unknown_id():
    store = ImageStore()
    item = store.put(_img(), "測試")
    assert store.get(item.image_id) is item
    with pytest.raises(ImageNotFoundError):
        store.get("missing")


def test_store_evicts_least_recently_used_by_count():
    store = ImageStore(max_items=2)
    a = store.put(_img(), "a")
    b = store.put(_img(), "b")
    store.get(a.image_id)  # a 變成最近使用
    store.put(_img(), "c")
    assert len(store) == 2
    store.get(a.image_id)
    with pytest.raises(ImageNotFoundError):
        store.get(b.image_id)


def test_store_evicts_by_bytes_but_keeps_newest():
    store = ImageStore(max_bytes=500)
    store.put(_img(), "300 bytes")
    big = store.put(_img(20, 20), "1200 bytes")
    assert len(store) == 1
    assert store.get(big.image_id) is big


def test_store_derived_cache_follows_source_eviction():
    store = ImageStore(max_items=3)
    src = store.put(_img(), "src")
    d = store.put_derived(src.image_id, "k", _img(), "derived")
    assert store.derived(src.image_id, "k") is d
    assert store.derived(src.image_id, "other") is None
    for _ in range(3):
        store.put(_img(), "filler")
    assert store.derived(src.image_id, "k") is None


def test_store_detached_derived_survives_eviction_pass():
    # 來源鍵不是暫存影像 ID（如條碼掃描縮圖）：之後再存入其他影像、觸發淘汰檢查，對應仍在
    store = ImageStore(max_items=3)
    d = store.put_derived("barcode-sweep:1:3:0", "k", _img(), "thumb", detached=True)
    store.put(_img(), "other")
    assert store.derived("barcode-sweep:1:3:0", "k") is d
    # 衍生影像本身被淘汰後，對應一併清掉
    for _ in range(3):
        store.put(_img(), "filler")
    assert store.derived("barcode-sweep:1:3:0", "k") is None
    assert not store._detached


def test_store_encodes_jpeg_once():
    store = ImageStore()
    item = store.put(_img(), "x")
    data, content_type = store.encoded(item.image_id)
    assert content_type == "image/jpeg"
    assert data[:2] == b"\xff\xd8"
    assert store.encoded(item.image_id)[0] is data


@pytest.mark.parametrize("scene", ["label", "ean13", "invoice", "nutrition", "food"])
def test_synthesize_every_scene(scene):
    result = synthesize(scene, {})
    assert result.image.dtype == np.uint8
    assert result.description


def test_synthesize_truth():
    assert len(synthesize("nutrition", {"seed": 1}).truth["quad"]) == 4
    assert synthesize("ean13", {}).truth["format"] == "EAN13"
    assert synthesize("label", {"height": 64, "width": 96}).image.shape == (64, 96, 3)


@pytest.mark.parametrize(
    ("scene", "params", "field"),
    [
        ("nope", {}, "scene"),
        ("label", {"nope": 1}, "nope"),
        ("invoice", {"left": "中文", "encoding": "ascii"}, "encoding"),
    ],
)
def test_synthesize_errors(scene, params, field):
    with pytest.raises(SceneError) as info:
        synthesize(scene, params)
    assert info.value.field == field


def test_histogram_counts_every_pixel():
    img = np.zeros((4, 5, 3), dtype=np.uint8)
    img[0, 0] = 255
    counts = gray_histogram_counts(img)
    assert len(counts) == 256
    assert counts[0] == 19 and counts[255] == 1


def test_store_encodes_lazily_and_counts_encoded_bytes():
    store = ImageStore()
    calls = []

    def encode():
        calls.append(1)
        return b"x" * 1000, "image/png"

    item = store.put(_img(), "x", encode=encode, meta={"k": 1})
    assert calls == []  # 存入時不編碼
    before = store.total_bytes
    assert store.encoded(item.image_id) == (b"x" * 1000, "image/png")
    assert store.encoded(item.image_id)[1] == "image/png"
    assert calls == [1]  # 只編一次
    assert store.total_bytes == before + 1000  # 編碼後的檔案計入記憶體上限
    assert item.meta == {"k": 1}


def test_glare_overlay_matches_label_pipeline():
    from dataclasses import replace

    from dietai.devtools.views import glare_overlay, mask_overlay
    from dietai.preprocess import LabelConfig, preprocess_label
    from dietai.synthetic import add_glare, label_perspective_scene

    img, _ = label_perspective_scene(seed=2)
    img = add_glare(img, 0.15, seed=1)
    cfg = LabelConfig()
    full = preprocess_label(img, cfg)
    assert full.glare is not None
    before = preprocess_label(img, replace(cfg, enable_glare=False, enable_contrast=False)).image
    overlay, ratio = glare_overlay(img, cfg)
    assert ratio == pytest.approx(full.glare.ratio)
    np.testing.assert_array_equal(overlay, mask_overlay(before, full.glare.mask))
    assert glare_overlay(img, replace(cfg, enable_glare=False)) is None
