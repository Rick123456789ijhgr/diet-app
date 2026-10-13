"""工作台純邏輯模組的測試（不需啟動 Streamlit）。"""

import json
from pathlib import Path

import numpy as np
import pytest

from dietai.preprocess import (
    Box,
    CodeFormat,
    DecodeHit,
    Ellipse,
    LadderConfig,
    PreprocessWarning,
    QualityConfig,
    Rung,
    RungAttempt,
    check_quality,
)
from dietai.synthetic import label_scene
from wb import checks, configs, degradations, ladder_eval, viz
from wb.images import (
    SplitLockedError,
    decode_image,
    encode_png,
    guard_path,
    is_test_split,
    list_images,
    load_image,
)


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("research/data/splits/test/a.jpg", True),
        ("research/data/Splits/TEST/a.jpg", True),
        ("research/data/splits/dev/a.jpg", False),
        ("research/data/test/a.jpg", False),
        ("splits/testing/a.jpg", False),
    ],
)
def test_is_test_split(path, expected):
    assert is_test_split(path) is expected


def test_guard_rejects_test_split(tmp_path):
    with pytest.raises(SplitLockedError):
        guard_path(tmp_path / "splits" / "test" / "x.png")


def test_png_roundtrip_and_unicode_path(tmp_path):
    img = label_scene(60, 80)
    path = tmp_path / "中文資料夾" / "影像.png"
    path.parent.mkdir()
    path.write_bytes(encode_png(img))
    np.testing.assert_array_equal(load_image(path), img)


def test_decode_rejects_garbage():
    with pytest.raises(ValueError):
        decode_image(b"not an image")


def test_list_images_skips_test_split_and_non_images(tmp_path):
    png = encode_png(label_scene(20, 20))
    for rel in ("a.png", "b.txt", "sub/c.png", "splits/test/d.png"):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(png)
    assert [p.name for p in list_images(tmp_path)] == ["a.png"]
    assert [p.name for p in list_images(tmp_path, recursive=True)] == ["a.png", "c.png"]
    assert len(list_images(tmp_path, recursive=True, limit=1)) == 1


def test_config_json_roundtrip():
    cfg = QualityConfig(blur_min=123.0, dark_level=10)
    assert configs.config_from_json(QualityConfig, configs.config_to_json(cfg)) == cfg
    flat = json.dumps({"blur_min": 50.0})
    assert configs.config_from_json(QualityConfig, flat).blur_min == 50.0


@pytest.mark.parametrize(
    "text",
    [
        '{"nope": 1}',
        '{"class": "OtherConfig", "values": {}}',
        "[1, 2]",
        '{"dark_level": 300}',
    ],
)
def test_config_json_rejects_invalid(text):
    with pytest.raises(ValueError):
        configs.config_from_json(QualityConfig, text)


def test_config_python_lists_only_changed_fields():
    assert configs.config_python(QualityConfig()) == "QualityConfig()"
    assert configs.config_python(QualityConfig(blur_min=80.0)) == "QualityConfig(blur_min=80.0)"


def test_calibration_rows_cover_flagged_fields():
    names = {r["欄位"] for r in configs.calibration_rows()}
    assert {"blur_min", "binarize_block_size", "deskew_min_deg"} <= names
    assert "blur_short_side" not in names and "verify_ean13" not in names


def test_ladder_config_json_roundtrip_with_sequences():
    cfg = LadderConfig(rungs=(Rung.DESKEW, Rung.RAW), scales=(3.0,), binarize_c=2.0)
    assert configs.config_from_json(LadderConfig, configs.config_to_json(cfg)) == cfg
    assert configs.changed_fields(cfg) == ["rungs", "scales", "binarize_c"]


def _hit(x: float, text: str = "4710088410108") -> DecodeHit:
    return DecodeHit(
        CodeFormat.EAN13, text, text.encode(), ((x, 10), (x + 30, 10), (x + 30, 30), (x, 30))
    )


def test_draw_hits_marks_corners_without_modifying_input():
    img = np.full((60, 120), 255, dtype=np.uint8)
    out = viz.draw_hits(img, [_hit(10), _hit(70)], ["a", "b"])
    assert out.shape == (60, 120, 3) and (img == 255).all()
    assert (out[10, 25] != 255).any()  # 框線經過上緣


def test_hex_and_ascii_preview():
    raw = b"AB" + bytes([0xFF, 0x00])
    assert viz.hex_preview(raw) == "41 42 FF 00"
    assert viz.hex_preview(bytes(100), limit=2).endswith("（共 100 bytes）")
    assert viz.ascii_preview(raw) == "AB··"


