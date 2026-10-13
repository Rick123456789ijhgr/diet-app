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
from dietai.synthetic import label_scene
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


def test_unimplemented_preprocess_rpc(pre):
    with pytest.raises(grpc.RpcError) as exc:
        pre.DecodeBarcode(preprocess_pb2.DecodeBarcodeRequest())
    assert exc.value.code() == grpc.StatusCode.UNIMPLEMENTED


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
    with pytest.raises(grpc.RpcError) as exc:
        _view(wb, uploaded.image_id, "glare_mask")
    assert exc.value.code() == grpc.StatusCode.UNIMPLEMENTED


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
