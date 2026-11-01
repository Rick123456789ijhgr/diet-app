from decimal import Decimal

import pytest

from dietai.label_parsing import (
    FIELDS,
    OcrBox,
    Quantity,
    format_fields,
    group_lines,
    normalize_text,
    parse_fields,
    parse_quantity,
)

# 典型的台灣營養標示（兩欄：每份、每 100 公克），OCR 已排成文字行
TW_LINES = [
    "營養標示",
    "每一份量 30 公克",
    "本包裝含 6 份",
    "每份 每100公克",
    "熱量 152 大卡 507 大卡",
    "蛋白質 2.1 公克 7.0 公克",
    "脂肪 8.4 公克 28.0 公克",
    "飽和脂肪 3.2 公克 10.7 公克",
    "反式脂肪 0 公克 0 公克",
    "碳水化合物 17.0 公克 56.7 公克",
    "糖 1.5 公克 5.0 公克",
    "鈉 125 毫克 417 毫克",
]


def q(value: str, unit: str) -> Quantity:
    return Quantity(Decimal(value), unit)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("２．１　公克", "2.1g"),  # 全形數字、小數點、空白
        ("152 大卡", "152kcal"),
        ("152 千卡", "152kcal"),
        ("125 毫克", "125mg"),
        ("250 毫升", "250ml"),
        ("30克", "30g"),
        ("1,200 毫克", "1200mg"),  # 千分位
        ("2,1 g", "2.1g"),  # OCR 把小數點讀成逗號
        ("Saturated Fat", "saturatedfat"),
    ],
)
def test_normalize_text(raw, expected):
    assert normalize_text(raw) == expected


def test_parse_quantity():
    assert parse_quantity("2.10 公克") == q("2.1", "g")  # 十進位比較：2.10 == 2.1
    assert str(parse_quantity("7.0公克")) == "7g"
    assert parse_quantity("6", default_unit="份") == q("6", "份")
    assert parse_quantity("15%") is None  # 每日參考值百分比不算
    assert parse_quantity("未檢出") is None


def test_parse_two_column_taiwan_label():
    fields = parse_fields(TW_LINES)
    assert set(fields) == set(FIELDS)
    assert fields["serving_size"] == [q("30", "g")]
    assert fields["servings"] == [q("6", "份")]
    assert fields["energy"] == [q("152", "kcal"), q("507", "kcal")]
    # 「飽和脂肪」「反式脂肪」不會被當成「脂肪」
    assert fields["fat"] == [q("8.4", "g"), q("28", "g")]
    assert fields["saturated_fat"] == [q("3.2", "g"), q("10.7", "g")]
    assert fields["trans_fat"] == [q("0", "g"), q("0", "g")]
    assert fields["sodium"] == [q("125", "mg"), q("417", "mg")]
    assert format_fields(fields)["protein"] == ["2.1g", "7g"]


def test_parse_header_on_one_line_and_percent_column():
    fields = parse_fields(["每一份量30公克，本包裝含6份", "熱量 152大卡 8%", "鈉 125毫克 6%"])
    assert fields["serving_size"] == [q("30", "g")]
    assert fields["servings"] == [q("6", "份")]
    assert fields["energy"] == [q("152", "kcal")]
    assert fields["sodium"] == [q("125", "mg")]


def test_parse_english_label_and_first_occurrence_wins():
    lines = [
        "Serving size 30 g",
        "Servings 6",
        "Calories 152 kcal",
        "Total Fat 8.4 g",
        "  Saturated fat 3.2 g",
        "Sugars 1.5 g",
        "Calories 999 kcal",  # 同一欄位再出現時以第一次為準
        "Protein",  # 沒有數值的行不算
        "Protein 2.1 g",
    ]
    fields = parse_fields(lines)
    assert fields["serving_size"] == [q("30", "g")]  # 「servingsize」不會被當成「servings」
    assert fields["servings"] == [q("6", "份")]
    assert fields["energy"] == [q("152", "kcal")]
    assert fields["fat"] == [q("8.4", "g")]
    assert fields["saturated_fat"] == [q("3.2", "g")]
    assert fields["sugar"] == [q("1.5", "g")]
    assert fields["protein"] == [q("2.1", "g")]


def test_group_lines_merges_boxes_on_the_same_row():
    boxes = [
        OcrBox("2.1公克", 300, 52, 80, 20),
        OcrBox("蛋白質", 10, 50, 60, 22),
        OcrBox("熱量", 10, 20, 40, 22),
        OcrBox("152大卡", 300, 18, 80, 20),
        OcrBox("營養標示", 100, -10, 120, 24),
    ]
    assert group_lines(boxes) == ["營養標示", "熱量 152大卡", "蛋白質 2.1公克"]
    assert parse_fields(group_lines(boxes))["protein"] == [q("2.1", "g")]
    assert group_lines([]) == []
    with pytest.raises(ValueError):
        group_lines(boxes, overlap=0)


def test_synthetic_label_rows_parse_completely():
    # 合成營養標示（synthetic.nutrition_label）的每一列都能解析，供合成資料演練整套流程
    from dietai.synthetic.scenes import _LABEL_ROWS

    fields = parse_fields(f"{name} {value}" for name, value in _LABEL_ROWS)
    assert set(fields) == set(FIELDS)
    assert fields["energy"] == [q("152", "kcal")] and fields["servings"] == [q("6", "份")]
