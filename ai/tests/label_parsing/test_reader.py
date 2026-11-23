from decimal import Decimal

import numpy as np
import pytest

from dietai.devtools.configs import config_from_override
from dietai.label_parsing import (
    LabelReadConfig,
    LabelReadWarning,
    OcrBox,
    Quantity,
    detect_columns,
    read_label,
    to_nutrition_label,
)
from dietai.preprocess import LabelConfig
from dietai.preprocess.types import PreprocessWarning

RAW = LabelConfig(
    enable_rectify=False,
    enable_glare=False,
    enable_denoise=False,
    enable_contrast=False,
    enable_binarize=False,
)
RAW_READ = LabelReadConfig(preprocess=RAW)

HEADER = ["營養標示", "每一份量 30 公克", "本包裝含 6 份"]
ROWS = [
    ("熱量", "152 大卡", "507 大卡"),
    ("蛋白質", "2.1 公克", "7.0 公克"),
    ("脂肪", "8.4 公克", "28.0 公克"),
    ("飽和脂肪", "3.2 公克", "10.7 公克"),
    ("反式脂肪", "0 公克", "0 公克"),
    ("碳水化合物", "17.0 公克", "56.7 公克"),
    ("糖", "1.5 公克", "5.0 公克"),
    ("鈉", "125 毫克", "417 毫克"),
]


def two_columns(column_header="每份 每100公克", rows=ROWS):
    return [*HEADER, column_header, *(" ".join(r) for r in rows)]


class FakeOcr:
    """把指定的文字行當成 OCR 結果（每行一個框，由上到下）。"""

    def __init__(self, lines, name="fake 1.0"):
        self.lines = lines
        self.name = name
        self.seen = None

    def __call__(self, img):
        self.seen = img
        return [OcrBox(t, 0, 30 * i, 100, 20, 0.9) for i, t in enumerate(self.lines)]


def image():
    return np.full((60, 80, 3), 200, dtype=np.uint8)


def q(value, unit):
    return Quantity(Decimal(value), unit)


def test_two_columns_are_assigned_to_their_basis():
    r = read_label(image(), FakeOcr(two_columns()), RAW_READ)
    assert r.columns == ("per_serving", "per_100g")
    assert len(r.cells) == 18  # 8 營養素 × 2 欄 + 2 個表頭欄位
    assert r.cells["serving_size", ""] == q("30", "g")
    assert r.cells["servings", ""] == q("6", "份")
    assert r.cells["protein", "per_serving"] == q("2.1", "g")
    assert r.cells["protein", "per_100g"] == q("7.0", "g")
    assert r.cells["sodium", "per_100g"] == q("417", "mg")
    assert r.warnings == ()
    assert r.checks and all(c.passed for c in r.checks)
    assert r.ocr_engine == "fake 1.0"
    assert [s.name for s in r.steps] == ["ocr", "parse_label"]


def test_daily_value_column_is_not_a_column():
    rows = [(n, a, "7.6%") for n, a, _ in ROWS]
    r = read_label(image(), FakeOcr(two_columns("每份 每日參考值百分比", rows)), RAW_READ)
    assert r.columns == ("per_serving",)
    assert r.cells["energy", "per_serving"] == q("152", "kcal")
    assert r.warnings == ()


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("每份 每100公克", ("per_serving", "per_100g")),
        ("每 100 公克  每份", ("per_100g", "per_serving")),
        ("每份 每100毫升", ("per_serving", "per_100ml")),
        ("每份 每份提供每日參考值百分比", ("per_serving",)),
        ("Per serving  Per 100 g", ("per_serving", "per_100g")),
        ("每份 每份", ()),  # 同一基準兩次：歧義，不猜
    ],
)
def test_detect_columns(line, expected):
    assert detect_columns([*HEADER, line, "熱量 1 大卡"]) == expected


def test_header_field_line_is_not_a_column_header():
    # 「每一份量」含「每一份」，但它是表頭欄位（serving_size），不能當成欄基準
    assert detect_columns(["每一份量 30 公克", "熱量 152 大卡"]) == ()


def test_missing_header_leaves_basis_unknown():
    lines = [*HEADER, *(" ".join(r) for r in ROWS)]
    r = read_label(image(), FakeOcr(lines), RAW_READ)
    assert r.columns == ()
    assert LabelReadWarning.LABEL_BASIS_UNKNOWN in r.warnings
    # 營養素沒有基準就不填；表頭欄位照填；原始解析結果仍保留，供人工指定
    assert set(r.cells) == {("serving_size", ""), ("servings", "")}
    assert r.fields["energy"] == (q("152", "kcal"), q("507", "kcal"))
    assert r.checks == ()


