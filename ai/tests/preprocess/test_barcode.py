"""條碼逐步升級測試。合成 EAN-13 加上已知退化，直接比較階梯與只用原圖的成功數。"""

import json
from dataclasses import asdict

import numpy as np
import pytest

from dietai.preprocess import (
    CodeFormat,
    DecodeHit,
    LadderConfig,
    PreprocessWarning,
    Rung,
    decode_with_ladder,
    ean13_check_digit,
    ean13_checksum_ok,
    ladder_variants,
)
from dietai.synthetic import (
    brightness_gradient,
    downscale,
    ean13_codes,
    gaussian_blur,
    gaussian_noise,
    rotate,
)

RAW_ONLY = LadderConfig(rungs=(Rung.RAW,))

CONDITIONS = {
    "原圖": lambda img: img,
    "旋轉 15°": lambda img: rotate(img, 15),
    "旋轉 45°": lambda img: rotate(img, 45),
    "模糊": lambda img: gaussian_blur(img, 2.0),
    "亮度梯度": lambda img: brightness_gradient(img, 0.9),
    "縮小 1/4": lambda img: downscale(img, 0.25),
    "雜訊": lambda img: gaussian_noise(img, 40, seed=1),
}


def _hit(text: str, fmt: CodeFormat = CodeFormat.EAN13) -> DecodeHit:
    return DecodeHit(fmt, text, text.encode(), ((0, 0), (10, 0), (10, 5), (0, 5)))


def _blank() -> np.ndarray:
    return np.zeros((20, 20), dtype=np.uint8)


@pytest.mark.parametrize(
    ("code", "ok"),
    [
        ("4710088410108", True),
        ("4006381333931", True),
        ("0000000000000", True),
        ("4710088410109", False),  # 檢查碼錯誤
        ("471008841010", False),  # 12 位
        ("47100884101080", False),  # 14 位
        ("47100884101O8", False),  # 含字母
        ("٤710088410108", False),  # 阿拉伯數字 4（非 ASCII 數字）
        ("", False),
    ],
)
def test_ean13_checksum(code, ok):
    assert ean13_checksum_ok(code) is ok


@pytest.mark.parametrize(("body", "digit"), [("471008841010", 8), ("400638133393", 1)])
def test_ean13_check_digit(body, digit):
    assert ean13_check_digit(body) == digit


@pytest.mark.parametrize("body", ["47100884101", "4710088410108", "47100884101a", ""])
def test_ean13_check_digit_rejects_bad_body(body):
    with pytest.raises(ValueError):
        ean13_check_digit(body)


def test_ean13_codes_are_valid_distinct_and_reproducible():
    codes = ean13_codes(20, seed=7)
    assert len(set(codes)) == 20 and all(ean13_checksum_ok(c) for c in codes)
    assert all(c.startswith("471") for c in codes)
    assert ean13_codes(20, seed=7) == codes and ean13_codes(20, seed=8) != codes


@pytest.mark.parametrize(("n", "prefix"), [(11, "47100884101"), (1, "47a")])
def test_ean13_codes_rejects_impossible_requests(n, prefix):
    with pytest.raises(ValueError):
        ean13_codes(n, prefix=prefix)


def test_ladder_beats_raw_only(zxing, ean13_img):
    """驗收：各退化條件下，階梯的成功數高於只用原圖，且每個條件都不比原圖差。"""
    raw = {
        k: decode_with_ladder(f(ean13_img), zxing, RAW_ONLY).success for k, f in CONDITIONS.items()
    }
    full = {k: decode_with_ladder(f(ean13_img), zxing).success for k, f in CONDITIONS.items()}
    assert all(full[k] >= raw[k] for k in CONDITIONS), (raw, full)
    assert sum(full.values()) > sum(raw.values()), (raw, full)
    assert full["旋轉 45°"] and not raw["旋轉 45°"]


def test_deskew_maps_coordinates_back_to_original(zxing, ean13_img):
    """旋轉校正階找到的四角須回推到原圖：條碼中心約在畫布中心。"""
    img = rotate(ean13_img, 45)
    result = decode_with_ladder(img, zxing)
    assert result.success and result.success_rung is Rung.DESKEW
    assert [h.text for h in result.hits] == ["4710088410108"]
    h, w = img.shape[:2]
    cx, cy = result.hits[0].center
    assert cx == pytest.approx(w / 2, abs=25) and cy == pytest.approx(h / 2, abs=25)


def test_multiscale_maps_coordinates_back(zxing, ean13_img):
    cfg = LadderConfig(rungs=(Rung.MULTISCALE,), scales=(0.5,))
    direct = zxing(ean13_img)[0]
    result = decode_with_ladder(ean13_img, zxing, cfg)
    assert result.success
    for (x1, y1), (x2, y2) in zip(result.hits[0].corners, direct.corners, strict=True):
        assert abs(x1 - x2) < 6 and abs(y1 - y2) < 6


