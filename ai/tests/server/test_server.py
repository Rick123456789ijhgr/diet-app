"""gRPC 服務測試：以真實連線呼叫 PreprocessService 與 WorkbenchService。"""

from __future__ import annotations

import json
import time

import grpc
import pytest
from google.rpc import error_details_pb2
from grpc_health.v1 import health_pb2, health_pb2_grpc
from grpc_status import rpc_status

from dietai.devtools.images import encode_png
from dietai.preprocess import QualityConfig, check_quality
from dietai.synthetic import label_perspective_scene, label_scene
from dietai.v1 import preprocess_pb2, preprocess_pb2_grpc, workbench_pb2, workbench_pb2_grpc

SMALL = label_scene(240, 320, seed=1)


def _expect_error(call, code: grpc.StatusCode, reason: str, field: str | None = None) -> None:
    with pytest.raises(grpc.RpcError) as exc:
        call()
    assert exc.value.code() == code
    status = rpc_status.from_call(exc.value)
    assert status is not None
    info = error_details_pb2.ErrorInfo()
    assert status.details[0].Unpack(info)
    assert info.reason == reason
    assert info.domain == "dietai"
    assert info.metadata.get("field") == field


@pytest.fixture(scope="module")
def wb(dev_server):
    return workbench_pb2_grpc.WorkbenchServiceStub(dev_server.channel)


@pytest.fixture(scope="module")
def pre(dev_server):
    return preprocess_pb2_grpc.PreprocessServiceStub(dev_server.channel)


@pytest.fixture(scope="module")
def uploaded(wb) -> workbench_pb2.ImageRef:
    resp = wb.PutImage(workbench_pb2.PutImageRequest(encoded=encode_png(SMALL), name="small.png"))
    return resp.image


def _quality(pre, image_id: str, config: dict | None = None):
    return pre.CheckQuality(
        preprocess_pb2.CheckQualityRequest(
            image=preprocess_pb2.ImageInput(image_id=image_id),
            config=preprocess_pb2.ConfigOverride(json=json.dumps(config) if config else ""),
        )
    )


def _degrade(wb, image_id: str, d: dict) -> workbench_pb2.ImageRef:
    req = workbench_pb2.DegradeRequest(image_id=image_id, degradation_json=json.dumps(d))
    return wb.Degrade(req).image


def _view(wb, image_id: str, view: str):
    return wb.RenderView(workbench_pb2.RenderViewRequest(image_id=image_id, view=view))


def test_health_reports_both_services(dev_server):
    stub = health_pb2_grpc.HealthStub(dev_server.channel)
    for name in ("", "dietai.v1.PreprocessService", "dietai.v1.WorkbenchService"):
        resp = stub.Check(health_pb2.HealthCheckRequest(service=name))
        assert resp.status == health_pb2.HealthCheckResponse.SERVING


def test_put_image(uploaded):
    assert (uploaded.width, uploaded.height) == (320, 240)
    assert uploaded.description == "small.png"
    assert uploaded.truth_json == ""


def test_put_image_rejects_garbage(wb):
    _expect_error(
        lambda: wb.PutImage(workbench_pb2.PutImageRequest(encoded=b"not an image")),
        grpc.StatusCode.INVALID_ARGUMENT,
        "IMAGE_DECODE_FAILED",
        "encoded",
    )


def test_check_quality_matches_library(pre, uploaded):
    resp = _quality(pre, uploaded.image_id, {"blur_min": 5000})
    expected = check_quality(SMALL, QualityConfig(blur_min=5000.0))
    assert resp.blur_score == pytest.approx(expected.blur_score)
    assert resp.dark_ratio == pytest.approx(expected.exposure.dark_ratio)
    assert list(resp.warnings) == [w.value for w in expected.warnings]
    assert "TOO_BLURRY" in resp.warnings
    assert resp.passed is False
    assert [s.name for s in resp.steps] == [s.name for s in expected.steps]
    assert json.loads(resp.steps[1].params_json) == {"blur_short_side": 480, "blur_min": 5000.0}


