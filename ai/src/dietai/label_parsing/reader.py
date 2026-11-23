"""營養標示讀取：前處理 → OCR → 欄位解析 → 欄基準判斷 → 邏輯驗證（模組二的單一入口）。

產品程式（gRPC ``LabelService.ParseLabel``）與研究（``evaluation.label_run``，E2）都呼叫
``read_label``，實驗量到的就是上線的流程。前處理屬模組一，這裡直接呼叫
``dietai.preprocess.preprocess_label``；OCR 只依賴 ``OcrEngine`` 介面
（實作在 ``dietai.adapters``）。

數字規則（根目錄 CLAUDE.md 規則 1）：數值只來自 ``fields.parse_fields`` 的規則式解析，以
``Decimal`` 保存。對不上的格一律留空並附警告，不猜：

- 欄基準（每份、每 100 公克、每 100 毫升）由表頭行的關鍵字決定；找不到表頭時附
  ``LABEL_BASIS_UNKNOWN``，營養素不指定基準。「每日參考值百分比」欄不算一欄（``parse_fields``
  本來就略過百分比）。
- 某個營養素讀到的數值個數與欄數不同時，該營養素不填，附 ``LABEL_COLUMN_MISMATCH``。
- 單位不符（例如熱量不是 kcal、OCR 漏掉單位）時該營養素整列不填，附 ``LABEL_UNIT_MISMATCH``。

讀取結果只是候選值：寫入資料庫前須經人確認，並由 Go 寫入（規則 2）。
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum

from dietai.domain.nutrition_label import NutritionFacts, NutritionLabel
from dietai.label_parsing.config import LabelReadConfig
from dietai.label_parsing.fields import (
    HEADER_FIELDS,
    NUTRIENT_FIELDS,
    Quantity,
    _find_keywords,
    normalize_text,
    parse_fields,
)
from dietai.label_parsing.ocr import OcrBox, OcrEngine, group_lines
from dietai.label_parsing.validation import RuleResult, validate
from dietai.preprocess.label import preprocess_label
from dietai.preprocess.types import Image, PreprocessWarning, Quad, StepRecord

# 欄基準（名稱同 evaluation.label 的真值格式 columns）
PER_SERVING = "per_serving"
PER_100G = "per_100g"
PER_100ML = "per_100ml"
BASES = (PER_SERVING, PER_100G, PER_100ML)
_PERCENT = "percent"  # 每日參考值百分比欄：不是數值欄，只用來辨認表頭

# 表頭關鍵字（normalize_text 之後：小寫、無空白、公克 → g、毫升 → ml）。同一位置以最長者優先，
# 「每份提供每日參考值百分比」不會被當成「每份」。
_BASIS_KEYWORDS: Mapping[str, tuple[str, ...]] = {
    _PERCENT: (
        "每份提供每日參考值百分比",
        "每日參考值百分比",
        "參考值百分比",
        "%dailyvalue",
        "dailyvalue",
        "%dv",
    ),
    PER_100G: ("每100g", "每一百g", "per100g"),
    PER_100ML: ("每100ml", "每一百ml", "per100ml"),
    PER_SERVING: ("每一份", "每份", "perserving"),
}
_BASIS_BY_LENGTH = sorted(
    ((kw, basis) for basis, kws in _BASIS_KEYWORDS.items() for kw in kws), key=lambda x: -len(x[0])
)

# 各欄位可接受的單位；不符者不填
_UNITS: Mapping[str, tuple[str, ...]] = {
    "serving_size": ("g", "ml"),
    "servings": ("份",),
    "energy": ("kcal",),
    "sodium": ("mg",),
    **{f: ("g",) for f in NUTRIENT_FIELDS if f not in ("energy", "sodium")},
}

OCR_STEP = "ocr"
PARSE_STEP = "parse_label"


class LabelReadWarning(StrEnum):
    """讀取階段的提示代碼（前處理的代碼見 ``preprocess.types.PreprocessWarning``）。"""

    LABEL_NO_FIELDS = "LABEL_NO_FIELDS"  # 一個欄位都沒讀到
    LABEL_BASIS_UNKNOWN = "LABEL_BASIS_UNKNOWN"  # 找不到表頭，營養素不指定基準
    LABEL_COLUMN_MISMATCH = "LABEL_COLUMN_MISMATCH"  # 某營養素的數值個數與欄數不同
    LABEL_UNIT_MISMATCH = "LABEL_UNIT_MISMATCH"  # 某格的單位不符（含 OCR 漏掉單位）


@dataclass(frozen=True)
class LabelReading:
    """一張營養標示的讀取結果（候選值）。

    - ``cells``：（欄位, 基準）→ 數值；表頭欄位（``serving_size``、``servings``）的基準為空字串。
      只含確定的格。
    - ``columns``：判斷出的欄基準，依標示上由左到右；判斷不出時為空。
    - ``fields``：``parse_fields`` 的原始結果（每個欄位依位置的所有數值），欄基準判斷不出時
      供人工指定；E2 的欄位評分也用這個（``evaluation.label.score_fields`` 依位置比對）。
    - ``boxes``：OCR 文字框，座標為 ``image``（前處理後、交給 OCR 的影像）上的像素。
    - ``quad``：原圖上的表格四角；未定位或找不到時為 ``None``。
    - ``checks``：邏輯驗證結果，只提示、不修改數值；沒有完整的一欄時為空。
    """

    cells: Mapping[tuple[str, str], Quantity]
    columns: tuple[str, ...]
    fields: Mapping[str, tuple[Quantity, ...]]
    lines: tuple[str, ...]
    boxes: tuple[OcrBox, ...]
    image: Image
    quad: Quad | None
    checks: tuple[RuleResult, ...]
    ocr_engine: str
    steps: tuple[StepRecord, ...] = ()
    warnings: tuple[PreprocessWarning | LabelReadWarning, ...] = field(default_factory=tuple)


def read_label(
    image: Image, ocr: OcrEngine, cfg: LabelReadConfig = LabelReadConfig()
) -> LabelReading:
    """讀取一張營養標示照片（BGR 或灰階 ``uint8``，不會被修改）。

    依序執行 ``preprocess_label(image, cfg.preprocess)``、``ocr``、``group_lines``
    （``cfg.line_overlap``）、``parse_fields``、欄基準判斷與 ``validation.validate``
    （``cfg.atwater_*``、``cfg.serving_rel_tol``）。找不到表格時前處理以原圖繼續
    （``LABEL_NOT_LOCATED``）。影像格式錯誤丟 ``ValueError``；OCR 引擎的例外不攔截，由呼叫端決定。
    """
    pre = preprocess_label(image, cfg.preprocess)
    steps = list(pre.steps)
    warnings: list[PreprocessWarning | LabelReadWarning] = list(pre.warnings)

    start = time.perf_counter()
    boxes = tuple(ocr(pre.image))
    steps.append(StepRecord(OCR_STEP, _ms_since(start), {"engine": ocr.name, "boxes": len(boxes)}))

    start = time.perf_counter()
    lines = tuple(group_lines(boxes, cfg.line_overlap))
    parsed = {k: tuple(v) for k, v in parse_fields(lines).items()}
    columns = detect_columns(lines)
    cells, cell_warnings = assign_cells(parsed, columns)
    if not parsed:
        warnings.append(LabelReadWarning.LABEL_NO_FIELDS)
    warnings += [w for w in cell_warnings if w not in warnings]
    label = to_nutrition_label(cells)
    checks: tuple[RuleResult, ...] = ()
    if label is not None:
        checks = tuple(
            validate(
                label,
                atwater_rel_tol=cfg.atwater_rel_tol,
                atwater_abs_tol=cfg.atwater_abs_tol,
                serving_rel_tol=cfg.serving_rel_tol,
            )
        )
    steps.append(
        StepRecord(
            PARSE_STEP,
            _ms_since(start),
            {
                "line_overlap": cfg.line_overlap,
                "lines": len(lines),
                "fields": len(parsed),
                "columns": list(columns),
                "cells": len(cells),
            },
        )
    )
    return LabelReading(
        cells=cells,
        columns=columns,
        fields=parsed,
        lines=lines,
        boxes=boxes,
        image=pre.image,
        quad=pre.quad,
        checks=checks,
        ocr_engine=ocr.name,
        steps=tuple(steps),
        warnings=tuple(warnings),
    )


def detect_columns(lines: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    """由表頭行判斷營養素各欄的基準（由左到右），找不到或有歧義時回傳空 tuple。

    表頭行：含基準關鍵字、且不含任何欄位名稱（「每一份量 30 公克」是表頭欄位，不是表頭行）。
    取第一個表頭行；百分比欄不算一欄；同一基準出現兩次視為歧義。
    """
    for line in lines:
        s = normalize_text(line)
        if _find_keywords(s):
            continue
        found = _find_bases(s)
        if not found:
            continue
        columns = tuple(b for b in found if b != _PERCENT)
        if len(set(columns)) != len(columns):
            return ()
        return columns
    return ()


def assign_cells(
    parsed: Mapping[str, tuple[Quantity, ...]], columns: tuple[str, ...]
) -> tuple[dict[tuple[str, str], Quantity], list[LabelReadWarning]]:
    """把依位置的解析結果對到（欄位, 基準）；對不上的格不填並回傳警告（見模組說明）。"""
    cells: dict[tuple[str, str], Quantity] = {}
    warnings: list[LabelReadWarning] = []

    def warn(w: LabelReadWarning) -> None:
        if w not in warnings:
            warnings.append(w)

    def units_ok(name: str, values: tuple[Quantity, ...]) -> bool:
        if all(q.unit in _UNITS[name] for q in values):
            return True
        warn(LabelReadWarning.LABEL_UNIT_MISMATCH)
        return False

    for name in HEADER_FIELDS:
        if (values := parsed.get(name)) and units_ok(name, values[:1]):
            cells[name, ""] = values[0]
    nutrients = [n for n in NUTRIENT_FIELDS if parsed.get(n)]
    if nutrients and not columns:
        warn(LabelReadWarning.LABEL_BASIS_UNKNOWN)
    elif columns:
        for name in nutrients:
            values = parsed[name]
            if len(values) != len(columns):
                warn(LabelReadWarning.LABEL_COLUMN_MISMATCH)
                continue
            # 一格單位不符就整列不填：正規化會去除空白，漏掉單位的數值會和下一欄黏在一起
            # （「8.49 28.0 公克」→「8.4928.0g」→ 8.4928、0g），同列其他格也不可信
            if not units_ok(name, values):
                continue
            for basis, q in zip(columns, values, strict=True):
                cells[name, basis] = q
    return cells, warnings


def to_nutrition_label(cells: Mapping[tuple[str, str], Quantity]) -> NutritionLabel | None:
    """把確定的格轉成 ``domain.NutritionLabel``，供 ``validation`` 的規則使用。

    只有八項營養素都齊全的基準才轉（每 100 毫升放在 ``per_100g``，規則相同）；一欄都不齊全時
    回傳 ``None``。``NutritionFacts`` 以 ``float`` 表示，**只供驗證規則使用，不作為寫入值**；
    寫入資料庫的數值以 ``cells`` 的 ``Decimal`` 為準。
    """

    def facts(basis: str) -> NutritionFacts | None:
        if not all((n, basis) in cells for n in NUTRIENT_FIELDS):
            return None
        v = {n: float(cells[n, basis].value) for n in NUTRIENT_FIELDS}
        return NutritionFacts(
            energy_kcal=v["energy"],
            protein_g=v["protein"],
            fat_g=v["fat"],
            saturated_fat_g=v["saturated_fat"],
            trans_fat_g=v["trans_fat"],
            carbohydrate_g=v["carbohydrate"],
            sugar_g=v["sugar"],
            sodium_mg=v["sodium"],
        )

    per_serving = facts(PER_SERVING)
    per_100 = facts(PER_100G) or facts(PER_100ML)
    if per_serving is None and per_100 is None:
        return None
    size = cells.get(("serving_size", ""))
    count = cells.get(("servings", ""))
    return NutritionLabel(
        serving_size_g=float(size.value) if size and size.unit == "g" and size.value > 0 else None,
        servings_per_package=float(count.value) if count and count.value > 0 else None,
        per_serving=per_serving,
        per_100g=per_100,
    )


def _find_bases(s: str) -> list[str]:
    """由左到右找出基準關鍵字（同一位置最長者優先、互不重疊）。"""
    found: list[str] = []
    i = 0
    while i < len(s):
        for kw, basis in _BASIS_BY_LENGTH:
            if s.startswith(kw, i):
                found.append(basis)
                i += len(kw)
                break
        else:
            i += 1
    return found


def _ms_since(start: float) -> float:
    return (time.perf_counter() - start) * 1000