def test_attempt_rows_status():
    attempts = [
        RungAttempt(Rung.RAW, {}, 1.0, ()),
        RungAttempt(Rung.DESKEW, {"skew_deg": 0.5}, 0.1, (), skipped=True),
        RungAttempt(Rung.GRAY, {}, 1.0, (), rejected=(_hit(0, "4710088410109"),)),
        RungAttempt(Rung.BINARIZE, {"c": 5}, 2.0, (_hit(0),)),
    ]
    rows = viz.attempt_rows(attempts, {"raw": "原圖"})
    assert [r["結果"] for r in rows] == ["失敗", "略過", "檢查碼錯誤", "成功"]
    assert rows[0]["階"] == "原圖" and rows[3]["參數"] == "c=5"
    assert viz.hit_rows([_hit(0)])[0]["格式"] == "EAN13"


def test_every_warning_has_text():
    from wb.text import WARNING_TEXT

    assert set(WARNING_TEXT) == set(PreprocessWarning)


def test_every_rung_has_text():
    from wb.text import RUNG_TEXT

    assert set(RUNG_TEXT) == set(Rung)


def test_every_outcome_has_text():
    from dietai.evaluation import Outcome
    from wb.text import OUTCOME_TEXT, outcome_label

    assert set(OUTCOME_TEXT) == set(Outcome)
    assert outcome_label("misread") == "誤讀"
    assert outcome_label("unknown") == "unknown"


def test_identity_degradation_returns_equal_copy():
    img = label_scene(40, 60)
    out = degradations.apply(img, degradations.Degradation(seed=3))
    assert out is not img
    np.testing.assert_array_equal(out, img)


def test_degradations_do_not_modify_input():
    img = label_scene(40, 60)
    before = img.copy()
    d = degradations.Degradation(
        rotate_deg=10, scale=0.5, blur_sigma=1, gain=0.8, gradient=0.3, glare=0.2, noise_std=5
    )
    out = degradations.apply(img, d)
    np.testing.assert_array_equal(img, before)
    assert out.dtype == np.uint8


@pytest.mark.parametrize("axis", list(degradations.SWEEP_AXES))
def test_sweep_axes_produce_valid_images(axis):
    spec = degradations.SWEEP_AXES[axis]
    img = label_scene(40, 60)
    for level in degradations.sweep_levels(spec.default_lo, spec.default_hi, 3):
        out = spec.fn(img, level)
        assert out.dtype == np.uint8 and out.ndim == 3


def test_sweep_levels():
    assert degradations.sweep_levels(0, 1, 3) == [0.0, 0.5, 1.0]
    with pytest.raises(ValueError):
        degradations.sweep_levels(0, 1, 1)


def test_viz_shapes():
    img = label_scene(120, 160)
    cfg = QualityConfig(blur_short_side=60)
    assert viz.laplacian_heatmap(img, cfg).shape == (60, 80, 3)
    assert viz.exposure_overlay(img, cfg).shape == img.shape
    hist = viz.gray_histogram(img)
    assert len(hist) == 256 and sum(r["像素數"] for r in hist) == 120 * 160


def test_exposure_overlay_marks_dark_pixels():
    img = np.zeros((4, 4, 3), dtype=np.uint8)
    out = viz.exposure_overlay(img, QualityConfig())
    assert out[0, 0, 0] > 0 and out[0, 0, 2] == 0


def test_draw_quads_and_mask_overlay_keep_input():
    img = np.full((100, 120), 200, dtype=np.uint8)
    quad = np.array([[10, 10], [100, 12], [98, 90], [12, 88]], dtype=np.float32)
    out = viz.draw_quads(img, [(quad, viz.FOUND_COLOR, "contour")])
    assert out.shape == (100, 120, 3)
    assert (img == 200).all()
    mask = np.zeros((100, 120), dtype=bool)
    mask[:10] = True
    overlay = viz.mask_overlay(img, mask)
    assert overlay[0, 0, 2] > overlay[0, 0, 0] and (overlay[50, 50] == 200).all()


def test_draw_boxes_and_ellipses_keep_input():
    img = np.full((100, 120), 200, dtype=np.uint8)
    out = viz.draw_boxes(img, [(Box(10, 10, 50, 40), viz.FOUND_COLOR, "#1")])
    assert out.shape == (100, 120, 3) and (img == 200).all()
    assert tuple(out[10, 30]) == viz.FOUND_COLOR
    out = viz.draw_ellipses(img, [(Ellipse(60, 50, 60, 40, 0), viz.TRUTH_COLOR)])
    assert tuple(out[50, 60]) == viz.TRUTH_COLOR  # 中心點


def test_mask_on_small_resizes_to_mask():
    img = np.full((200, 300, 3), 100, dtype=np.uint8)
    mask = np.zeros((100, 150), dtype=bool)
    mask[:10] = True
    out = viz.mask_on_small(img, mask)
    assert out.shape == (100, 150, 3) and out[0, 0, 2] > out[0, 0, 0]


def test_vlm_size_rows_shrink_with_side():
    img = label_scene(600, 800)
    rows = viz.vlm_size_rows(img, [256, 512, 1024], 85)
    assert [r["輸出尺寸"] for r in rows] == ["256×192", "512×384", "800×600"]
    sizes = [r["JPEG（KB）"] for r in rows]
    assert sizes == sorted(sizes)


