package coldstart

import (
	"fmt"
	"math"
	"strings"
)

// 營養數值一致性的確定性規則（任務書 2.6.5）。標示依「低於門檻可標示為 0」與四捨五入的規定，
// 兩欄換算或加總可能有小誤差；超出容許範圍才提示，由人核對標示後決定是否照原樣存入。

// relTolerance 是換算的相對容許誤差（四捨五入造成的誤差）。
const relTolerance = 0.05

// absTolerance 是各營養素的絕對容許誤差：衛福部規定低於此值可標示為 0。
var absTolerance = map[string]float64{
	"energy_kcal":     4,
	"protein_g":       0.5,
	"fat_g":           0.5,
	"saturated_fat_g": 0.1,
	"trans_fat_g":     0.3,
	"carbohydrate_g":  0.5,
	"sugar_g":         0.5,
	"sodium_mg":       5,
}

// Issue 是一項數值不一致。
type Issue struct {
	Code     string // BASIS_MISMATCH、FAT_PARTS_EXCEED_FAT、SUGAR_EXCEEDS_CARBOHYDRATE
	Basis    string // per_serving、per_100、both
	Nutrient string
	Expected *float64
	Actual   *float64
	Message  string
}

// Round2 四捨五入到小數兩位（資料庫為 NUMERIC(10,2)，捨入由程式決定）。
func Round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func within(a, b, abs float64) bool {
	return math.Abs(a-b) <= math.Max(abs, relTolerance*math.Max(math.Abs(a), math.Abs(b)))
}

// NutritionIssues 檢查兩種基準的數值（八項都已填）：
//   - 每份 ≈ 每 100 × 份量 ÷ 100（份量為 nil 時略過）
//   - 每種基準：飽和脂肪＋反式脂肪 ≤ 脂肪、糖 ≤ 碳水化合物
func NutritionIssues(perServing, per100 Nutrients, servingSize *float64) []Issue {
	var issues []Issue
	if servingSize != nil {
		for _, f := range NutrientFields {
			s, h := *f.Get(&perServing), *f.Get(&per100)
			want := Round2(h * *servingSize / 100)
			if !within(s, want, absTolerance[f.Name]) {
				issues = append(issues, Issue{
					Code: "BASIS_MISMATCH", Basis: "both", Nutrient: f.Name,
					Expected: ptr(want), Actual: ptr(s),
					Message: fmt.Sprintf("每份 %g 與每 100 換算的 %g（份量 %g）不符", s, want, *servingSize),
				})
			}
		}
	}
	for _, b := range []struct {
		basis Basis
		n     Nutrients
	}{{PerServing, perServing}, {Per100, per100}} {
		n := b.n
		if parts := *n.SaturatedFatG + *n.TransFatG; parts > *n.FatG+absTolerance["fat_g"] {
			issues = append(issues, Issue{
				Code: "FAT_PARTS_EXCEED_FAT", Basis: string(b.basis), Nutrient: "fat_g",
				Expected: ptr(Round2(parts)), Actual: n.FatG,
				Message: fmt.Sprintf("飽和脂肪＋反式脂肪 %g 大於脂肪 %g", Round2(parts), *n.FatG),
			})
		}
		if *n.SugarG > *n.CarbohydrateG+absTolerance["carbohydrate_g"] {
			issues = append(issues, Issue{
				Code: "SUGAR_EXCEEDS_CARBOHYDRATE", Basis: string(b.basis), Nutrient: "sugar_g",
				Expected: n.CarbohydrateG, Actual: n.SugarG,
				Message: fmt.Sprintf("糖 %g 大於碳水化合物 %g", *n.SugarG, *n.CarbohydrateG),
			})
		}
	}
	return issues
}

