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


def test_left_right_by_content_not_position(zxing):
    """左右依內容區分（右碼以 ** 開頭）：內容對調擺放時，左碼仍是非 ** 的那個。"""
    result = locate_invoice_qrs(invoice_qr_scene(RIGHT, LEFT), zxing)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (LEFT, RIGHT)
    assert result.left.center[0] > result.right.center[0]


def test_degraded_invoice(zxing, invoice):
    result = locate_invoice_qrs(gaussian_noise(rotate(invoice, 20), 25, seed=3), zxing)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (LEFT, RIGHT)


def test_upside_down_keeps_left_and_right(zxing, invoice):
    """倒拍的發票：右碼出現在影像左側，左右仍依內容指定，不會對調。"""
    result = locate_invoice_qrs(rotate(invoice, 180), zxing)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (LEFT, RIGHT)


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
    decoder = fake_decoder([[_qr(b"**R", 100)], [_qr(b"**R", 100)], [_qr(b"L", 0)]])
    cfg = InvoiceQrConfig(LadderConfig(rungs=(Rung.RAW, Rung.GRAY, Rung.BINARIZE)))
    result = locate_invoice_qrs(_blank(), decoder, cfg)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (b"L", b"**R")
    assert len(result.attempts) == 3


def test_stops_once_left_and_right_found(fake_decoder):
    decoder = fake_decoder([[_qr(b"L", 0), _qr(b"**R", 100)]])
    cfg = InvoiceQrConfig(LadderConfig(rungs=(Rung.RAW, Rung.GRAY)))
    assert len(locate_invoice_qrs(_blank(), decoder, cfg).attempts) == 1


def test_background_qr_does_not_stop_before_right(fake_decoder):
    """第一階讀到左碼與背景 QR（共兩個）時不停，繼續到讀到 ** 右碼；背景 QR 不入選。"""
    decoder = fake_decoder([[_qr(b"L", 0, 50), _qr(b"promo", 300, 20)], [_qr(b"**R", 100, 50)]])
    cfg = InvoiceQrConfig(LadderConfig(rungs=(Rung.RAW, Rung.GRAY, Rung.BINARIZE)))
    result = locate_invoice_qrs(_blank(), decoder, cfg)
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (b"L", b"**R")
    assert result.complete and result.warnings == ()
    assert len(result.attempts) == 2


def test_right_qr_kept_even_if_smaller_than_background(fake_decoder):
    """兩類都有時，右碼取 ** 中最大的，不會因背景 QR 較大而被擠掉。"""
    decoder = fake_decoder([[_qr(b"big", 0, 80), _qr(b"L", 100, 40), _qr(b"**R", 200, 30)]])
    result = locate_invoice_qrs(_blank(), decoder, RAW_ONLY)
    assert result.right is not None and result.right.raw == b"**R"


def test_without_right_qr_runs_whole_ladder_and_falls_back_to_position(fake_decoder):
    """一直沒讀到 ** 右碼：跑完整條階梯，退回面積最大兩個＋依位置排左右。"""
    decoder = fake_decoder([[_qr(b"B", 100), _qr(b"A", 0)]] * 2)
    cfg = InvoiceQrConfig(LadderConfig(rungs=(Rung.RAW, Rung.GRAY)))
    result = locate_invoice_qrs(_blank(), decoder, cfg)
    assert len(result.attempts) == 2
    assert result.left is not None and result.right is not None
    assert (result.left.raw, result.right.raw) == (b"A", b"B")


def test_only_right_qr_is_partial(fake_decoder):
    result = locate_invoice_qrs(_blank(), fake_decoder([[_qr(b"**R", 0)]]), RAW_ONLY)
    assert result.left is not None and result.left.raw == b"**R" and result.right is None
    assert result.warnings == (PreprocessWarning.INVOICE_QR_PARTIAL,)


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


def test_accept_formats_does_not_block_invoice_qr(fake_decoder):
    """商品條碼的格式限制（例如只收 EAN-13）不影響發票 QR。"""
    from dietai.preprocess import CodeFormat, InvoiceQrConfig, LadderConfig, Rung

    corners_l = ((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0))
    corners_r = ((50.0, 0.0), (60.0, 0.0), (60.0, 10.0), (50.0, 10.0))
    hits = [
        DecodeHit(CodeFormat.QR_CODE, "L", b"L", corners_l),
        DecodeHit(CodeFormat.QR_CODE, "R", b"R", corners_r),
    ]
    ladder = LadderConfig(rungs=(Rung.RAW,), accept_formats=(CodeFormat.EAN13,))
    img = np.full((40, 80, 3), 255, dtype=np.uint8)
    result = locate_invoice_qrs(img, fake_decoder([hits]), InvoiceQrConfig(ladder=ladder))
    assert result.left is not None and result.right is not None