def test_quad_errors():
    truth = np.zeros((4, 2), dtype=np.float32)
    found = truth + np.array([3, 4], dtype=np.float32)
    assert viz.quad_errors(found, truth) == [5.0] * 4


def test_report_rows():
    report = check_quality(np.zeros((10, 10), dtype=np.uint8))
    row = viz.report_metrics(report)
    assert row["通過"] is False and "TOO_DARK" in row["警告"]
    assert [r["步驟"] for r in viz.steps_rows(report)][0] == "resolution_check"


def test_discover_test_targets():
    targets = checks.discover_test_targets()
    assert "tests/preprocess" in targets
    assert "tests/test_validation.py" in targets


def test_pytest_command_flags():
    cmd = checks.pytest_command(["tests/preprocess"], include_slow=False, keyword=" blur ")
    assert cmd[-4:] == ["-m", "not slow", "-k", "blur"]
    assert "not slow" not in checks.pytest_command([], include_slow=True)


def test_run_reports_exit_code(tmp_path: Path):
    import sys

    ok = checks.run([sys.executable, "-c", "print('嗨')"], cwd=tmp_path)
    bad = checks.run([sys.executable, "-c", "raise SystemExit(3)"], cwd=tmp_path)
    assert ok.ok and "嗨" in ok.output
    assert not bad.ok and bad.returncode == 3


def test_changed_fields():
    assert configs.changed_fields(QualityConfig()) == []
    assert configs.changed_fields(QualityConfig(blur_min=1.0, dark_level=5)) == [
        "blur_min",
        "dark_level",
    ]


def test_degradation_active_count_ignores_seed():
    assert degradations.Degradation(seed=9).active_count() == 0
    assert degradations.Degradation(blur_sigma=1, gain=0.5).active_count() == 2


def test_first_trigger():
    levels = [0.0, 1.0, 2.0]
    warnings = ["", "TOO_DARK", "TOO_BLURRY, TOO_DARK"]
    assert degradations.first_trigger(levels, warnings, "TOO_DARK") == 1.0
    assert degradations.first_trigger(levels, warnings, "TOO_BLURRY") == 2.0
    assert degradations.first_trigger(levels, warnings, "LOW_RESOLUTION") is None


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        ("....\n90 passed in 3.61s\n", "90 passed in 3.61s"),
        ("== 1 failed, 89 passed in 2.1s ==", "1 failed, 89 passed in 2.1s"),
        ("no tests ran", None),
    ],
)
def test_pytest_summary(output, expected):
    assert checks.pytest_summary(output) == expected


def test_every_config_field_has_known_group():
    from dietai.preprocess.config import param_info
    from wb.text import GROUP_TEXT

    for cls in configs.CONFIG_CLASSES:
        assert {i.group for i in param_info(cls).values()} <= set(GROUP_TEXT)


def _rows():
    R, L = ladder_eval.RAW, ladder_eval.LADDER
    return [
        {"等級": 0.0, "樣本": 0, R: True, L: True, "成功階": "raw", "嘗試次數": 1},
        {"等級": 0.0, "樣本": 1, R: True, L: True, "成功階": "raw", "嘗試次數": 1},
        {"等級": 1.0, "樣本": 0, R: False, L: True, "成功階": "deskew", "嘗試次數": 6},
        {"等級": 1.0, "樣本": 1, R: False, L: False, "成功階": "", "嘗試次數": 8},
    ]


def test_ladder_success_rates_and_summary():
    rates = {(r["等級"], r["方法"]): r["成功率"] for r in ladder_eval.success_rates(_rows())}
    assert rates[(1.0, ladder_eval.RAW)] == 0 and rates[(1.0, ladder_eval.LADDER)] == 0.5
    assert ladder_eval.overall(_rows(), ladder_eval.LADDER) == 0.75
    assert ladder_eval.overall([], ladder_eval.RAW) == 0
    assert ladder_eval.first_failure(_rows(), ladder_eval.RAW) == 1.0
    assert ladder_eval.first_failure(_rows()[:2], ladder_eval.LADDER) is None
    counts = {(c["等級"], c["階"]): c["次數"] for c in ladder_eval.rung_counts(_rows())}
    assert counts == {(0.0, "raw"): 2, (1.0, "deskew"): 1}


def test_ladder_sweep_runs_both_methods():
    from dietai.preprocess import ZxingDecoder
    from dietai.synthetic import ean13_codes, ean13_scene, rotate

    samples = [ean13_scene(c) for c in ean13_codes(2)]
    rows = ladder_eval.ladder_sweep(samples, rotate, [0.0, 45.0], ZxingDecoder(), LadderConfig())
    assert len(rows) == 4
    at_45 = [r for r in rows if r["等級"] == 45.0]
    assert all(r[ladder_eval.LADDER] and not r[ladder_eval.RAW] for r in at_45)
    assert {r["成功階"] for r in at_45} == {"deskew"}
