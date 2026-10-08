package nutrition

import (
	"errors"
	"math"
	"testing"
)

func approxEqual(a, b Nutrients) bool {
	const eps = 1e-9
	pairs := [][2]float64{
		{a.EnergyKcal, b.EnergyKcal}, {a.ProteinG, b.ProteinG}, {a.FatG, b.FatG},
		{a.SatFatG, b.SatFatG}, {a.TransFatG, b.TransFatG}, {a.CarbG, b.CarbG},
		{a.SugarG, b.SugarG}, {a.SodiumMg, b.SodiumMg},
	}
	for _, p := range pairs {
		if math.Abs(p[0]-p[1]) > eps {
			return false
		}
	}
	return true
}

func TestFromPer100g(t *testing.T) {
	rice := Nutrients{EnergyKcal: 183, ProteinG: 3.1, CarbG: 41, SodiumMg: 2}

	tests := []struct {
		name    string
		grams   float64
		want    Nutrients
		wantErr error
	}{
		{"一碗飯 200 克", 200, Nutrients{EnergyKcal: 366, ProteinG: 6.2, CarbG: 82, SodiumMg: 4}, nil},
		{"零克", 0, Nutrients{}, nil},
		{"負數", -1, Nutrients{}, ErrNegativeAmount},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := FromPer100g(rice, tt.grams)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			if !approxEqual(got, tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestFromServings(t *testing.T) {
	perServing := Nutrients{EnergyKcal: 250, FatG: 10}

	got, err := FromServings(perServing, 0.5)
	if err != nil {
		t.Fatal(err)
	}
	if want := (Nutrients{EnergyKcal: 125, FatG: 5}); !approxEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}

	if _, err := FromServings(perServing, -0.5); !errors.Is(err, ErrNegativeAmount) {
		t.Errorf("err = %v, want ErrNegativeAmount", err)
	}
}

func TestAdd(t *testing.T) {
	a := Nutrients{EnergyKcal: 100, SodiumMg: 50}
	b := Nutrients{EnergyKcal: 200, SodiumMg: 25}
	if got, want := a.Add(b), (Nutrients{EnergyKcal: 300, SodiumMg: 75}); !approxEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}