def test_column_count_mismatch_skips_only_that_nutrient():
    rows = list(ROWS)
    rows[1] = ("蛋白質", "2.1 公克", "")  # 只讀到一個值
    r = read_label(image(), FakeOcr(two_columns(rows=rows)), RAW_READ)
    assert LabelReadWarning.LABEL_COLUMN_MISMATCH in r.warnings
    assert ("protein", "per_serving") not in r.cells
    assert ("fat", "per_serving") in r.cells
    # 少了蛋白質，兩欄都不齊全，不做驗證
    assert r.checks == ()


def test_unit_mismatch_skips_the_whole_row():
    rows = list(ROWS)
    rows[2] = ("脂肪", "8.49", "28.0 公克")  # OCR 把 8.4g 讀成 8.49、漏掉單位
    r = read_label(image(), FakeOcr(two_columns(rows=rows)), RAW_READ)
    # 去除空白後兩個數字黏在一起，解析成 8.4928 與 0g：第二格的 0g 是錯的，整列都不能填
    assert r.fields["fat"] == (q("8.4928", ""), q("0", "g"))
    assert LabelReadWarning.LABEL_UNIT_MISMATCH in r.warnings
    assert ("fat", "per_serving") not in r.cells and ("fat", "per_100g") not in r.cells
    assert ("protein", "per_100g") in r.cells


def test_energy_must_be_kcal():
    rows = list(ROWS)
    rows[0] = ("熱量", "152 公克", "507 公克")
    r = read_label(image(), FakeOcr(two_columns(rows=rows)), RAW_READ)
    assert ("energy", "per_serving") not in r.cells
    assert LabelReadWarning.LABEL_UNIT_MISMATCH in r.warnings


def test_failed_check_only_warns_and_keeps_values():
    rows = list(ROWS)
    rows[0] = ("熱量", "1520 大卡", "507 大卡")  # 多讀一個 0
    r = read_label(image(), FakeOcr(two_columns(rows=rows)), RAW_READ)
    assert r.cells["energy", "per_serving"] == q("1520", "kcal")
    failed = [c.rule for c in r.checks if not c.passed]
    assert failed == ["atwater"]


def test_check_tolerances_come_from_config():
    rows = list(ROWS)
    rows[0] = ("熱量", "175 大卡", "507 大卡")  # 推算 152，差 15%
    lines = two_columns(rows=rows)
    loose = read_label(image(), FakeOcr(lines), RAW_READ)
    strict = read_label(image(), FakeOcr(lines), LabelReadConfig(RAW, atwater_rel_tol=0.05))
    assert all(c.passed for c in loose.checks)
    assert [c.rule for c in strict.checks if not c.passed] == ["atwater"]


def test_per_100ml_is_validated_as_per_100():
    r = read_label(image(), FakeOcr(two_columns("每份 每100毫升")), RAW_READ)
    assert r.columns == ("per_serving", "per_100ml")
    label = to_nutrition_label(r.cells)
    assert label is not None and label.per_100g is not None
    assert label.per_100g.energy_kcal == 507


def test_no_fields():
    r = read_label(image(), FakeOcr(["營養標示"]), RAW_READ)
    assert r.warnings == (LabelReadWarning.LABEL_NO_FIELDS,)
    assert r.cells == {} and r.checks == ()


def test_default_preprocess_falls_back_to_original_image():
    img = image()
    before = img.copy()
    ocr = FakeOcr(two_columns())
    r = read_label(img, ocr)
    np.testing.assert_array_equal(img, before)  # 不修改輸入
    assert PreprocessWarning.LABEL_NOT_LOCATED in r.warnings
    assert r.quad is None and len(r.cells) == 18  # 找不到表格仍照常讀取
    assert ocr.seen is r.image
    assert r.steps[0].name == "locate_label_quad" and r.steps[-1].name == "parse_label"


def test_invalid_image():
    with pytest.raises(ValueError):
        read_label(np.zeros((4, 4), dtype=np.float32), FakeOcr([]))


def test_config_from_json_override():
    cfg = config_from_override(
        LabelReadConfig, {"preprocess": {"enable_rectify": False}, "line_overlap": 0.6}
    )
    assert cfg.preprocess == LabelConfig(enable_rectify=False)
    assert cfg.line_overlap == 0.6
    with pytest.raises(ValueError, match="line_overlap"):
        LabelReadConfig(line_overlap=0)
    with pytest.raises(ValueError, match="atwater_rel_tol"):
        LabelReadConfig(atwater_rel_tol=-0.1)
