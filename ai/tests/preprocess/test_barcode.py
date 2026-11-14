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
    ZxingConfig,
    ZxingDecoder,
    decode_with_ladder,
    ean13_check_digit,
    ean13_checksum_ok,
    ladder_variants,
    ops,
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
    cfg = LadderConfig(rungs=(Rung.RAW,), accept_formats=())
    assert decode_with_ladder(_blank(), decoder, cfg).success


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
    cfg = LadderConfig(rungs=(Rung.RAW,), accept_formats=())
    assert decode_with_ladder(_blank(), decoder, cfg).success


def test_defaults_reject_upce_and_put_sharpen_last(fake_decoder):
    """2026-10-12 決定的預設：只收零售格式、sharpen 為最後一階。"""
    assert LadderConfig().accept_formats == RETAIL
    assert LadderConfig().rungs[-1] is Rung.SHARPEN
    decoder = fake_decoder([[_hit("0171381000054", CodeFormat.UPCE)]])
    assert not decode_with_ladder(_blank(), decoder, RAW_ONLY).success


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


# ---- Otsu、CLAHE 與疊加流程（ADR 0005 第 5 點）----

PIPE = LadderConfig(
    rungs=(Rung.PIPELINE,),
    pipelines=((Rung.DENOISE, Rung.BINARIZE), (Rung.CLAHE, Rung.OTSU)),
)


def test_otsu_and_clahe_rungs(ean13_img):
    gray = ops.to_gray(ean13_img)
    cfg = LadderConfig(rungs=(Rung.OTSU, Rung.CLAHE), clahe_clip=3.0, clahe_tile=4)
    otsu, clahe = ladder_variants(ean13_img, cfg)
    assert set(np.unique(otsu.image)) <= {0, 255}
    np.testing.assert_array_equal(otsu.image, ops.otsu_threshold(gray))
    np.testing.assert_array_equal(clahe.image, ops.clahe(gray, 3.0, 4))
    assert clahe.params == {"clip": 3.0, "tile": 4}


def test_pipeline_applies_steps_in_order(ean13_img):
    gray = ops.to_gray(ean13_img)
    first, second = ladder_variants(ean13_img, PIPE)
    assert first.rung is second.rung is Rung.PIPELINE
    expected = ops.adaptive_threshold(ops.median_blur(gray, 3), 31, 5.0)
    np.testing.assert_array_equal(first.image, expected)
    assert first.params == {
        "steps": "denoise+binarize",
        "denoise.ksize": 3,
        "binarize.block_size": 31,
        "binarize.c": 5.0,
    }
    np.testing.assert_array_equal(second.image, ops.otsu_threshold(ops.clahe(gray, 2.0, 8)))
    # 疊加流程與其他階一樣由原圖開始，不受前一階影響
    alone = LadderConfig(rungs=(Rung.PIPELINE,), pipelines=((Rung.CLAHE, Rung.OTSU),))
    (again,) = ladder_variants(ean13_img, alone)
    np.testing.assert_array_equal(again.image, second.image)


@pytest.mark.parametrize(
    "steps", [(Rung.DESKEW, Rung.DENOISE), (Rung.DENOISE, Rung.DESKEW), (Rung.CLAHE, Rung.DESKEW)]
)
def test_pipeline_deskew_maps_coordinates_back(zxing, ean13_img, steps):
    """疊加流程中的旋轉校正，不論在第幾步，四角都要回推到原圖（與單獨的 deskew 階一致）。"""
    img = rotate(ean13_img, 30)
    single = decode_with_ladder(img, zxing, LadderConfig(rungs=(Rung.DESKEW,)))
    cfg = LadderConfig(rungs=(Rung.PIPELINE,), pipelines=(steps,))
    result = decode_with_ladder(img, zxing, cfg)
    assert result.success and single.success
    assert result.attempts[0].params["deskew.applied"] is True
    for (x1, y1), (x2, y2) in zip(result.hits[0].corners, single.hits[0].corners, strict=True):
        assert abs(x1 - x2) < 4 and abs(y1 - y2) < 4


def test_pipeline_deskew_below_threshold_keeps_going(ean13_img):
    cfg = LadderConfig(rungs=(Rung.PIPELINE,), pipelines=((Rung.DESKEW, Rung.DENOISE),))
    (v,) = ladder_variants(ean13_img, cfg)
    assert v.params["deskew.applied"] is False and not v.skipped
    np.testing.assert_array_equal(v.image, ops.median_blur(ops.to_gray(ean13_img), 3))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"pipelines": ((Rung.DENOISE,),)},  # 只有一步
        {"pipelines": ((Rung.DENOISE, Rung.DENOISE),)},  # 步驟重複
        {"pipelines": ((Rung.RAW, Rung.BINARIZE),)},  # 不可用的步驟
        {"pipelines": ((Rung.MULTISCALE, Rung.BINARIZE),)},  # 縮放要帶倍率
        {"pipelines": (("rotate", "denoise"),)},  # 旋轉要帶角度
        {"pipelines": (("denoise:3", "binarize"),)},  # 一般步驟不帶參數
        {"pipelines": (("multiscale:1", "binarize"),)},  # 倍率 1 等於原圖
        {"pipelines": (("rotate:0", "binarize"),)},
        {"pipelines": (("rotate:abc", "binarize"),)},
        {"pipelines": (("rotate:90", "rotate:90.0"),)},  # 正規化後重複
        {"pipelines": (("denoise", "binarize"), (Rung.DENOISE, Rung.BINARIZE))},  # 流程重複
        {"rungs": (Rung.PIPELINE,), "pipelines": ()},
        {"clahe_clip": 0.0},
        {"clahe_tile": 0},
    ],
)
def test_pipeline_config_rejects_invalid(kwargs):
    with pytest.raises(ValueError):
        LadderConfig(**kwargs)


