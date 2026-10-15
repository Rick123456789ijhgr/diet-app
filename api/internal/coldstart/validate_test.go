package coldstart

import "testing"

func n(v ...float64) Nutrients {
	p := func(x float64) *float64 { return &x }
	return Nutrients{p(v[0]), p(v[1]), p(v[2]), p(v[3]), p(v[4]), p(v[5]), p(v[6]), p(v[7])}
}

func TestNutritionIssues(t *testing.T) {
	serving := 30.0
	tests := []struct {
		name       string
		perServing Nutrients
		per100     Nutrients
		serving    *float64
		want       []string
	}{
		{"一致", n(156, 2.1, 9, 3, 0, 15.9, 0.6, 150), n(520, 7, 30, 10, 0, 53, 2, 500), &serving, nil},
		// 標示四捨五入：每份熱量 157（換算 156）在容許範圍內
		{"四捨五入的誤差", n(157, 2.1, 9, 3, 0, 15.9, 0.6, 150), n(520, 7, 30, 10, 0, 53, 2, 500), &serving, nil},
		// 低於門檻標示為 0：每 100 g 糖 1.5 g，每份換算 0.45 g（0.5 g 以下可標示為 0）
		{"低於門檻標示為 0", n(156, 2.1, 9, 3, 0, 15.9, 0, 150), n(520, 7, 30, 10, 0, 53, 1.5, 500), &serving, nil},
		// 每份 0.6 g 已超過門檻，不可標示為 0
		{"超過門檻卻標示為 0", n(156, 2.1, 9, 3, 0, 15.9, 0, 150), n(520, 7, 30, 10, 0, 53, 2, 500), &serving, []string{"BASIS_MISMATCH:sugar_g"}},
		{"熱量換算不符", n(200, 2.1, 9, 3, 0, 15.9, 0.6, 150), n(520, 7, 30, 10, 0, 53, 2, 500), &serving, []string{"BASIS_MISMATCH:energy_kcal"}},
		{"沒有份量時不比較兩欄", n(200, 2.1, 9, 3, 0, 15.9, 0.6, 150), n(520, 7, 30, 10, 0, 53, 2, 500), nil, nil},
		{"飽和＋反式大於脂肪", n(156, 2.1, 9, 8, 2, 15.9, 0.6, 150), n(520, 7, 30, 10, 0, 53, 2, 500), nil, []string{"FAT_PARTS_EXCEED_FAT:per_serving"}},
		{"糖大於碳水", n(156, 2.1, 9, 3, 0, 15.9, 0.6, 150), n(520, 7, 30, 10, 0, 53, 60, 500), nil, []string{"SUGAR_EXCEEDS_CARBOHYDRATE:per_100"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			for _, i := range NutritionIssues(tt.perServing, tt.per100, tt.serving) {
				key := i.Code + ":" + i.Nutrient
				if i.Code != "BASIS_MISMATCH" {
					key = i.Code + ":" + i.Basis
				}
				got = append(got, key)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("issues = %v，預期 %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("issues = %v，預期 %v", got, tt.want)
				}
			}
		})
	}
}

func TestRound2(t *testing.T) {
	for in, want := range map[float64]float64{1.005: 1, 1.006: 1.01, 2.346: 2.35, 0: 0} {
		if got := Round2(in); got != want {
			t.Errorf("Round2(%v) = %v，預期 %v", in, got, want)
		}
	}
}
