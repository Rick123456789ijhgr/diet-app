package coldstart

import (
	"testing"
)

func cell(field, basis, value, unit string) LabelCell {
	return LabelCell{Field: field, Basis: basis, Value: value, Unit: unit}
}

// twoColumns 是讀到「每份＋每 100 公克」兩欄的完整標示。
func twoColumns() *LabelReading {
	r := &LabelReading{Columns: []string{LabelPerServing, LabelPer100g}}
	r.Cells = []LabelCell{
		cell("serving_size", "", "30", "g"),
		cell("servings", "", "6", "份"),
	}
	rows := []struct{ field, unit, serving, per100 string }{
		{"energy", "kcal", "152", "507"},
		{"protein", "g", "2.1", "7"},
		{"fat", "g", "8.4", "28"},
		{"saturated_fat", "g", "3.2", "10.7"},
		{"trans_fat", "g", "0", "0"},
		{"carbohydrate", "g", "17", "56.7"},
		{"sugar", "g", "1.5", "5"},
		{"sodium", "mg", "125", "417"},
	}
	for _, row := range rows {
		r.Cells = append(r.Cells,
			cell(row.field, LabelPerServing, row.serving, row.unit),
			cell(row.field, LabelPer100g, row.per100, row.unit))
	}
	return r
}

func val(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestPrefillFromLabelFillsEmptyDraft(t *testing.T) {
	got := prefillFromLabel(Draft{}, twoColumns())
	if val(got.ServingSize) != 30.0 || val(got.ServingsPerPackage) != 6.0 {
		t.Errorf("份量 = %v、份數 = %v", val(got.ServingSize), val(got.ServingsPerPackage))
	}
	if got.ContentUnit == nil || *got.ContentUnit != "g" {
		t.Errorf("單位應依每 100 公克欄填 g：%v", got.ContentUnit)
	}
	if got.Nutrition == nil || got.Nutrition.PerServing == nil || got.Nutrition.Per100 == nil {
		t.Fatalf("兩種基準都應預填：%+v", got.Nutrition)
	}
	tests := []struct {
		name string
		got  *float64
		want float64
	}{
		// 十進位字串轉成數值不失真
		{"每份蛋白質", got.Nutrition.PerServing.ProteinG, 2.1},
		{"每份熱量", got.Nutrition.PerServing.EnergyKcal, 152},
		{"每份反式脂肪（0 可接受）", got.Nutrition.PerServing.TransFatG, 0},
		{"每 100 公克飽和脂肪", got.Nutrition.Per100.SaturatedFatG, 10.7},
		{"每 100 公克鈉", got.Nutrition.Per100.SodiumMg, 417},
	}
	for _, tt := range tests {
		if val(tt.got) != tt.want {
			t.Errorf("%s = %v，期望 %v", tt.name, val(tt.got), tt.want)
		}
	}
}

func TestPrefillFromLabelKeepsHumanInput(t *testing.T) {
	ml := "ml"
	in := Draft{
		ServingSize: ptr(25.0),
		ContentUnit: &ml,
		Nutrition:   &NutritionDraft{PerServing: &Nutrients{ProteinG: ptr(3.0)}},
	}
	got := prefillFromLabel(in, twoColumns())
	if val(got.ServingSize) != 25.0 || *got.ContentUnit != "ml" {
		t.Errorf("不應覆蓋人工輸入：份量 %v、單位 %v", val(got.ServingSize), *got.ContentUnit)
	}
	if val(got.Nutrition.PerServing.ProteinG) != 3.0 {
		t.Errorf("不應覆蓋人工輸入的蛋白質：%v", val(got.Nutrition.PerServing.ProteinG))
	}
	// 其他空欄位照常預填
	if val(got.Nutrition.PerServing.FatG) != 8.4 || val(got.ServingsPerPackage) != 6.0 {
		t.Errorf("空欄位應預填：脂肪 %v、份數 %v", val(got.Nutrition.PerServing.FatG), val(got.ServingsPerPackage))
	}
	// 輸入的草稿不被修改
	if in.ServingsPerPackage != nil || in.Nutrition.PerServing.FatG != nil {
		t.Error("prefillFromLabel 修改了輸入的草稿")
	}
}

func TestPrefillFromLabelSkips(t *testing.T) {
	tests := []struct {
		name  string
		cells []LabelCell
		check func(t *testing.T, d Draft)
	}{
		{
			name:  "欄基準判斷不出：只有表頭欄位",
			cells: []LabelCell{cell("serving_size", "", "30", "ml")},
			check: func(t *testing.T, d Draft) {
				if d.Nutrition != nil {
					t.Errorf("營養素不應預填：%+v", d.Nutrition)
				}
				if val(d.ServingSize) != 30.0 || d.ContentUnit == nil || *d.ContentUnit != "ml" {
					t.Errorf("份量與單位 = %v、%v", val(d.ServingSize), d.ContentUnit)
				}
			},
		},
		{
			name:  "單位不符",
			cells: []LabelCell{cell("energy", LabelPerServing, "152", "g"), cell("servings", "", "6", "g")},
			check: func(t *testing.T, d Draft) {
				if d.Nutrition != nil || d.ServingsPerPackage != nil {
					t.Errorf("單位不符的格不應預填：%+v", d)
				}
			},
		},
		{
			name: "數值無法解析或超出範圍",
			cells: []LabelCell{
				cell("protein", LabelPerServing, "abc", "g"),
				cell("fat", LabelPerServing, "-1", "g"),
				cell("serving_size", "", "0", "g"),
				cell("sugar", LabelPerServing, "1e9", "g"),
			},
			check: func(t *testing.T, d Draft) {
				if d.Nutrition != nil || d.ServingSize != nil {
					t.Errorf("不合法的值不應預填：%+v", d)
				}
			},
		},
		{
			name: "同時有每 100 公克與每 100 毫升",
			cells: []LabelCell{
				cell("protein", LabelPer100g, "7", "g"),
				cell("protein", LabelPer100ml, "6", "g"),
				cell("protein", LabelPerServing, "2.1", "g"),
			},
			check: func(t *testing.T, d Draft) {
				if d.Nutrition.Per100 != nil || d.ContentUnit != nil {
					t.Errorf("無法對應到單一基準時不填 Per100 與單位：%+v、%v", d.Nutrition.Per100, d.ContentUnit)
				}
				if val(d.Nutrition.PerServing.ProteinG) != 2.1 {
					t.Errorf("每份仍應預填：%v", val(d.Nutrition.PerServing.ProteinG))
				}
			},
		},
		{
			name:  "每 100 毫升填到 Per100、單位 ml",
			cells: []LabelCell{cell("sodium", LabelPer100ml, "40", "mg")},
			check: func(t *testing.T, d Draft) {
				if val(d.Nutrition.Per100.SodiumMg) != 40.0 || *d.ContentUnit != "ml" {
					t.Errorf("Per100 = %+v、單位 %v", d.Nutrition.Per100, d.ContentUnit)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.check(t, prefillFromLabel(Draft{}, &LabelReading{Cells: tt.cells}))
		})
	}
	if d := prefillFromLabel(Draft{}, nil); d.Nutrition != nil || d.ServingSize != nil {
		t.Errorf("沒有讀取結果時草稿不變：%+v", d)
	}
}
