"""電子發票雙 QR 測試。內容含非 ASCII 位元組，驗證 raw bytes 與產生時一致。"""

import json
from dataclasses import asdict

import numpy as np
import pytest

from dietai.preprocess import (
    CodeFormat,
    DecodeHit,
    InvoiceQrConfig,
    LadderConfig,
    PreprocessWarning,
    Rung,
    locate_invoice_qrs,
)
from dietai.synthetic import gaussian_noise, invoice_qr_scene, rotate

LEFT = b"AB12345678" + "茶葉蛋".encode("big5") + bytes([0x00, 0xFF, 0x80, 0x0A])
RIGHT = b"**" + "鮮奶:1:35".encode("big5") + bytes([0xFE])
RAW_ONLY = InvoiceQrConfig(LadderConfig(rungs=(Rung.RAW,)))


@pytest.fixture(scope="module")
def invoice() -> np.ndarray:
    return invoice_qr_scene(LEFT, RIGHT)


def _qr(raw: bytes, x: float, size: float = 10) -> DecodeHit:
    corners = ((x, 0.0), (x + size, 0.0), (x + size, size), (x, size))
    return DecodeHit(CodeFormat.QR_CODE, "", raw, corners)


def _blank() -> np.ndarray:
    return np.zeros((20, 20), dtype=np.uint8)


def test_left_and_right_raw_bytes_match(zxing, invoice):
    """驗收：並排兩個 QR 能正確區分左右，raw bytes 與產生時一致。"""
    result = locate_invoice_qrs(invoice, zxing)
    assert result.complete and result.warnings == ()
    assert result.left is not None and result.right is not None
    assert result.left.raw == LEFT and result.right.raw == RIGHT
    assert result.left.center[0] < result.right.center[0]


def test_left_right_by_position_not_content(zxing):
    """內容對調後，左右仍依位置區分。"""
    result = locate_invoice_qrs(invoice_qr_scene(RIGHT, LEFT), zxing)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (RIGHT, LEFT)


def test_degraded_invoice(zxing, invoice):
    result = locate_invoice_qrs(gaussian_noise(rotate(invoice, 20), 25, seed=3), zxing)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (LEFT, RIGHT)


def test_upside_down_uses_image_position(zxing, invoice):
    """左右以影像中的位置為準：倒置的發票，原本的右碼出現在左邊。"""
    result = locate_invoice_qrs(rotate(invoice, 180), zxing)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (RIGHT, LEFT)


def test_partial_result_when_one_qr_hidden(zxing, invoice):
    img = invoice.copy()
    img[:, img.shape[1] // 2 :] = 235  # 遮住右半邊
    result = locate_invoice_qrs(img, zxing)
    assert result.left is not None and result.left.raw == LEFT and result.right is None
    assert result.warnings == (PreprocessWarning.INVOICE_QR_PARTIAL,)
    assert not result.complete


def test_not_found_does_not_raise(zxing):
    result = locate_invoice_qrs(np.full((200, 300, 3), 255, dtype=np.uint8), zxing)
    assert result.left is None and result.right is None
    assert result.warnings == (PreprocessWarning.INVOICE_QR_NOT_FOUND,)
    assert len(result.attempts) == len(result.steps) > 1


def test_accumulates_across_rungs_and_dedupes(fake_decoder):
    decoder = fake_decoder([[_qr(b"R", 100)], [_qr(b"R", 100)], [_qr(b"L", 0)]])
    cfg = InvoiceQrConfig(LadderConfig(rungs=(Rung.RAW, Rung.GRAY, Rung.BINARIZE)))
    result = locate_invoice_qrs(_blank(), decoder, cfg)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (b"L", b"R")
    assert len(result.attempts) == 3


def test_stops_once_two_found(fake_decoder):
    decoder = fake_decoder([[_qr(b"L", 0), _qr(b"R", 100)]])
    cfg = InvoiceQrConfig(LadderConfig(rungs=(Rung.RAW, Rung.GRAY)))
    assert len(locate_invoice_qrs(_blank(), decoder, cfg).attempts) == 1


def test_extra_codes_keep_two_largest(fake_decoder):
    decoder = fake_decoder([[_qr(b"small", 0, 2), _qr(b"R", 200, 50), _qr(b"L", 50, 50)]])
    result = locate_invoice_qrs(_blank(), decoder, RAW_ONLY)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (b"L", b"R")


def test_ignores_non_qr(fake_decoder):
    ean = DecodeHit(CodeFormat.EAN13, "4710088410108", b"4710088410108", _qr(b"", 0).corners)
    decoder = fake_decoder([[ean, _qr(b"L", 0)]])
    result = locate_invoice_qrs(_blank(), decoder, RAW_ONLY)
    assert result.left is not None and result.left.raw == b"L" and result.right is None


def test_does_not_modify_input(zxing, invoice):
    before = invoice.copy()
    locate_invoice_qrs(invoice, zxing)
    np.testing.assert_array_equal(invoice, before)


def test_rejects_bad_image(zxing):
    with pytest.raises(ValueError):
        locate_invoice_qrs(np.zeros((10, 10), dtype=np.int32), zxing)


def test_invoice_config_round_trips_through_json():
    cfg = InvoiceQrConfig(LadderConfig(rungs=(Rung.GRAY,), scales=(3.0,)))
    assert InvoiceQrConfig(**json.loads(json.dumps(asdict(cfg)))) == cfg
