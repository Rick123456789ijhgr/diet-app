"""解碼器轉接測試：合成條碼由 zxing-cpp 產生，不使用真實照片。"""

import numpy as np
import pytest

from dietai.preprocess import CodeFormat, DecodeHit, ZxingConfig, ZxingDecoder
from dietai.synthetic import ean13_scene, invoice_qr_scene


def test_zxing_reads_ean13_with_corners(zxing, ean13_img):
    hits = zxing(ean13_img)
    assert len(hits) == 1
    hit = hits[0]
    assert hit.format is CodeFormat.EAN13
    assert hit.text == "4710088410108" and hit.raw == b"4710088410108"
    h, w = ean13_img.shape[:2]
    assert all(0 <= x <= w and 0 <= y <= h for x, y in hit.corners)
    assert hit.center[0] == pytest.approx(w / 2, abs=w * 0.1)


def test_zxing_returns_raw_bytes_for_qr(zxing):
    payload = "中文".encode("big5") + bytes([0x00, 0xFF, 0x80])
    hits = zxing(invoice_qr_scene(payload, b"**right"))
    assert {h.raw for h in hits} == {payload, b"**right"}
    assert all(h.format is CodeFormat.QR_CODE for h in hits)


def test_zxing_accepts_gray_and_returns_empty_on_blank(zxing, ean13_img):
    gray = ean13_img[..., 1].copy()
    assert len(zxing(gray)) == 1
    assert zxing(np.full((100, 100), 255, dtype=np.uint8)) == []


def test_zxing_rejects_bad_image(zxing):
    with pytest.raises(ValueError):
        zxing(np.zeros((10, 10), dtype=np.float32))


def test_zxing_try_rotate_controls_90_degree_search():
    img = np.ascontiguousarray(np.rot90(ean13_scene()))
    assert ZxingDecoder(ZxingConfig(try_rotate=True))(img)
    assert not ZxingDecoder(ZxingConfig(try_rotate=False))(img)


def test_decode_hit_area_and_center():
    hit = DecodeHit(CodeFormat.OTHER, "", b"", ((0, 0), (10, 0), (10, 4), (0, 4)))
    assert hit.area == 40
    assert hit.center == (5, 2)


def test_pyzbar_decoder_reads_ean13(ean13_img):
    pytest.importorskip("pyzbar.pyzbar")
    from dietai.preprocess import PyzbarDecoder

    try:
        decoder = PyzbarDecoder()
    except ImportError as exc:  # 缺少 zbar 動態函式庫
        pytest.skip(str(exc))
    hits = decoder(ean13_img)
    assert [(h.format, h.text) for h in hits] == [(CodeFormat.EAN13, "4710088410108")]
    assert len(hits[0].corners) == 4


def test_zxing_reads_numpy_color_as_bgr(zxing, ean13_img):
    # 藍色條（BGR 255,0,0；亮度約 29）在紅色底（0,0,255；約 76）上：當成 BGR 才是深條淺底；
    # 若被當成 RGB，亮度會反過來，關閉反色嘗試時就讀不到
    dark = ean13_img[..., 1] < 128
    img = np.zeros_like(ean13_img)
    img[dark], img[~dark] = (255, 0, 0), (0, 0, 255)
    decoder = ZxingDecoder(ZxingConfig(try_invert=False))
    assert [h.text for h in decoder(img)] == ["4710088410108"]
    assert decoder(np.ascontiguousarray(img[..., ::-1])) == []


def test_pyzbar_corners_are_distinct_at_45_degrees():
    from types import SimpleNamespace

    from dietai.preprocess import PyzbarDecoder

    diamond = [SimpleNamespace(x=x, y=y) for x, y in ((0, 50), (50, 0), (100, 50), (50, 100))]
    result = SimpleNamespace(polygon=diamond, type="QRCODE", data=b"x")
    decoder = PyzbarDecoder.__new__(PyzbarDecoder)  # 不載入 ZBar，直接替換解碼函式
    decoder._decode = lambda gray: [result]
    (hit,) = decoder(np.zeros((120, 120), dtype=np.uint8))
    assert len({(round(x), round(y)) for x, y in hit.corners}) == 4
    assert hit.area == pytest.approx(5000, rel=0.01)
    assert hit.center == pytest.approx((50, 50), abs=0.5)
