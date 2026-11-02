"""營養標示欄位解析：由 OCR 的文字行找出各欄位的數值與單位（規則式，不使用 LLM）。

數字一律由這裡的確定性程式從文字取出（根目錄 CLAUDE.md 規則 1），不採用任何模型輸出的數字。
比對前的正規化（實驗設計 8.2 節）固定為：

1. Unicode NFKC（全形英數、全形小數點轉半形），轉小寫，去除所有空白；
2. 單位統一：大卡／千卡 → ``kcal``、毫克 → ``mg``、公克／克 → ``g``、毫升 → ``ml``；
3. 數字中的逗號：後面剛好接三位數字視為千分位（``1,200``），否則視為小數點
   （``2,1``，常見的 OCR 誤讀）；
4. 數值以十進位比較，``2.10`` 與 ``2.1`` 相同。

欄位（``FIELDS``）依法規營養標示的項目：``serving_size``（每一份量）、``servings``（本包裝含幾份）
兩個表頭欄位，與熱量、蛋白質、脂肪、飽和脂肪、反式脂肪、碳水化合物、糖、鈉八個營養素欄位。
營養素可能有多欄（每份、每 100 公克），同一行中依出現順序取得各欄的數值；百分比（每日參考值）略過。
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

HEADER_FIELDS = ("serving_size", "servings")
NUTRIENT_FIELDS = (
    "energy",
    "protein",
    "fat",
    "saturated_fat",
    "trans_fat",
    "carbohydrate",
    "sugar",
    "sodium",
)
FIELDS = (*HEADER_FIELDS, *NUTRIENT_FIELDS)
UNITS = ("kcal", "mg", "ml", "g", "份")
# 份數沒有寫單位時的預設單位
DEFAULT_UNITS: Mapping[str, str] = {"servings": "份"}

# 欄位名稱（正規化後：小寫、無空白）。同一位置以最長者優先，
# 「飽和脂肪」不會被當成「脂肪」、「servingsize」不會被當成「servings」。
KEYWORDS: Mapping[str, tuple[str, ...]] = {
    "serving_size": ("每一份量", "每份量", "每份重量", "servingsize"),
    "servings": ("本包裝含", "本包装含", "servingsperpackage", "servingsper", "servings"),
    "energy": ("熱量", "calories", "energy"),
    "protein": ("蛋白質", "protein"),
    "fat": ("脂肪", "totalfat", "fat"),
    "saturated_fat": ("飽和脂肪", "saturatedfat"),
    "trans_fat": ("反式脂肪", "transfat"),
    "carbohydrate": ("碳水化合物", "carbohydrates", "carbohydrate"),
    "sugar": ("糖", "sugars", "sugar"),
    "sodium": ("鈉", "sodium"),
}
_KEYWORDS_BY_LENGTH = sorted(
    ((kw, field) for field, kws in KEYWORDS.items() for kw in kws), key=lambda x: -len(x[0])
)
# 單位同義詞，依序替換（「毫克」「公克」要在「克」之前）
_UNIT_SYNONYMS = (
    ("大卡", "kcal"),
    ("千卡", "kcal"),
    ("毫克", "mg"),
    ("公克", "g"),
    ("毫升", "ml"),
    ("克", "g"),
)
# 數值後接單位；後面接 % 的是每日參考值百分比，略過
_QUANTITY = re.compile(r"(\d+(?:\.\d+)?)(kcal|mg|ml|g|份)?(%)?")
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")
_DECIMAL_COMMA = re.compile(r"(?<=\d),(?=\d)")


@dataclass(frozen=True)
class Quantity:
    """一個數值與單位。

    ``value`` 為十進位數，比較時 ``2.10 == 2.1``；``unit`` 為 ``UNITS`` 之一或空字串。
    """

    value: Decimal
    unit: str

    def __str__(self) -> str:
        return f"{_plain(self.value)}{self.unit}"


def normalize_text(text: str) -> str:
    """比對用的正規化：NFKC、小寫、去除空白、統一單位與小數點（見模組說明）。"""
    s = unicodedata.normalize("NFKC", text).lower()
    s = re.sub(r"\s+", "", s)
    for word, unit in _UNIT_SYNONYMS:
        s = s.replace(word, unit)
    s = _THOUSANDS.sub("", s)
    return _DECIMAL_COMMA.sub(".", s)


def parse_quantity(text: str, default_unit: str = "") -> Quantity | None:
    """由一段文字取出第一個數值與單位（例如 ``"2.1 公克"`` → 2.1 g）；沒有數值時回傳 ``None``。

    沒有單位時用 ``default_unit``。百分比不算。
    """
    for q in _quantities(normalize_text(text), default_unit):
        return q
    return None


def parse_fields(lines: Iterable[str]) -> dict[str, list[Quantity]]:
    """由 OCR 的文字行解析各欄位的數值（依出現順序，可有多欄）。

    同一行可有多個欄位（例如「每一份量 30 公克，本包裝含 6 份」），每個欄位取「它到下一個
    欄位名稱之間」的數值。同一欄位出現在多行時，以第一次有數值的那一行為準。
    找不到的欄位不會出現在結果中。
    """
    out: dict[str, list[Quantity]] = {}
    for line in lines:
        s = normalize_text(line)
        hits = _find_keywords(s)
        for i, (_, end, field) in enumerate(hits):
            stop = hits[i + 1][0] if i + 1 < len(hits) else len(s)
            values = list(_quantities(s[end:stop], DEFAULT_UNITS.get(field, "")))
            if values and field not in out:
                out[field] = values
    return out


def _find_keywords(s: str) -> list[tuple[int, int, str]]:
    """由左到右找出欄位名稱（同一位置最長者優先、互不重疊），回傳（起點, 終點, 欄位）。"""
    hits: list[tuple[int, int, str]] = []
    i = 0
    while i < len(s):
        for kw, field in _KEYWORDS_BY_LENGTH:
            if s.startswith(kw, i):
                hits.append((i, i + len(kw), field))
                i += len(kw)
                break
        else:
            i += 1
    return hits


def _quantities(s: str, default_unit: str) -> Iterable[Quantity]:
    """依序產出正規化文字中的數值（略過百分比）。"""
    for m in _QUANTITY.finditer(s):
        if m.group(3):
            continue
        try:
            value = Decimal(m.group(1))
        except InvalidOperation:  # 正規式已保證是數字；防禦性檢查
            continue
        yield Quantity(value, m.group(2) or default_unit)


def _plain(value: Decimal) -> str:
    """不帶指數與多餘 0 的十進位字串（``2.10`` → ``"2.1"``、``1E+2`` → ``"100"``）。"""
    return format(value.normalize(), "f")


def format_fields(fields: Mapping[str, Sequence[Quantity]]) -> dict[str, list[str]]:
    """把解析結果轉成可寫成 JSON 的字串（例如 ``{"protein": ["2.1g", "7g"]}``）。"""
    return {k: [str(q) for q in v] for k, v in fields.items()}
