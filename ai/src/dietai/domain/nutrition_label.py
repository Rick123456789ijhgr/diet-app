"""營養標示的資料模型。"""

from pydantic import BaseModel, Field


class NutritionFacts(BaseModel):
    """一組營養素數值（每份或每 100 公克）。單位：熱量 kcal、鈉 mg，其餘為公克。"""

    energy_kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    saturated_fat_g: float = Field(ge=0)
    trans_fat_g: float = Field(ge=0)
    carbohydrate_g: float = Field(ge=0)
    sugar_g: float = Field(ge=0)
    sodium_mg: float = Field(ge=0)


class NutritionLabel(BaseModel):
    """一張營養標示的解析結果。"""

    product_name: str | None = None
    serving_size_g: float | None = Field(default=None, gt=0)
    servings_per_package: float | None = Field(default=None, gt=0)
    net_weight_g: float | None = Field(default=None, gt=0)
    per_serving: NutritionFacts | None = None
    per_100g: NutritionFacts | None = None
