"""``LabelService.ParseLabel`` 的 gRPC 測試（假 OCR，不依賴 Tesseract／PaddleOCR）。"""

from __future__ import annotations

import json
import threading
import time
from decimal import Decimal

import grpc
import numpy as np
import pytest
from google.rpc import error_details_pb2
from grpc_health.v1 import health_pb2, health_pb2_grpc
from grpc_status import rpc_status

from dietai.adapters.ocr import LockedOcr
from dietai.devtools.images import encode_png
from dietai.label_parsing import OcrBox
from dietai.server.__main__ import ocr_from_env
from dietai.server.convert import decimal_text
from dietai.v1 import label_pb2, label_pb2_grpc, preprocess_pb2, workbench_pb2, workbench_pb2_grpc

LINES = [
    "營養標示",
    "每一份量 30 公克",
    "本包裝含 6 份",
    "每份 每100公克",
    "熱量 152 大卡 507 大卡",
    "蛋白質 2.10 公克 7.0 公克",
    "脂肪 8.4 公克 28.0 公克",
    "飽和脂肪 3.2 公克 10.7 公克",
    "反式脂肪 0 公克 0 公克",
    "碳水化合物 17.0 公克 56.7 公克",
    "糖 1.5 公克 5.0 公克",
    "鈉 125 毫克 417 毫克",
]
# 前處理全部關閉：輸入是純色影像，只測 RPC 的轉換
RAW = {
    "preprocess": {
        "enable_rectify": False,
        "enable_glare": False,
        "enable_denoise": False,
        "enable_contrast": False,
        "enable_binarize": False,
    }
}
IMAGE = encode_png(np.full((60, 80, 3), 200, dtype=np.uint8))


class FakeOcr:
    """把指定的文字行當成 OCR 結果（每行一個框，由上到下）。"""

    def __init__(self, lines: list[str]) -> None:
        self.lines = lines
        self.name = "fake 1.0"

    def __call__(self, img):
        return [OcrBox(t, 0, 30 * i, 100, 20, 0.9) for i, t in enumerate(self.lines)]


@pytest.fixture
def stub(start_server):
    return label_pb2_grpc.LabelServiceStub(start_server(ocr=FakeOcr(LINES)).channel)


def _expect_error(call, code: grpc.StatusCode, reason: str, field: str | None = None) -> None:
    with pytest.raises(grpc.RpcError) as exc:
        call()
    assert exc.value.code() == code
    status = rpc_status.from_call(exc.value)
    assert status is not None
    info = error_details_pb2.ErrorInfo()
    assert status.details[0].Unpack(info)
    assert info.reason == reason
    assert info.metadata.get("field") == field


def _parse(stub, image=IMAGE, config=RAW):
    return stub.ParseLabel(
        label_pb2.ParseLabelRequest(
            image=preprocess_pb2.ImageInput(encoded=image),
            config=preprocess_pb2.ConfigOverride(json=json.dumps(config) if config else ""),
        )
    )


def _cells(resp) -> dict[tuple[str, str], tuple[str, str]]:
    return {(c.field, c.basis): (c.quantity.value, c.quantity.unit) for c in resp.cells}


def test_parse_label_returns_decimal_strings(stub):
    resp = _parse(stub)
    cells = _cells(resp)
    assert list(resp.columns) == ["per_serving", "per_100g"]
    assert len(cells) == 18
    # 十進位字串不經浮點數；多餘的 0 去掉
    assert cells["protein", "per_serving"] == ("2.1", "g")
    assert cells["energy", "per_100g"] == ("507", "kcal")
    assert cells["serving_size", ""] == ("30", "g")
    assert cells["servings", ""] == ("6", "份")
    assert resp.ocr_engine == "fake 1.0"
    assert list(resp.lines) == LINES
    assert len(resp.boxes) == len(LINES)
    assert "atwater" in {c.rule for c in resp.checks}
    assert [s.name for s in resp.steps][-2:] == ["ocr", "parse_label"]
    # 正式模式：OCR 輸入影像直接附上
    assert resp.image.encoded
    assert (resp.image.width, resp.image.height) == (80, 60)
    assert "protein" in {f.field for f in resp.fields}