def test_check_quality_with_encoded_image(pre):
    req = preprocess_pb2.CheckQualityRequest(
        image=preprocess_pb2.ImageInput(encoded=encode_png(SMALL))
    )
    assert pre.CheckQuality(req).blur_score == pytest.approx(check_quality(SMALL).blur_score)


def test_check_quality_errors(pre, uploaded):
    _expect_error(
        lambda: _quality(pre, uploaded.image_id, {"blur_min": "high"}),
        grpc.StatusCode.INVALID_ARGUMENT,
        "INVALID_CONFIG",
        "blur_min",
    )
    _expect_error(lambda: _quality(pre, "missing"), grpc.StatusCode.NOT_FOUND, "IMAGE_NOT_FOUND")
    _expect_error(
        lambda: pre.CheckQuality(preprocess_pb2.CheckQualityRequest()),
        grpc.StatusCode.INVALID_ARGUMENT,
        "IMAGE_REQUIRED",
        "image",
    )


def test_config_schemas(wb):
    data = json.loads(wb.GetConfigSchemas(workbench_pb2.GetConfigSchemasRequest()).json)
    names = [c["name"] for c in data["classes"]]
    assert "QualityConfig" in names
    assert "Degradation" in names


def test_synthesize_keeps_truth(wb):
    req = workbench_pb2.SynthesizeRequest(scene="nutrition", params_json='{"seed": 2}')
    assert len(json.loads(wb.Synthesize(req).image.truth_json)["quad"]) == 4
    _expect_error(
        lambda: wb.Synthesize(workbench_pb2.SynthesizeRequest(scene="moon")),
        grpc.StatusCode.INVALID_ARGUMENT,
        "INVALID_PARAMS",
        "scene",
    )


def test_degrade_caches_results(wb, uploaded):
    assert _degrade(wb, uploaded.image_id, {}).image_id == uploaded.image_id  # 沒有退化
    blurred = _degrade(wb, uploaded.image_id, {"blur_sigma": 3})
    assert blurred.image_id != uploaded.image_id
    assert "退化 1 項" in blurred.description
    # 同樣的參數（3 與 3.0）直接重用
    assert _degrade(wb, uploaded.image_id, {"blur_sigma": 3.0}).image_id == blurred.image_id
    _expect_error(
        lambda: _degrade(wb, uploaded.image_id, {"scale": 0}),
        grpc.StatusCode.INVALID_ARGUMENT,
        "INVALID_CONFIG",
        "scale",
    )


def test_degrade_keeps_truth_only_without_geometry_change(wb):
    food = wb.Synthesize(workbench_pb2.SynthesizeRequest(scene="food")).image
    assert _degrade(wb, food.image_id, {"gain": 0.5}).truth_json == food.truth_json
    assert _degrade(wb, food.image_id, {"scale": 0.5}).truth_json == ""


def test_render_views_and_artifact(wb, uploaded):
    hist = _view(wb, uploaded.image_id, "histogram")
    assert sum(json.loads(hist.data_json)["counts"]) == 320 * 240
    assert not hist.HasField("image")

    lap = _view(wb, uploaded.image_id, "laplacian").image
    assert _view(wb, uploaded.image_id, "laplacian").image.image_id == lap.image_id  # 快取
    art = wb.GetArtifact(workbench_pb2.GetArtifactRequest(id=lap.image_id))
    assert art.content_type == "image/jpeg"
    assert art.encoded[:2] == b"\xff\xd8"

    _expect_error(
        lambda: _view(wb, uploaded.image_id, "nope"),
        grpc.StatusCode.INVALID_ARGUMENT,
        "INVALID_PARAMS",
        "view",
    )


def test_prod_mode_has_no_workbench(prod_server):
    wb = workbench_pb2_grpc.WorkbenchServiceStub(prod_server.channel)
    with pytest.raises(grpc.RpcError) as exc:
        wb.GetConfigSchemas(workbench_pb2.GetConfigSchemasRequest())
    assert exc.value.code() == grpc.StatusCode.UNIMPLEMENTED
    pre = preprocess_pb2_grpc.PreprocessServiceStub(prod_server.channel)
    _expect_error(
        lambda: _quality(pre, "anything"),
        grpc.StatusCode.FAILED_PRECONDITION,
        "DEV_TOOLS_DISABLED",
    )


