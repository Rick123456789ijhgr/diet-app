from dietai.domain.nutrition_label import NutritionFacts, NutritionLabel
from dietai.label_parsing.validation import check_atwater, validate


def facts(**overrides) -> NutritionFacts:
    base = dict(
        energy_kcal=250,
        protein_g=10,
        fat_g=10,
        saturated_fat_g=4,
        trans_fat_g=0,
        carbohydrate_g=30,
        sugar_g=5,
        sodium_mg=400,
    )
    return NutritionFacts(**(base | overrides))


def test_consistent_label_passes_all_rules():
    label = NutritionLabel(
        serving_size_g=50, servings_per_package=2, net_weight_g=100, per_serving=facts()
    )
    assert all(r.passed for r in validate(label))


def test_misread_energy_is_flagged():
    # OCR 把 250 讀成 2500
    assert not check_atwater(facts(energy_kcal=2500)).passed


def test_sugar_exceeding_carb_is_flagged():
    results = {r.rule: r.passed for r in validate(NutritionLabel(per_100g=facts(sugar_g=40)))}
    assert results["sugar_le_carb"] is False


def test_serving_rule_skipped_when_fields_missing():
    rules = {r.rule for r in validate(NutritionLabel(per_serving=facts()))}
    assert "serving_times_count" not in rules