def test_stops_at_first_success(zxing, ean13_img):
    result = decode_with_ladder(ean13_img, zxing)
    assert result.success_rung is Rung.RAW and result.success_index == 0
    assert len(result.attempts) == 1 and len(result.steps) == 1
    assert result.warnings == ()
    assert result.image is not None and result.image is not ean13_img


def test_failure_reports_every_attempt(zxing):
    blank = np.full((200, 300, 3), 255, dtype=np.uint8)
    cfg = LadderConfig()
    result = decode_with_ladder(blank, zxing, cfg)
    assert not result.success and result.success_rung is None and result.image is None
    assert result.warnings == (PreprocessWarning.BARCODE_NOT_FOUND,)
    # 多尺度每個倍率各一次嘗試
    assert len(result.attempts) == len(cfg.rungs) - 1 + len(cfg.scales)
    assert [a.rung for a in result.attempts].count(Rung.MULTISCALE) == len(cfg.scales)
    assert [s.name for s in result.steps] == [a.rung.value for a in result.attempts]
    assert all(s.elapsed_ms >= 0 for s in result.steps)


def test_bad_checksum_is_not_success(fake_decoder):
    """驗收：檢查碼錯誤的字串被判定為失敗，並記錄在 rejected。"""
    decoder = fake_decoder([[_hit("4710088410109")], [_hit("4710088410108")]])
    cfg = LadderConfig(rungs=(Rung.RAW, Rung.GRAY))
    result = decode_with_ladder(_blank(), decoder, cfg)
    assert result.success and result.success_rung is Rung.GRAY
    assert [h.text for h in result.attempts[0].rejected] == ["4710088410109"]


def test_bad_checksum_only_fails(fake_decoder):
    decoder = fake_decoder([[_hit("4710088410109")]])
    result = decode_with_ladder(_blank(), decoder, RAW_ONLY)
    assert not result.success
    assert result.warnings == (PreprocessWarning.BARCODE_NOT_FOUND,)


def test_checksum_verification_can_be_disabled(fake_decoder):
    decoder = fake_decoder([[_hit("4710088410109")]])
    cfg = LadderConfig(rungs=(Rung.RAW,), verify_ean13=False)
    assert decode_with_ladder(_blank(), decoder, cfg).success


def test_checksum_not_applied_to_other_formats(fake_decoder):
    decoder = fake_decoder([[_hit("hello", CodeFormat.QR_CODE)]])
    assert decode_with_ladder(_blank(), decoder, RAW_ONLY).success


def test_rung_order_follows_config(fake_decoder):
    decoder = fake_decoder([])
    cfg = LadderConfig(rungs=(Rung.MULTISCALE, Rung.BINARIZE, Rung.RAW), scales=(2.0,))
    result = decode_with_ladder(np.zeros((20, 30, 3), dtype=np.uint8), decoder, cfg)
    assert [a.rung for a in result.attempts] == [Rung.MULTISCALE, Rung.BINARIZE, Rung.RAW]
    assert decoder.shapes == [(40, 60), (20, 30), (20, 30, 3)]


def test_deskew_skipped_when_angle_small(fake_decoder, ean13_img):
    decoder = fake_decoder([])
    result = decode_with_ladder(ean13_img, decoder, LadderConfig(rungs=(Rung.DESKEW,)))
    assert result.attempts[0].skipped and decoder.shapes == []


def test_variants_are_independent(ean13_img):
    """每一階都由原圖產生、不疊加前一階：灰階階的結果與二值化是否在前無關。"""
    alone = {v.rung: v.image for v in ladder_variants(ean13_img, LadderConfig(rungs=(Rung.GRAY,)))}
    after = {
        v.rung: v.image
        for v in ladder_variants(ean13_img, LadderConfig(rungs=(Rung.BINARIZE, Rung.GRAY)))
    }
    np.testing.assert_array_equal(alone[Rung.GRAY], after[Rung.GRAY])


def test_does_not_modify_input(zxing, ean13_img):
    img = rotate(ean13_img, 45)
    before = img.copy()
    decode_with_ladder(img, zxing)
    list(ladder_variants(img))
    np.testing.assert_array_equal(img, before)


def test_rejects_bad_image(zxing):
    with pytest.raises(ValueError):
        decode_with_ladder(np.zeros((10, 10, 4), dtype=np.uint8), zxing)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"rungs": (Rung.RAW, Rung.RAW)},
        {"rungs": ("no_such_rung",)},
        {"scales": (1.0,)},
        {"scales": (0.0,)},
        {"scales": ()},
        {"binarize_block_size": 30},
        {"denoise_ksize": 1},
        {"sharpen_sigma": 0.0},
        {"deskew_min_deg": -1.0},
    ],
)
def test_ladder_config_rejects_invalid(kwargs):
    with pytest.raises(ValueError):
        LadderConfig(**kwargs)


def test_ladder_config_round_trips_through_json():
    cfg = LadderConfig(rungs=(Rung.DESKEW, Rung.RAW), scales=(3.0,))
    loaded = LadderConfig(**json.loads(json.dumps(asdict(cfg))))
    assert loaded == cfg and isinstance(loaded.rungs[0], Rung)
