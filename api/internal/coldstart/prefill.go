package coldstart

import (
	"strconv"
)

// labelNutrients 把讀取結果的欄位名稱對到草稿的營養素欄位與應有的單位。
var labelNutrients = map[string]struct {
	unit string
	set  func(*Nutrients) **float64
}{
	"energy":        {"kcal", func(n *Nutrients) **float64 { return &n.EnergyKcal }},
	"protein":       {"g", func(n *Nutrients) **float64 { return &n.ProteinG }},
	"fat":           {"g", func(n *Nutrients) **float64 { return &n.FatG }},
	"saturated_fat": {"g", func(n *Nutrients) **float64 { return &n.SaturatedFatG }},
	"trans_fat":     {"g", func(n *Nutrients) **float64 { return &n.TransFatG }},
	"carbohydrate":  {"g", func(n *Nutrients) **float64 { return &n.CarbohydrateG }},
	"sugar":         {"g", func(n *Nutrients) **float64 { return &n.SugarG }},
	"sodium":        {"mg", func(n *Nutrients) **float64 { return &n.SodiumMg }},
}

// prefillFromLabel 以營養標示讀取結果預填草稿，回傳新的草稿（不修改 d）。
//
// 規則（任務書 Phase 2）：
//   - 只填空欄位，組員已輸入的值一律不覆蓋。
//   - 只用已確定欄基準的格（LabelReading.Cells）；欄基準判斷不出時營養素一格都不填。
//   - per_100g、per_100ml 都填到 Per100；兩者同時出現時無法對應到單一基準，不填 Per100。
//   - 單位不符、數值無法解析或超出草稿允許範圍的格略過（與 validateDraft 相同的範圍）。
//   - content_unit 空著時，依每 100 公克／毫升欄（沒有時依每份量的單位）填 g 或 ml。
//
// 數值由十進位字串直接轉成 float64（"2.1" → 2.1），與組員手動輸入的精度相同。
func prefillFromLabel(d Draft, r *LabelReading) Draft {
	if r == nil || len(r.Cells) == 0 {
		return d
	}
	out := d.clone()
	has := map[string]bool{}
	for _, c := range r.Cells {
		has[c.Basis] = true
	}
	per100Unit := ""
	switch {
	case has[LabelPer100g] && !has[LabelPer100ml]:
		per100Unit = "g"
	case has[LabelPer100ml] && !has[LabelPer100g]:
		per100Unit = "ml"
	}

	for _, c := range r.Cells {
		switch c.Field {
		case "serving_size":
			if (c.Unit == "g" || c.Unit == "ml") && out.ServingSize == nil {
				if v, ok := parseCell(c.Value, false); ok {
					out.ServingSize = &v
				}
			}
		case "servings":
			if c.Unit == "份" && out.ServingsPerPackage == nil {
				if v, ok := parseCell(c.Value, false); ok {
					out.ServingsPerPackage = &v
				}
			}
		default:
			spec, ok := labelNutrients[c.Field]
			if !ok || c.Unit != spec.unit {
				continue
			}
			perServing := c.Basis == LabelPerServing
			per100 := (c.Basis == LabelPer100g || c.Basis == LabelPer100ml) && per100Unit != ""
			if !perServing && !per100 {
				continue
			}
			v, ok := parseCell(c.Value, true)
			if !ok {
				continue
			}
			target := &draftNutrition(&out).PerServing
			if per100 {
				target = &draftNutrition(&out).Per100
			}
			if *target == nil {
				*target = &Nutrients{}
			}
			if field := spec.set(*target); *field == nil {
				*field = &v
			}
		}
	}

	if blank(out.ContentUnit) {
		unit := per100Unit
		if unit == "" {
			for _, c := range r.Cells {
				if _, ok := parseCell(c.Value, false); ok && c.Field == "serving_size" && (c.Unit == "g" || c.Unit == "ml") {
					unit = c.Unit
				}
			}
		}
		if unit != "" {
			out.ContentUnit = &unit
		}
	}
	return out
}

// draftNutrition 取得草稿的營養數值，沒有時建立。
func draftNutrition(d *Draft) *NutritionDraft {
	if d.Nutrition == nil {
		d.Nutrition = &NutritionDraft{}
	}
	return d.Nutrition
}

// parseCell 把十進位字串轉成數值；範圍同 validateDraft（allowZero 為假時須大於 0）。
func parseCell(s string, allowZero bool) (float64, bool) {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || !inRange(v, allowZero) {
		return 0, false
	}
	return v, true
}
