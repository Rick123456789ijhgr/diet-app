// Package nutrition 是營養計算引擎（流程步驟 08）。
//
// 本套件必須保持純函式：不得存取資料庫、網路、時間或任何外部狀態，
// 以確保所有營養數值都可被單元測試驗證。
package nutrition

import "errors"

// ErrNegativeAmount 表示攝取量為負數。
var ErrNegativeAmount = errors.New("nutrition: amount must not be negative")

// Nutrients 是一組營養素數值。單位：熱量 kcal、鈉 mg，其餘為公克。
type Nutrients struct {
	EnergyKcal float64
	ProteinG   float64
	FatG       float64
	SatFatG    float64
	TransFatG  float64
	CarbG      float64
	SugarG     float64
	SodiumMg   float64
}

// Scale 回傳所有營養素乘上 factor 後的結果。
func (n Nutrients) Scale(factor float64) Nutrients {
	return Nutrients{
		EnergyKcal: n.EnergyKcal * factor,
		ProteinG:   n.ProteinG * factor,
		FatG:       n.FatG * factor,
		SatFatG:    n.SatFatG * factor,
		TransFatG:  n.TransFatG * factor,
		CarbG:      n.CarbG * factor,
		SugarG:     n.SugarG * factor,
		SodiumMg:   n.SodiumMg * factor,
	}
}

// Add 回傳兩組營養素的總和，用於彙總一餐或一天的攝取量。
func (n Nutrients) Add(o Nutrients) Nutrients {
	return Nutrients{
		EnergyKcal: n.EnergyKcal + o.EnergyKcal,
		ProteinG:   n.ProteinG + o.ProteinG,
		FatG:       n.FatG + o.FatG,
		SatFatG:    n.SatFatG + o.SatFatG,
		TransFatG:  n.TransFatG + o.TransFatG,
		CarbG:      n.CarbG + o.CarbG,
		SugarG:     n.SugarG + o.SugarG,
		SodiumMg:   n.SodiumMg + o.SodiumMg,
	}
}

// FromPer100g 依每 100 公克含量與攝取克數計算實際攝取量（非包裝食物）。
func FromPer100g(per100g Nutrients, grams float64) (Nutrients, error) {
	if grams < 0 {
		return Nutrients{}, ErrNegativeAmount
	}
	return per100g.Scale(grams / 100), nil
}

// FromServings 依每份含量與食用份數計算實際攝取量（包裝食品）。
func FromServings(perServing Nutrients, servings float64) (Nutrients, error) {
	if servings < 0 {
		return Nutrients{}, ErrNegativeAmount
	}
	return perServing.Scale(servings), nil
}