// missingNutrition 列出某基準未填的欄位（路徑如 nutrition.per_100.sodium_mg）。
func missingNutrition(d Draft, basis Basis) []string {
	var n *Nutrients
	if d.Nutrition != nil {
		if basis == PerServing {
			n = d.Nutrition.PerServing
		} else {
			n = d.Nutrition.Per100
		}
	}
	var out []string
	for _, f := range NutrientFields {
		if n == nil || f.Get(n) == nil {
			out = append(out, "nutrition."+string(basis)+"."+f.Name)
		}
	}
	return out
}

func blank(s *string) bool { return s == nil || strings.TrimSpace(*s) == "" }

// Missing 列出確認前必填但缺少的欄位與照片。
//   - create：條碼、品名、單位、份量、兩種基準的八項數值，以及三種照片
//   - revise_nutrition：兩種基準的八項數值與營養標示照片（份量沿用產品的，產品沒有時必填）
//   - add_images：至少一張照片
func Missing(s Submission, mode Mode, product *Product) []string {
	var out []string
	d := s.Draft
	has := func(k Kind) bool { _, ok := s.Image(k); return ok }
	switch mode {
	case ModeCreate:
		if blank(d.Barcode) {
			out = append(out, "barcode")
		}
		if blank(d.Name) {
			out = append(out, "name")
		}
		if blank(d.ContentUnit) {
			out = append(out, "content_unit")
		}
		if d.ServingSize == nil {
			out = append(out, "serving_size")
		}
		out = append(out, missingNutrition(d, PerServing)...)
		out = append(out, missingNutrition(d, Per100)...)
		for _, k := range Kinds {
			if !has(k) {
				out = append(out, "images."+string(k))
			}
		}
	case ModeReviseNutrition:
		if d.ServingSize == nil && (product == nil || product.ServingSize == nil) {
			out = append(out, "serving_size")
		}
		out = append(out, missingNutrition(d, PerServing)...)
		out = append(out, missingNutrition(d, Per100)...)
		if !has(KindLabel) {
			out = append(out, "images.label")
		}
	case ModeAddImages:
		if len(s.Images) == 0 {
			out = append(out, "images")
		}
	}
	return out
}

// validateDraft 檢查草稿中已填欄位的型別範圍（草稿可缺欄位）。
func validateDraft(d Draft) error {
	if d.ContentUnit != nil && *d.ContentUnit != "g" && *d.ContentUnit != "ml" {
		return &InvalidError{"INVALID_DRAFT", "content_unit", "單位只能是 g 或 ml"}
	}
	positive := map[string]*float64{
		"net_content": d.NetContent, "serving_size": d.ServingSize, "servings_per_package": d.ServingsPerPackage,
	}
	for name, v := range positive {
		if v != nil && !(*v > 0 && *v < 1e8) {
			return &InvalidError{"INVALID_DRAFT", name, name + " 必須大於 0"}
		}
	}
	if d.Nutrition != nil {
		for _, b := range []struct {
			basis Basis
			n     *Nutrients
		}{{PerServing, d.Nutrition.PerServing}, {Per100, d.Nutrition.Per100}} {
			if b.n == nil {
				continue
			}
			for _, f := range NutrientFields {
				if v := f.Get(b.n); v != nil && !(*v >= 0 && *v < 1e8) {
					field := "nutrition." + string(b.basis) + "." + f.Name
					return &InvalidError{"INVALID_DRAFT", field, field + " 必須是 0 以上的數字"}
				}
			}
		}
	}
	return nil
}

// complete 把八項都已填的草稿數值轉成捨入到兩位小數的值（呼叫前須確認沒有缺漏）。
func complete(n *Nutrients) Nutrients {
	var out Nutrients
	set := []**float64{
		&out.EnergyKcal, &out.ProteinG, &out.FatG, &out.SaturatedFatG,
		&out.TransFatG, &out.CarbohydrateG, &out.SugarG, &out.SodiumMg,
	}
	for i, f := range NutrientFields {
		*set[i] = ptr(Round2(*f.Get(n)))
	}
	return out
}

func ptr[T any](v T) *T { return &v }