def test_basis_unknown_leaves_nutrients_unassigned(start_server):
    lines = [line for line in LINES if line != "每份 每100公克"]
    server = start_server(ocr=FakeOcr(lines))
    resp = _parse(label_pb2_grpc.LabelServiceStub(server.channel))
    assert list(resp.columns) == []
    assert "LABEL_BASIS_UNKNOWN" in resp.warnings
    assert {c.field for c in resp.cells} == {"serving_size", "servings"}
    # 依位置的原始數值仍回傳，供人工指定基準
    protein = next(f for f in resp.fields if f.field == "protein")
    assert [(v.value, v.unit) for v in protein.values] == [("2.1", "g"), ("7", "g")]


def test_invalid_config(stub):
    _expect_error(
        lambda: _parse(stub, config={"line_overlap": 2}),
        grpc.StatusCode.INVALID_ARGUMENT,
        "INVALID_CONFIG",
        "line_overlap",
    )


def test_image_required(stub):
    _expect_error(
        lambda: stub.ParseLabel(label_pb2.ParseLabelRequest()),
        grpc.StatusCode.INVALID_ARGUMENT,
        "IMAGE_REQUIRED",
        "image",
    )


def test_undecodable_image(stub):
    _expect_error(
        lambda: _parse(stub, image=b"not an image"),
        grpc.StatusCode.INVALID_ARGUMENT,
        "IMAGE_DECODE_FAILED",
    )


def test_ocr_unavailable(start_server):
    server = start_server(ocr=None, ocr_error="找不到 PaddleOCR")
    stub = label_pb2_grpc.LabelServiceStub(server.channel)
    _expect_error(lambda: _parse(stub), grpc.StatusCode.FAILED_PRECONDITION, "OCR_UNAVAILABLE")
    # 服務仍註冊、健康檢查照常：前處理等其他服務不受影響
    health = health_pb2_grpc.HealthStub(server.channel)
    resp = health.Check(health_pb2.HealthCheckRequest(service="dietai.v1.LabelService"))
    assert resp.status == health_pb2.HealthCheckResponse.SERVING


def test_dev_mode_image_id_returns_artifact(start_server):
    server = start_server(dev_tools=True, ocr=FakeOcr(LINES))
    wb = workbench_pb2_grpc.WorkbenchServiceStub(server.channel)
    ref = wb.PutImage(workbench_pb2.PutImageRequest(encoded=IMAGE, name="x.png")).image
    stub = label_pb2_grpc.LabelServiceStub(server.channel)
    req = label_pb2.ParseLabelRequest(
        image=preprocess_pb2.ImageInput(image_id=ref.image_id),
        config=preprocess_pb2.ConfigOverride(json=json.dumps(RAW)),
    )
    first = stub.ParseLabel(req)
    assert first.image.artifact_id
    assert not first.image.encoded
    # 同一張原圖、同一組設定沿用同一個暫存結果
    assert stub.ParseLabel(req).image.artifact_id == first.image.artifact_id


@pytest.mark.parametrize(
    ("value", "text"),
    [("2.10", "2.1"), ("1E+2", "100"), ("0", "0"), ("0.05", "0.05"), ("125", "125")],
)
def test_decimal_text(value, text):
    assert decimal_text(Decimal(value)) == text


def test_locked_ocr_serializes_calls():
    active = 0
    peak = 0
    guard = threading.Lock()

    class Slow:
        name = "slow"

        def __call__(self, img):
            nonlocal active, peak
            with guard:
                active += 1
                peak = max(peak, active)
            time.sleep(0.02)
            with guard:
                active -= 1
            return []

    ocr = LockedOcr(Slow())
    assert ocr.name == "slow"
    threads = [threading.Thread(target=ocr, args=(None,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak == 1


def test_ocr_from_env_off_and_bad_spec(tmp_path):
    off = ocr_from_env({"AI_OCR_ENGINE": "off"})
    assert off.engine is None
    assert "off" in off.error
    bad = ocr_from_env({"AI_OCR_ENGINE": "nosuch", "AI_OCR_CACHE_DIR": str(tmp_path)})
    assert bad.engine is None
    assert "nosuch" in bad.error
    bad.close()  # 沒有引擎時關閉不出錯
