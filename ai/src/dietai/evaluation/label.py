"""營養標示的真值格式與評估指標（實驗設計 3.3、8.2 節）。

**真值檔**（每個原始樣本一個 JSON，由 manifest 的 ``truth`` 欄指向，路徑相對於 manifest）::

    {
      "columns": ["per_serving", "per_100g"],
      "header": {"serving_size": "30 公克", "servings": "6 份"},
      "facts": {
        "energy": ["152 大卡", "507 大卡"],
        "protein": ["2.1 公克", "7.0 公克"],
        "sodium": ["125 毫克", "417 毫克"]
      },
      "quad": [[120, 80], [940, 95], [930, 1310], [110, 1290]],
      "text": "營養標示\\n每一份量30公克\\n本包裝含6份\\n..."
    }

- ``columns``：營養素的欄位順序（每份、每 100 公克等），``facts`` 每個欄位的串列長度須與之相同；
  標示上沒有的欄位不列。``header`` 與 ``facts`` 的鍵須為 ``label_parsing.fields.FIELDS`` 之一。
- 數值照標示上的寫法輸入（含單位），比對時以 ``fields.normalize_text`` 的規則正規化，
  ``2.10 公克`` 與 ``2.1g`` 相同。``quad``（原圖座標，左上起順時針）與 ``text``（全文）可省略，
  省略時不計算定位誤差與 CER。
- 由兩人獨立標記後比對，不一致處由第三人裁定（設計 3.3 節）；不要用 Excel 編輯。

**指標**：

- 欄位完全正確率（主要指標）：真值中每個（欄位, 欄）一格，數值與單位都相同才算對；另報整張全對。
- 定位誤差：四角與真值的平均距離 ÷ 真值兩條對角線的平均長度；誤差不超過門檻算定位成功。
- CER：(S + D + I) ÷ N，以正規化後（NFKC、去除空白）的字元計算。
"""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from dietai.label_parsing.fields import (
    DEFAULT_UNITS,
    HEADER_FIELDS,
    NUTRIENT_FIELDS,
    Quantity,
    parse_quantity,
)

# 定位成功的預設門檻：平均角誤差不超過對角線的 2%（暫定，依 dev 結果調整後寫入實驗 README）
DEFAULT_QUAD_TOL = 0.02
_TRUTH_KEYS = frozenset({"columns", "header", "facts", "quad", "text"})


@dataclass(frozen=True)
class LabelTruth:
    """一個原始樣本的營養標示真值。``cells`` 為（欄位, 欄）→ 數值，表頭欄位的欄為空字串。"""

    columns: tuple[str, ...]
    cells: Mapping[tuple[str, str], Quantity]
    quad: tuple[tuple[float, float], ...] | None = None
    text: str | None = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> LabelTruth:
        """由 JSON 物件建立並檢查格式；不符時丟 ``ValueError``（訊息指出哪個欄位）。"""
        unknown = set(data) - _TRUTH_KEYS
        if unknown:
            raise ValueError(f"真值沒有這些鍵：{sorted(unknown)}")
        columns = tuple(str(c) for c in data.get("columns", ()))
        if len(set(columns)) != len(columns):
            raise ValueError(f"columns 不得重複：{list(columns)}")
        cells: dict[tuple[str, str], Quantity] = {}
        for name, raw in dict(data.get("header", {})).items():
            if name not in HEADER_FIELDS:
                raise ValueError(f"header 的欄位須為 {HEADER_FIELDS} 之一，收到 {name!r}")
            cells[name, ""] = _truth_quantity(name, str(raw))
        facts = dict(data.get("facts", {}))
        if facts and not columns:
            raise ValueError("有 facts 時須提供 columns")
        for name, values in facts.items():
            if name not in NUTRIENT_FIELDS:
                raise ValueError(f"facts 的欄位須為 {NUTRIENT_FIELDS} 之一，收到 {name!r}")
            if not isinstance(values, list) or len(values) != len(columns):
                raise ValueError(f"{name} 須為長度 {len(columns)} 的串列（對應 columns）")
            for col, raw in zip(columns, values, strict=True):
                cells[name, col] = _truth_quantity(name, str(raw))
        if not cells:
            raise ValueError("真值至少要有一個欄位")
        quad = data.get("quad")
        if quad is not None:
            pts = np.asarray(quad, dtype=np.float64)
            if pts.shape != (4, 2):
                raise ValueError(f"quad 須為四個 [x, y]，收到形狀 {pts.shape}")
            quad = tuple((float(x), float(y)) for x, y in pts)
        text = data.get("text")
        return cls(columns, cells, quad, None if text is None else str(text))


