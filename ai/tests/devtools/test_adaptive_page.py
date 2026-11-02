"""工作台自適應頁的後端：「每個方法都執行」的資料夾經 e1.run_json 回傳自適應策略的結果。"""

import json

import pytest

from dietai.devtools import adaptive, e1
from dietai.devtools.images import SplitLockedError
from dietai.evaluation import (
    load_arm,
    read_manifest,
    run_methods,
    write_features,
)
from dietai.evaluation.adaptive import measure_manifest
from dietai.synthetic import write_barcode_dataset


@pytest.fixture(scope="module")
def methods_run(tmp_path_factory):
    """一個條碼的合成資料，以 c0_all_methods 執行所有方法並量測品質。"""
    tmp = tmp_path_factory.mktemp("adaptive")
    manifest = read_manifest(write_barcode_dataset(tmp / "data", n_codes=1))
    arm = load_arm(e1.E1_DIR / "configs" / "c0_all_methods.json")
    out = tmp / "runs" / "20261103-000000_m"
    run_methods(manifest, [arm], out)
    write_features(out / "features.csv", measure_manifest(manifest))
    return out


def test_methods_run_returns_adaptive_json(methods_run):
    listed = e1.list_runs_json(str(methods_run.parent))
    assert listed["runs"] == []  # 逐步升級的清單不列出
    assert listed["method_runs"] == [
        {"name": methods_run.name, "path": str(methods_run), "features": True}
    ]
    data = e1.run_json(str(methods_run))
    json.dumps(data)  # 可序列化
    assert (data["mode"], data["features_ready"]) == ("methods", True)
    (arm,) = data["arms"]
    assert arm["arm"] == "c0_all_methods" and "pipeline@denoise+binarize" in arm["methods"]
    assert arm["baseline"]["name"] == "greedy" and arm["baseline"]["order"][0] == "raw"
    policy = next(p for p in arm["policies"] if p["name"] == "r0_default")
    assert policy["source"] == "config" and "error" not in policy
    # 比較表依序為基準與策略；規則附成立次數；每個變體一列並附量測值
    assert [r["arm"] for r in policy["overall"]] == ["greedy", "r0_default"]
    assert {"hits", "rate", "threshold"} <= set(policy["rules"][0])
    assert sum(p["count"] for p in policy["plans"]) == len(policy["variants"])
    first = policy["variants"][0]
    assert {"plan", "rules", "elapsed_ms", "blur", "condition"} <= set(first)
    assert set(arm["bins"]) == set(data["feature_names"])


def test_tuned_policy_in_run_folder_is_listed(methods_run, tmp_path):
    policy = json.loads((adaptive.POLICY_DIR / "r0_default.json").read_text(encoding="utf-8"))
    policy["name"] = "r0_tuned"
    path = methods_run / "policy_r0_tuned.json"
    path.write_text(json.dumps(policy), encoding="utf-8")
    bad = methods_run / "policy_broken.json"
    bad.write_text("{", encoding="utf-8")
    try:
        names = [
            (p["name"], p["source"]) for p in e1.run_json(str(methods_run))["arms"][0]["policies"]
        ]
    finally:
        path.unlink()
        bad.unlink()
    assert ("r0_tuned", "run") in names and ("r0_default", "config") in names
    assert len(names) == len(list(adaptive.POLICY_DIR.glob("*.json"))) + 1  # 壞檔略過


def test_without_features_reports_command(methods_run):
    features = methods_run / "features.csv"
    backup = features.read_bytes()
    features.unlink()
    try:
        data = e1.run_json(str(methods_run))
    finally:
        features.write_bytes(backup)
    assert data["features_ready"] is False and data["arms"] == []
    assert "adaptive.py" in data["command"]


def test_policy_with_missing_methods_reports_error(methods_run, monkeypatch, tmp_path):
    (tmp_path / "x.json").write_text(
        json.dumps(
            {"rules": [{"feature": "blur", "op": "<", "threshold": 1, "methods": ["nope"]}]}
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(adaptive, "POLICY_DIR", tmp_path)
    (policy,) = e1.run_json(str(methods_run))["arms"][0]["policies"]
    assert policy["name"] == "x" and "nope" in policy["error"]


def test_test_split_is_locked(tmp_path):
    with pytest.raises(SplitLockedError):
        e1.run_json(str(tmp_path / "splits" / "test" / "run"))