def test_pipeline_config_round_trips_through_json():
    loaded = LadderConfig(**json.loads(json.dumps(asdict(PIPE))))
    assert loaded == PIPE and isinstance(loaded.pipelines[0][0], Rung)
    # 預設階梯不含疊加流程，上線行為不變
    assert Rung.PIPELINE not in LadderConfig().rungs
    assert len(LadderConfig().pipelines) == 5


# ── 旋轉階（rotate）與疊加流程中的縮放、旋轉 ──
# 關閉 zxing 內建的旋轉，才看得出旋轉階本身的效果
NO_ROTATE = ZxingDecoder(ZxingConfig(try_rotate=False, try_downscale=False, try_invert=False))


def test_rotate_rung_reads_vertical_barcode(ean13_img):
    """直放的條碼：只用原圖讀不到，旋轉 90° 讀得到；四角回推到原圖（與旋轉後影像上的位置一致）。"""
    img = np.ascontiguousarray(np.rot90(ean13_img))  # 逆時針轉 90°：條碼變成直的
    assert not decode_with_ladder(img, NO_ROTATE, RAW_ONLY).success
    cfg = LadderConfig(rungs=(Rung.RAW, Rung.ROTATE), angles=(90.0, -90.0))
    result = decode_with_ladder(img, NO_ROTATE, cfg)
    assert result.success and result.success_rung is Rung.ROTATE
    assert result.attempts[-1].params == {"angle": 90.0}
    # 四角在原圖（直放）的座標系：直放影像中條碼的寬高互換，x 的範圍應小於 y 的範圍
    xs = [x for x, _ in result.hits[0].corners]
    ys = [y for _, y in result.hits[0].corners]
    assert max(xs) - min(xs) < max(ys) - min(ys)
    h, w = img.shape[:2]
    assert all(0 <= x <= w and 0 <= y <= h for x, y in result.hits[0].corners)


@pytest.mark.parametrize("angle", [90.0, -90.0, 180.0, 30.0])
def test_rotate_inverse_maps_back_exactly(angle):
    """旋轉後影像上的點經 to_original 回到原圖上同一個像素（90 的倍數為精確對應）。"""
    # 白底黑點：任意角度旋轉時擴大的畫布填白，不會被當成那個點
    img = np.full((40, 60), 255, dtype=np.uint8)
    img[5, 7] = 0
    (v,) = ladder_variants(img, LadderConfig(rungs=(Rung.ROTATE,), angles=(angle,)))
    assert v.image is not None
    ys, xs = np.nonzero(v.image == v.image.min())
    x, y = float(xs.mean()), float(ys.mean())
    back = v.to_original @ np.array([x, y, 1.0])
    tol = 0.01 if angle % 90 == 0 else 1.0
    assert back[0] == pytest.approx(7, abs=tol) and back[1] == pytest.approx(5, abs=tol)
    if angle % 180 == 90:
        assert v.image.shape == (60, 40)


def test_pipeline_scale_then_rotate(ean13_img):
    """疊加流程：先縮小一半再轉 90°，結果等於分開做；參數記在 params。"""
    img = np.ascontiguousarray(np.rot90(ean13_img))
    cfg = LadderConfig(rungs=(Rung.PIPELINE,), pipelines=(("multiscale:0.5", "rotate:90"),))
    (v,) = ladder_variants(img, cfg)
    expected = np.rot90(ops.scale(ops.to_gray(img), 0.5))
    np.testing.assert_array_equal(v.image, expected)
    assert v.params["steps"] == "multiscale:0.5+rotate:90"
    assert v.params["multiscale.factor"] == 0.5 and v.params["rotate.angle"] == 90.0
    result = decode_with_ladder(img, NO_ROTATE, cfg)
    assert result.success
    h, w = img.shape[:2]
    assert all(-2 <= x <= w + 2 and -2 <= y <= h + 2 for x, y in result.hits[0].corners)


def test_pipeline_steps_are_normalized():
    cfg = LadderConfig(pipelines=(("multiscale:0.50", "rotate:90.0", "denoise"),))
    assert cfg.pipelines == (("multiscale:0.5", "rotate:90", "denoise"),)
    assert isinstance(cfg.pipelines[0][2], Rung)
    loaded = LadderConfig(**json.loads(json.dumps(asdict(cfg))))
    assert loaded == cfg


@pytest.mark.parametrize(
    "kwargs",
    [
        {"angles": (0.0,)},
        {"angles": (181.0,)},
        {"angles": (-180.0,)},
        {"angles": (90.0, 90.0)},
        {"rungs": (Rung.ROTATE,), "angles": ()},
    ],
)
def test_rotate_config_rejects_invalid(kwargs):
    with pytest.raises(ValueError):
        LadderConfig(**kwargs)