def _truth_quantity(name: str, raw: str) -> Quantity:
    """真值的一格；無法解析成數值時丟 ``ValueError``（標記錯誤）。"""
    q = parse_quantity(raw, DEFAULT_UNITS.get(name, ""))
    if q is None:
        raise ValueError(f"{name} 的真值 {raw!r} 不是數值")
    return q


def load_label_truth(path: str | Path) -> LabelTruth:
    """讀取一個真值 JSON 檔（UTF-8，可含 BOM）。"""
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError(f"真值必須是 JSON 物件：{path}")
    try:
        return LabelTruth.from_dict(data)
    except ValueError as e:
        raise ValueError(f"{path.name}：{e}") from e


@dataclass(frozen=True)
class FieldScore:
    """欄位比對結果。``wrong`` 為答錯或沒讀到的（欄位, 欄）與讀到的值（沒讀到為 ``None``）。"""

    correct: int
    total: int
    wrong: Mapping[tuple[str, str], Quantity | None] = field(default_factory=dict)

    @property
    def accuracy(self) -> float:
        """欄位完全正確率（主要指標）。"""
        return self.correct / self.total

    @property
    def all_correct(self) -> bool:
        """整張表所有欄位皆正確。"""
        return self.correct == self.total


def score_fields(truth: LabelTruth, parsed: Mapping[str, Sequence[Quantity]]) -> FieldScore:
    """比對 ``fields.parse_fields`` 的結果與真值。

    營養素依 ``columns`` 的順序對應讀到的第幾個數值（第 1 欄對第 1 個值）；表頭欄位取第一個值。
    多讀到的值不扣分（例如真值只標了每份，但標示上也有每 100 公克）；少讀到的欄算錯。
    """
    correct = 0
    wrong: dict[tuple[str, str], Quantity | None] = {}
    for (name, col), expected in truth.cells.items():
        values = parsed.get(name, ())
        i = truth.columns.index(col) if col else 0
        got = values[i] if i < len(values) else None
        if got == expected:
            correct += 1
        else:
            wrong[name, col] = got
    return FieldScore(correct, len(truth.cells), wrong)


def normalize_for_cer(text: str) -> str:
    """CER 的正規化：NFKC（全形轉半形）並去除所有空白；不轉小寫、不改單位。"""
    return "".join(unicodedata.normalize("NFKC", text).split())


def cer(reference: str, hypothesis: str) -> float:
    """字元錯誤率 (S + D + I) ÷ N（N 為正規化後的真值字元數）；真值為空時丟 ``ValueError``。

    中文沒有天然的詞界，不使用 WER（設計 8.2 節）。可能大於 1（辨識結果比真值長很多時）。
    """
    ref, hyp = normalize_for_cer(reference), normalize_for_cer(hypothesis)
    if not ref:
        raise ValueError("真值全文為空，無法計算 CER")
    # 編輯距離：只保留上一列，記憶體 O(len(hyp))
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, start=1):
        cur = [i]
        for j, h in enumerate(hyp, start=1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h)))
        prev = cur
    return prev[-1] / len(ref)


def quad_error(found: npt.ArrayLike, truth: npt.ArrayLike) -> float:
    """四角與真值的平均距離 ÷ 真值兩條對角線的平均長度（設計 8.2 節）。

    兩者都是左上起順時針，但影像旋轉超過 45° 時「左上」會換成另一個角；因此在四種循環對應中
    取平均距離最小者（同 ``devtools.label_eval.corner_errors``）。
    """
    f = np.asarray(found, dtype=np.float64).reshape(4, 2)
    t = np.asarray(truth, dtype=np.float64).reshape(4, 2)
    mean_dist = min(
        float(np.linalg.norm(np.roll(f, k, axis=0) - t, axis=1).mean()) for k in range(4)
    )
    diagonal = (np.linalg.norm(t[0] - t[2]) + np.linalg.norm(t[1] - t[3])) / 2
    if diagonal <= 0:
        raise ValueError("真值四邊形的對角線長度為 0")
    return mean_dist / float(diagonal)


def located(
    found: npt.ArrayLike | None, truth: npt.ArrayLike, tol: float = DEFAULT_QUAD_TOL
) -> bool:
    """定位成功：有找到四邊形且 ``quad_error`` 不超過 ``tol``。"""
    return found is not None and quad_error(found, truth) <= tol
