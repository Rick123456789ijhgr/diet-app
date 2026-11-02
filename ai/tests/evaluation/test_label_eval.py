import json

import numpy as np
import pytest

from dietai.evaluation import (
    LabelTruth,
    cer,
    load_label_truth,
    located,
    quad_error,
    score_fields,
)
from dietai.label_parsing import parse_fields

TRUTH = {
    "columns": ["per_serving", "per_100g"],
    "header": {"serving_size": "30 公克", "servings": "6"},
    "facts": {
        "energy": ["152 大卡", "507 大卡"],
        "protein": ["2.10 公克", "7.0 公克"],
        "sodium": ["125 毫克", "417 毫克"],
    },
    "quad": [[0, 0], [300, 0], [300, 400], [0, 400]],
    "text": "營養標示 每一份量30公克",
}


def test_truth_parses_and_scores_all_correct():
    truth = LabelTruth.from_dict(TRUTH)
    assert len(truth.cells) == 2 + 3 * 2
    lines = [
        "每一份量 30公克",
        "本包裝含 6 份",
        "熱量 152 大卡 507 大卡",
        "蛋白質 2.1 公克 7 公克",
        "鈉 125 毫克 417 毫克",
        "脂肪 8.4 公克 28 公克",  # 真值沒標的欄位不影響分數
    ]
    score = score_fields(truth, parse_fields(lines))
    assert (score.correct, score.total, score.accuracy, score.all_correct) == (8, 8, 1.0, True)


def test_score_counts_wrong_and_missing_cells():
    truth = LabelTruth.from_dict(TRUTH)
    lines = [
        "每一份量 30公克",
        "熱量 152 大卡 50.7 大卡",
        "蛋白質 2.1 公克",
        "鈉 125 公克 417 毫克",
    ]
    score = score_fields(truth, parse_fields(lines))
    assert (score.correct, score.total) == (4, 8)
    assert not score.all_correct
    assert set(score.wrong) == {
        ("servings", ""),  # 沒讀到
        ("energy", "per_100g"),  # 小數點錯位
        ("protein", "per_100g"),  # 少一欄
        ("sodium", "per_serving"),  # 單位錯
    }
    assert score.wrong["servings", ""] is None
    assert str(score.wrong["energy", "per_100g"]) == "50.7kcal"


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"extra": 1}, "沒有這些鍵"),
        ({"header": {"weight": "30g"}}, "header 的欄位"),
        ({"facts": {"vitamin_c": ["1mg", "2mg"]}}, "facts 的欄位"),
        ({"facts": {"energy": ["152大卡"]}}, "長度 2"),
        ({"facts": {"energy": ["約 150", "未標示"]}}, "不是數值"),
        ({"columns": [], "header": {}}, "至少要有一個欄位"),
        ({"columns": ["a", "a"]}, "不得重複"),
        ({"quad": [[0, 0], [1, 1]]}, "quad"),
    ],
)
def test_truth_rejects_bad_annotations(patch, message):
    data = {**TRUTH, **patch}
    if patch.get("columns") == []:
        data.pop("facts")
    with pytest.raises(ValueError, match=message):
        LabelTruth.from_dict(data)


def test_load_label_truth_with_bom(tmp_path):
    path = tmp_path / "p0001.json"
    path.write_text(json.dumps(TRUTH, ensure_ascii=False), encoding="utf-8-sig")
    truth = load_label_truth(path)
    assert truth.quad is not None and truth.text == TRUTH["text"]
    path.write_text('{"header": {"weight": "1g"}}', encoding="utf-8")
    with pytest.raises(ValueError, match="p0001.json"):
        load_label_truth(path)


def test_cer():
    assert cer("營養標示", "營養標示") == 0
    assert cer("abc", "abd") == pytest.approx(1 / 3)  # 替換
    assert cer("abc", "ab") == pytest.approx(1 / 3)  # 刪除
    assert cer("ab", "abcd") == pytest.approx(1.0)  # 插入兩個
    assert cer("熱量 152 大卡", "熱量１５２大卡") == 0  # 全形與空白先正規化
    with pytest.raises(ValueError):
        cer("  ", "x")


def test_quad_error_and_located():
    truth = np.array(TRUTH["quad"], dtype=float)
    assert quad_error(truth, truth) == 0
    # 起點不同（旋轉超過 45° 時「左上」換角）仍算同一個四邊形
    assert quad_error(np.roll(truth, 1, axis=0), truth) == 0
    # 整體平移 10 px：誤差 10 ÷ 對角線 500
    assert quad_error(truth + [6, 8], truth) == pytest.approx(10 / 500)
    assert located(truth + [6, 8], truth, tol=0.02)
    assert not located(truth + [60, 80], truth)
    assert not located(None, truth)
    with pytest.raises(ValueError):
        quad_error(truth, np.zeros((4, 2)))
