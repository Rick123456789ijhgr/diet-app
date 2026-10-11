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


# ---- 多階一致（min_agree）----

AGREE2 = (Rung.RAW, Rung.GRAY, Rung.BINARIZE, Rung.SHARPEN)


def test_min_agree_1_matches_first_hit(fake_decoder):
    decoder = fake_decoder([[], [_hit("4712612300015")]])
    result = decode_with_ladder(_blank(), decoder, LadderConfig(rungs=AGREE2))
    assert result.success_rung is Rung.GRAY and result.hits[0].text == "4712612300015"


def test_min_agree_2_waits_for_second_attempt(fake_decoder):
    decoder = fake_decoder([[_hit("4710088410108")], [], [_hit("4710088410108")]])
    result = decode_with_ladder(_blank(), decoder, LadderConfig(rungs=AGREE2, min_agree=2))
    assert result.success and result.success_rung is Rung.BINARIZE
    assert result.success_index == 2 and len(result.attempts) == 3
    assert [h.text for h in result.hits] == ["4710088410108"]


def test_min_agree_2_blocks_single_rung_misread(fake_decoder):
    """單一階的誤讀（另一個檢查碼正確的號碼）不會被採用，等到兩階一致的真值。"""
    decoder = fake_decoder(
        [[], [_hit("4712612300015")], [_hit("4718652300015")], [_hit("4718652300015")]]
    )
    result = decode_with_ladder(_blank(), decoder, LadderConfig(rungs=AGREE2, min_agree=2))
    assert result.success_rung is Rung.SHARPEN
    assert [h.text for h in result.hits] == ["4718652300015"]


def test_min_agree_unconfirmed_warning(fake_decoder):
    decoder = fake_decoder([[_hit("4712612300015")], [_hit("4718652300015")]])
    cfg = LadderConfig(rungs=(Rung.RAW, Rung.GRAY), min_agree=2)
    result = decode_with_ladder(_blank(), decoder, cfg)
    assert not result.success and result.hits == ()
    assert result.warnings == (PreprocessWarning.BARCODE_UNCONFIRMED,)


def test_min_agree_counts_one_vote_per_attempt(fake_decoder):
    """同一次嘗試中重複解出同一碼只算一票。"""
    hit = _hit("4710088410108")
    decoder = fake_decoder([[hit, hit]])
    cfg = LadderConfig(rungs=(Rung.RAW,), min_agree=2)
    assert not decode_with_ladder(_blank(), decoder, cfg).success


def test_min_agree_rejected_checksums_do_not_vote(fake_decoder):
    decoder = fake_decoder([[_hit("4710088410109")]])
    cfg = LadderConfig(rungs=(Rung.RAW,), min_agree=2)
    assert decode_with_ladder(_blank(), decoder, cfg).warnings == (
        PreprocessWarning.BARCODE_NOT_FOUND,
    )


def test_min_agree_must_be_positive():
    with pytest.raises(ValueError, match="min_agree"):
        LadderConfig(min_agree=0)


def test_min_agree_2_on_real_image(zxing, ean13_img):
    result = decode_with_ladder(ean13_img, zxing, LadderConfig(min_agree=2))
    assert result.success and result.success_index == 1  # 原圖與灰階一致


# ---- 採用格式（accept_formats）----

RETAIL = (CodeFormat.EAN13, CodeFormat.EAN8, CodeFormat.UPCA)


def test_accept_formats_rejects_other_symbologies(fake_decoder):
    """斜拍 EAN-13 被部分掃描成合法的 UPC-E：限制格式後不採用、繼續下一階。"""
    decoder = fake_decoder([[_hit("0171381000054", CodeFormat.UPCE)], [_hit("4710088410108")]])
    cfg = LadderConfig(rungs=(Rung.RAW, Rung.GRAY), accept_formats=RETAIL)
    result = decode_with_ladder(_blank(), decoder, cfg)
    assert result.success_rung is Rung.GRAY
    assert result.attempts[0].rejected[0].format is CodeFormat.UPCE


def test_accept_formats_empty_accepts_all(fake_decoder):
    decoder = fake_decoder([[_hit("0171381000054", CodeFormat.UPCE)]])
    assert decode_with_ladder(_blank(), decoder, RAW_ONLY).success


def test_accept_formats_from_json_strings():
    cfg = LadderConfig(accept_formats=["EAN13", "UPCA"])  # type: ignore[arg-type]
    assert cfg.accept_formats == (CodeFormat.EAN13, CodeFormat.UPCA)
    with pytest.raises(ValueError):
        LadderConfig(accept_formats=("EAN13", "EAN13"))  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        LadderConfig(accept_formats=("EAN-13",))  # type: ignore[arg-type]


def test_code_format_old_import_path_still_works():
    from dietai.preprocess import decoders, types

    assert decoders.CodeFormat is types.CodeFormat