@pytest.mark.slow
def test_tuning_round_trip_is_fast(wb, pre):
    """1080p 合成影像調參一次（退化＋品質檢查）的 Python 端耗時。

    ADR 0003 的目標 200 ms 含 Go 與前端，Python 端須留足餘裕。
    """
    base = wb.Synthesize(workbench_pb2.SynthesizeRequest(scene="label")).image
    timings = []
    for sigma in (1.0, 1.5, 2.0, 2.5, 3.0):
        start = time.perf_counter()
        ref = _degrade(wb, base.image_id, {"blur_sigma": sigma})
        _quality(pre, ref.image_id)
        timings.append((time.perf_counter() - start) * 1000)
    assert sorted(timings)[len(timings) // 2] < 150, timings


def _synth(wb, scene: str, params: dict | None = None) -> workbench_pb2.ImageRef:
    req = workbench_pb2.SynthesizeRequest(scene=scene, params_json=json.dumps(params or {}))
    return wb.Synthesize(req).image


def _by_id(image_id: str) -> preprocess_pb2.ImageInput:
    return preprocess_pb2.ImageInput(image_id=image_id)


def test_decode_barcode_ladder(wb, pre):
    ref = _synth(wb, "ean13", {"code": "4710088410108"})
    resp = pre.DecodeBarcode(preprocess_pb2.DecodeBarcodeRequest(image=_by_id(ref.image_id)))
    assert resp.success
    assert resp.success_index >= 0
    assert resp.hits[0].text == "4710088410108"
    assert resp.hits[0].format == "EAN13"
    assert len(resp.hits[0].corners) == 4
    assert resp.attempts[resp.success_index].rung == resp.success_rung

    # 只用原圖（E1 的對照組）：rungs 由覆寫指定
    only_raw = preprocess_pb2.DecodeBarcodeRequest(
        image=_by_id(ref.image_id), ladder=preprocess_pb2.ConfigOverride(json='{"rungs": ["raw"]}')
    )
    assert [a.rung for a in pre.DecodeBarcode(only_raw).attempts] == ["raw"]


def test_decode_barcode_failure_keeps_index_negative(wb, pre):
    ref = _synth(wb, "label", {"height": 120, "width": 160})
    resp = pre.DecodeBarcode(preprocess_pb2.DecodeBarcodeRequest(image=_by_id(ref.image_id)))
    assert not resp.success
    assert resp.success_index == -1
    assert "BARCODE_NOT_FOUND" in resp.warnings


def test_locate_invoice_qr_keeps_raw_bytes(wb, pre):
    ref = _synth(wb, "invoice")
    truth = json.loads(ref.truth_json)
    resp = pre.LocateInvoiceQr(preprocess_pb2.LocateInvoiceQrRequest(image=_by_id(ref.image_id)))
    assert resp.HasField("left") and resp.HasField("right")
    # 中文以 Big5 位元組原樣傳回，由 Go 解碼
    assert resp.left.raw == truth["left"].encode("big5")
    assert resp.right.raw == truth["right"].encode("big5")


def test_preprocess_label_outputs_artifact_once(wb, pre):
    ref = _synth(wb, "nutrition", {"seed": 3})
    req = preprocess_pb2.PreprocessLabelRequest(image=_by_id(ref.image_id))
    first = pre.PreprocessLabel(req)
    assert len(first.quad) == 4
    assert first.quad_method in ("contour", "hough")
    assert first.image.WhichOneof("data") == "artifact_id"
    art = wb.GetArtifact(workbench_pb2.GetArtifactRequest(id=first.image.artifact_id))
    assert art.content_type == "image/png"
    # 同一組參數重跑時沿用同一個暫存結果
    assert pre.PreprocessLabel(req).image.artifact_id == first.image.artifact_id
    # 關閉光斑步驟時 glare_ratio 為 -1
    off = preprocess_pb2.PreprocessLabelRequest(
        image=_by_id(ref.image_id),
        config=preprocess_pb2.ConfigOverride(json='{"enable_glare": false}'),
    )
    assert pre.PreprocessLabel(off).glare_ratio == -1


def test_preprocess_food_vlm_bytes_are_exact(wb, pre):
    ref = _synth(wb, "food", {"n_dishes": 2})
    resp = pre.PreprocessFood(preprocess_pb2.PreprocessFoodRequest(image=_by_id(ref.image_id)))
    assert resp.dishes_enabled
    assert len(resp.dishes) == len(resp.crops) >= 1
    whole = wb.GetArtifact(workbench_pb2.GetArtifactRequest(id=resp.whole.image.artifact_id))
    # 前端看到的就是送給 VLM 的 JPEG 原檔
    assert len(whole.encoded) == resp.whole.num_bytes
    assert whole.content_type == "image/jpeg"
    assert len(json.loads(ref.truth_json)["plate_boxes"]) == 2


def test_prod_mode_attaches_outputs(prod_server):
    pre = preprocess_pb2_grpc.PreprocessServiceStub(prod_server.channel)
    img, _ = label_perspective_scene(seed=1)
    req = preprocess_pb2.PreprocessLabelRequest(
        image=preprocess_pb2.ImageInput(encoded=encode_png(img))
    )
    out = pre.PreprocessLabel(req).image
    assert out.WhichOneof("data") == "encoded"
    assert out.encoded[:4] == bytes([0x89]) + b"PNG"


def test_stage2_views(wb):
    ean = _synth(wb, "ean13")

    def view(image_id: str, name: str, config: dict | None = None):
        req = workbench_pb2.RenderViewRequest(
            image_id=image_id, view=name, config_json=json.dumps(config) if config else ""
        )
        return wb.RenderView(req)

    first = view(ean.image_id, "ladder_variant", {"index": 0})
    assert json.loads(first.data_json)["rung"] == "raw"
    assert first.image.width == ean.width
    _expect_error(
        lambda: view(ean.image_id, "ladder_variant", {"index": 5, "ladder": {"rungs": ["raw"]}}),
        grpc.StatusCode.INVALID_ARGUMENT,
        "INVALID_PARAMS",
        "index",
    )
    # 多尺度階依倍率各算一次：raw＋multiscale(2 個倍率) 共 3 次，index 2 存在
    multi = {"rungs": ["raw", "multiscale"], "scales": [2.0, 0.5]}
    third = view(ean.image_id, "ladder_variant", {"index": 2, "ladder": multi})
    assert json.loads(third.data_json)["rung"] == "multiscale"
    # 同樣的請求沿用快取，參數資料一併保留
    again = view(ean.image_id, "ladder_variant", {"index": 2, "ladder": multi})
    assert again.image.image_id == third.image.image_id
    assert again.data_json == third.data_json
    with pytest.raises(grpc.RpcError) as exc:
        view(ean.image_id, "ladder_variant", {"index": 3, "ladder": multi})
    assert "共 3 次" in exc.value.details()

    label = _synth(wb, "nutrition")
    assert view(label.image_id, "label_edges").image.image_id
    glare = view(label.image_id, "glare_mask")
    assert json.loads(glare.data_json)["enabled"] is True
    assert glare.image.image_id
    cached = view(label.image_id, "glare_mask")
    assert cached.image.image_id == glare.image.image_id
    assert cached.data_json == glare.data_json  # 命中快取時光斑比例仍在
    off = view(label.image_id, "glare_mask", {"enable_glare": False})
    assert json.loads(off.data_json) == {"enabled": False}
    assert not off.HasField("image")

    food = _synth(wb, "food")
    assert view(food.image_id, "food_mask").image.height > 0


def test_sweep_quality_and_barcode(wb):
    # 自己上傳：測試伺服器的暫存區只有 16 格，共用的 uploaded 可能已被淘汰
    fresh = wb.PutImage(workbench_pb2.PutImageRequest(encoded=encode_png(SMALL))).image

    def run(target: str, params: dict) -> dict:
        req = workbench_pb2.SweepRequest(target=target, params_json=json.dumps(params))
        return json.loads(wb.Sweep(req).json)

    q = run("quality", {"axis": "blur_sigma", "lo": 0, "hi": 6, "n": 4, "image_id": fresh.image_id})
    assert len(q["rows"]) == 4
    assert "TOO_BLURRY" in q["triggers"]
    thumb = q["thumbs"][0]
    art = wb.GetArtifact(workbench_pb2.GetArtifactRequest(id=thumb["image_id"]))
    assert art.content_type == "image/jpeg"

    b = run("barcode", {"axis": "rotate_deg", "lo": 0, "hi": 45, "n": 3, "samples": 1})
    assert set(b["overall"]) == {"raw", "ladder"}
    assert len(b["thumbs"]) == 3

    _expect_error(
        lambda: run("moon", {}), grpc.StatusCode.INVALID_ARGUMENT, "INVALID_PARAMS", "target"
    )
    _expect_error(
        lambda: run("quality", {"image_id": "missing"}),
        grpc.StatusCode.NOT_FOUND,
        "IMAGE_NOT_FOUND",
    )


def test_run_batch_streams_rows(wb, tmp_path):
    for i in range(2):
        (tmp_path / f"p{i}.png").write_bytes(encode_png(label_scene(500, 600, seed=i)))
    events = [
        json.loads(m.json)
        for m in wb.RunBatch(workbench_pb2.RunBatchRequest(folder=str(tmp_path), limit=10))
    ]
    assert [e["type"] for e in events] == ["start", "row", "row", "summary"]
    assert events[-1]["pass_rate"] == 1.0

    # 單一檔案：影像存進暫存區，可以取得
    single = [
        json.loads(m.json)
        for m in wb.RunBatch(workbench_pb2.RunBatchRequest(folder=str(tmp_path / "p0.png")))
    ]
    image_id = single[1]["image_id"]
    assert wb.GetArtifact(workbench_pb2.GetArtifactRequest(id=image_id)).encoded


def test_run_batch_errors(wb, tmp_path):
    locked = tmp_path / "splits" / "test"
    locked.mkdir(parents=True)
    _expect_error(
        lambda: list(wb.RunBatch(workbench_pb2.RunBatchRequest(folder=str(locked)))),
        grpc.StatusCode.PERMISSION_DENIED,
        "SPLIT_LOCKED",
    )
    _expect_error(
        lambda: list(wb.RunBatch(workbench_pb2.RunBatchRequest(folder=str(tmp_path / "nope")))),
        grpc.StatusCode.NOT_FOUND,
        "PATH_NOT_FOUND",
    )


@pytest.mark.slow
def test_e1_stream_and_results(wb, tmp_path, monkeypatch):
    import shutil

    from dietai.devtools import e1

    root = tmp_path / "e1_barcode"
    shutil.copytree(e1.E1_DIR / "configs", root / "configs")
    monkeypatch.setattr(e1, "E1_DIR", root)
    monkeypatch.setattr(e1, "DEFAULT_ROOT", root / "runs")

    req = workbench_pb2.StartE1RunRequest(arms=["a0_raw"], n_codes=1)
    events = [json.loads(m.json) for m in wb.StartE1Run(req)]
    assert events[0]["type"] == "start" and events[-1]["type"] == "done"

    listed = json.loads(wb.ListE1Runs(workbench_pb2.ListE1RunsRequest()).json)
    assert listed["runs"][0]["name"] == events[-1]["name"]
    run = json.loads(wb.GetE1Run(workbench_pb2.GetE1RunRequest(run_dir=events[-1]["name"])).json)
    assert run["arms"] == ["a0_raw"]
    _expect_error(
        lambda: wb.GetE1Run(workbench_pb2.GetE1RunRequest(run_dir="missing")),
        grpc.StatusCode.NOT_FOUND,
        "PATH_NOT_FOUND",
    )
