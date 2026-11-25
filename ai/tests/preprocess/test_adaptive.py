"""品質量測值與規則式自適應策略（設計 6.7 節）。"""

import json

import numpy as np
import pytest

from dietai.preprocess import (
    FEATURE_NAMES,
    AdaptivePolicy,
    Rule,
    load_policy,
    measure_features,
    save_policy,
)
from dietai.preprocess.adaptive import rule_coverage
from dietai.synthetic import (
    add_glare,
    brightness_gradient,
    downscale,
    ean13_scene,
    gaussian_blur,
    reduce_contrast,
    rotate,
    salt_pepper,
)


@pytest.fixture(scope="module")
def scene():
    return ean13_scene()


def test_features_respond_to_their_degradation(scene):
    base = measure_features(scene)
    assert set(FEATURE_NAMES) <= set(base.as_dict()) and base.measure_ms > 0
    assert measure_features(gaussian_blur(scene, 3)).blur < base.blur / 10
    assert measure_features(salt_pepper(scene, 0.05)).impulse_ratio > 10 * base.impulse_ratio
    assert measure_features(reduce_contrast(scene, 0.3)).contrast < base.contrast / 2
    assert measure_features(brightness_gradient(scene, 0.7)).illumination > 2 * base.illumination
    assert measure_features(rotate(scene, 15)).skew > 10 > base.skew
    assert measure_features(add_glare(scene, 0.25)).glare_ratio > 0.05 > base.glare_ratio
    assert measure_features(downscale(scene, 0.3)).short_side == round(scene.shape[0] * 0.3)


def test_features_are_deterministic_and_accept_gray(scene):
    a, b = measure_features(scene), measure_features(scene)
    assert {k: v for k, v in a.as_dict().items() if k != "measure_ms"} == {
        k: v for k, v in b.as_dict().items() if k != "measure_ms"
    }
    gray = np.ascontiguousarray(scene[..., 0])
    assert measure_features(gray).short_side == scene.shape[0]


def _policy(**kw):
    rules = (
        Rule("skew", ">", 5, ("deskew",)),
        Rule("contrast", "<", 60, ("clahe", "binarize")),
        Rule("blur", "<", 100, ("sharpen", "deskew")),
    )
    return AdaptivePolicy(rules, fallback=("multiscale@2",), **kw)


def test_plan_orders_triggered_rules_then_fallback():
    policy = _policy()
    clean = {"skew": 0.0, "contrast": 200.0, "blur": 900.0}
    assert policy.plan(clean) == ("raw", "multiscale@2")
    bad = {"skew": 12.0, "contrast": 30.0, "blur": 20.0}
    # 依規則順序、去除重複（deskew 只出現一次），取前 max_attempts 個
    assert policy.plan(bad) == ("raw", "deskew", "clahe", "binarize")
    assert _policy(max_attempts=6).plan(bad) == (
        "raw",
        "deskew",
        "clahe",
        "binarize",
        "sharpen",
        "multiscale@2",
    )
    assert [r.feature for r in policy.triggered(bad)] == ["skew", "contrast", "blur"]
    assert policy.methods() == ("raw", "deskew", "clahe", "binarize", "sharpen", "multiscale@2")
    cov = rule_coverage(policy, [clean, bad])
    assert [c["hits"] for c in cov] == [1, 1, 1] and cov[0]["rate"] == 0.5


def test_rule_and_policy_validation():
    with pytest.raises(ValueError, match="未知的量測值"):
        Rule("sharpness", "<", 1, ("x",))
    with pytest.raises(ValueError, match="op"):
        Rule("blur", "<=", 1, ("x",))
    with pytest.raises(ValueError, match="methods"):
        Rule("blur", "<", 1, ())
    with pytest.raises(ValueError, match="max_attempts"):
        AdaptivePolicy((), start=("raw", "gray"), max_attempts=1)
    assert Rule("blur", "<", 100, ("x",)).describe() == "blur < 100 → x"


def test_policy_json_roundtrip(tmp_path):
    policy = _policy()
    tuned = policy.with_threshold(1, 75.5)
    assert tuned.rules[1].threshold == 75.5 and policy.rules[1].threshold == 60
    path = save_policy(tuned, tmp_path / "p.json", {"steps": [1, 2]})
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["steps"] == [1, 2]
    loaded = load_policy(path)
    assert loaded.rules == tuned.rules and loaded.name == "p"  # 沒有名稱時用檔名
    with pytest.raises(ValueError, match="規則格式"):
        AdaptivePolicy.from_dict({"rules": [{"feature": "blur"}]})


@pytest.mark.parametrize(
    "data",
    [
        {"rules": [], "start": "raw"},  # 字串會被拆成 ('r','a','w')
        {"rules": [], "fallback": "clahe"},
        {"rules": [{"feature": "blur", "op": "<", "threshold": 1, "methods": "clahe"}]},
        {"rules": [{"feature": "blur", "op": "<", "threshold": 1, "methods": ["clahe", 3]}]},
        {"rules": [], "start": ["raw", ""]},
        {"rules": [], "start": 5},
        {"rules": [], "max_attempts": None},
        {"rules": None},
        [],  # 最外層不是物件
    ],
)
def test_from_dict_rejects_malformed_policy_with_value_error(data):
    with pytest.raises(ValueError):
        AdaptivePolicy.from_dict(data)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_rule_rejects_non_finite_threshold(bad):
    with pytest.raises(ValueError, match="threshold"):
        Rule("blur", "<", bad, ("x",))
    # json 讀得進 NaN，從檔案載入也要擋下
    with pytest.raises(ValueError, match="threshold"):
        AdaptivePolicy.from_dict(
            json.loads(
                '{"rules": [{"feature": "blur", "op": "<", "threshold": NaN, "methods": ["x"]}]}'
            )
        )
    with pytest.raises(ValueError, match="threshold"):
        _policy().with_threshold(0, bad)
