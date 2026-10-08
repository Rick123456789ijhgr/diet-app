"""營養標示邏輯驗證規則。

每條規則都是純函式，回傳 ``RuleResult``。容許誤差須依法規允許的標示誤差範圍調整，
目前數值僅為暫定預設值。
"""

from dataclasses import dataclass

from dietai.domain.nutrition_label import NutritionFacts, NutritionLabel


@dataclass(frozen=True)
class RuleResult:
    rule: str
    passed: bool
    detail: str = ""


def check_atwater(facts: NutritionFacts, rel_tol: float = 0.2, abs_tol: float = 10.0) -> RuleResult:
    """熱量 ≈ 蛋白質×4 ＋ 脂肪×9 ＋ 碳水×4。"""
    expected = facts.protein_g * 4 + facts.fat_g * 9 + facts.carbohydrate_g * 4
    diff = abs(facts.energy_kcal - expected)
    passed = diff <= max(abs_tol, rel_tol * expected)
    return RuleResult("atwater", passed, f"標示 {facts.energy_kcal}，推算 {expected:.1f}")


def check_fat_breakdown(facts: NutritionFacts) -> RuleResult:
    """飽和脂肪＋反式脂肪 ≤ 總脂肪。"""
    passed = facts.saturated_fat_g + facts.trans_fat_g <= facts.fat_g + 1e-9
    return RuleResult("fat_breakdown", passed)


def check_sugar(facts: NutritionFacts) -> RuleResult:
    """糖 ≤ 碳水化合物。"""
    return RuleResult("sugar_le_carb", facts.sugar_g <= facts.carbohydrate_g + 1e-9)


def check_serving_times_count(label: NutritionLabel, rel_tol: float = 0.05) -> RuleResult | None:
    """每份重量 × 份數 ≈ 淨重。欄位不齊時回傳 None（不適用）。"""
    if not (label.serving_size_g and label.servings_per_package and label.net_weight_g):
        return None
    total = label.serving_size_g * label.servings_per_package
    passed = abs(total - label.net_weight_g) <= rel_tol * label.net_weight_g
    return RuleResult("serving_times_count", passed, f"{total} vs 淨重 {label.net_weight_g}")


def validate(label: NutritionLabel) -> list[RuleResult]:
    """對一張標示執行所有適用規則。"""
    results: list[RuleResult] = []
    for facts in (label.per_serving, label.per_100g):
        if facts is not None:
            results += [check_atwater(facts), check_fat_breakdown(facts), check_sugar(facts)]
    if (r := check_serving_times_count(label)) is not None:
        results.append(r)
    return results
