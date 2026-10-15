// Package coldstart 是冷啟動上傳的領域邏輯：包裝照片 → 前處理 → 人工確認 → 寫入產品資料庫
// （任務書 2.6 節）。
//
// 營養數值只來自人工輸入（根目錄 CLAUDE.md 規則 1）；前處理結果只供參考（例如預先填入條碼）。
// 本套件不 import 資料庫、HTTP、gRPC：儲存、物件儲存與前處理都透過介面接入（見 service.go）。
package coldstart

import (
	"encoding/json"
	"time"
)

// Kind 是照片種類。
type Kind string

const (
	KindFront   Kind = "front"   // 包裝正面
	KindBarcode Kind = "barcode" // 條碼
	KindLabel   Kind = "label"   // 營養標示
)

// Kinds 依顯示順序列出所有照片種類。
var Kinds = []Kind{KindFront, KindBarcode, KindLabel}

func (k Kind) Valid() bool {
	return k == KindFront || k == KindBarcode || k == KindLabel
}

// Status 是上傳的狀態。
type Status string

const (
	StatusDraft     Status = "draft"
	StatusConfirmed Status = "confirmed"
	StatusRejected  Status = "rejected"
)

// Basis 是營養標示的基準。
type Basis string

const (
	PerServing Basis = "per_serving"
	Per100     Basis = "per_100" // 每 100 公克或毫升（見 Product.ContentUnit）
)

// Nutrients 是台灣營養標示的八項必要欄位；草稿中可為 nil（未填）。
type Nutrients struct {
	EnergyKcal    *float64 `json:"energy_kcal,omitempty"`
	ProteinG      *float64 `json:"protein_g,omitempty"`
	FatG          *float64 `json:"fat_g,omitempty"`
	SaturatedFatG *float64 `json:"saturated_fat_g,omitempty"`
	TransFatG     *float64 `json:"trans_fat_g,omitempty"`
	CarbohydrateG *float64 `json:"carbohydrate_g,omitempty"`
	SugarG        *float64 `json:"sugar_g,omitempty"`
	SodiumMg      *float64 `json:"sodium_mg,omitempty"`
}

// NutrientFields 依標示順序列出各欄位的 JSON 名稱與取值方式。
var NutrientFields = []struct {
	Name string
	Get  func(*Nutrients) *float64
}{
	{"energy_kcal", func(n *Nutrients) *float64 { return n.EnergyKcal }},
	{"protein_g", func(n *Nutrients) *float64 { return n.ProteinG }},
	{"fat_g", func(n *Nutrients) *float64 { return n.FatG }},
	{"saturated_fat_g", func(n *Nutrients) *float64 { return n.SaturatedFatG }},
	{"trans_fat_g", func(n *Nutrients) *float64 { return n.TransFatG }},
	{"carbohydrate_g", func(n *Nutrients) *float64 { return n.CarbohydrateG }},
	{"sugar_g", func(n *Nutrients) *float64 { return n.SugarG }},
	{"sodium_mg", func(n *Nutrients) *float64 { return n.SodiumMg }},
}

// NutritionDraft 是兩種基準的營養數值。
type NutritionDraft struct {
	PerServing *Nutrients `json:"per_serving,omitempty"`
	Per100     *Nutrients `json:"per_100,omitempty"`
}

// Draft 是人工輸入中的欄位；JSON 欄位名稱與 API 的 Draft 相同，原樣存進 product_submissions.draft。
type Draft struct {
	Barcode            *string         `json:"barcode,omitempty"`
	Name               *string         `json:"name,omitempty"`
	Brand              *string         `json:"brand,omitempty"`
	NetContent         *float64        `json:"net_content,omitempty"`
	ContentUnit        *string         `json:"content_unit,omitempty"`
	ServingSize        *float64        `json:"serving_size,omitempty"`
	ServingsPerPackage *float64        `json:"servings_per_package,omitempty"`
	Nutrition          *NutritionDraft `json:"nutrition,omitempty"`
}

// Point 是影像座標。
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// BarcodeHit 是條碼照片解出的一個條碼。
type BarcodeHit struct {
	Format string `json:"format"`
	Text   string `json:"text"`
}

// ImagePreprocess 是一張照片的前處理摘要（只供參考）。
type ImagePreprocess struct {
	QualityPassed *bool        `json:"quality_passed,omitempty"`
	Warnings      []string     `json:"warnings"`
	Barcodes      []BarcodeHit `json:"barcodes,omitempty"`
	LabelQuad     []Point      `json:"label_quad,omitempty"`
	Error         string       `json:"error,omitempty"`
}

// UserRef 是建立者、確認者等的顯示資訊。
type UserRef struct {
	ID          string
	Username    string
	DisplayName string
}

// Image 是上傳的一張照片（原檔在物件儲存）。
type Image struct {
	Kind        Kind
	ObjectKey   string
	SHA256      []byte
	ContentType string
	Width       int
	Height      int
	UploadedAt  time.Time
	Preprocess  ImagePreprocess
}

// Submission 是一筆上傳。
type Submission struct {
	ID           string
	Status       Status
	Draft        Draft
	Images       []Image // 依 Kinds 的順序
	ProductID    string
	RejectReason string
	CreatedBy    UserRef
	CreatedAt    time.Time
	UpdatedAt    time.Time // 樂觀鎖版本（見 Version）
	ConfirmedBy  *UserRef
	ConfirmedAt  *time.Time
}

// Version 是給前端放在 If-Match 的版本字串。
func (s Submission) Version() string {
	return s.UpdatedAt.UTC().Format(time.RFC3339Nano)
}

// Image 回傳指定種類的照片。
func (s Submission) Image(kind Kind) (Image, bool) {
	for _, img := range s.Images {
		if img.Kind == kind {
			return img, true
		}
	}
	return Image{}, false
}

// SubmissionSummary 是清單中的一筆上傳。
type SubmissionSummary struct {
	ID        string
	Status    Status
	Barcode   string
	Name      string
	Images    []Kind
	CreatedBy UserRef
	UpdatedAt time.Time
}

// NutritionFacts 是一筆有效的營養標示（八項都有值）。
type NutritionFacts struct {
	Values      Nutrients
	ConfirmedBy UserRef
	ConfirmedAt time.Time
}

// ProductImage 是產品的一張照片。
type ProductImage struct {
	Kind         Kind
	SubmissionID string
	Width        int
	Height       int
}

// Product 是產品主檔與有效的營養標示。
type Product struct {
	ID                 string
	GTIN               string
	Barcode            string
	Name               string
	Brand              string
	NetContent         *float64
	ContentUnit        string
	ServingSize        *float64
	ServingsPerPackage *float64
	Nutrition          map[Basis]NutritionFacts
	Images             []ProductImage
	CreatedAt          time.Time
}

// NewProduct 是確認時要建立的產品。
type NewProduct struct {
	GTIN               string
	Barcode            string
	Name               string
	Brand              string
	NetContent         *float64
	ContentUnit        string
	ServingSize        *float64
	ServingsPerPackage *float64
	CreatedBy          string
}

// Mode 是確認的方式。
type Mode string

const (
	ModeCreate          Mode = "create"           // 建立新產品
	ModeAddImages       Mode = "add_images"       // 照片補到既有產品
	ModeReviseNutrition Mode = "revise_nutrition" // 既有產品新增一版營養標示
)

// ConfirmRequest 是確認的選項。
type ConfirmRequest struct {
	Mode           Mode
	ProductID      string
	AcceptWarnings bool
}

// clone 以 JSON 複製草稿，避免修改呼叫端的指標欄位。
func (d Draft) clone() Draft {
	b, _ := json.Marshal(d)
	var out Draft
	_ = json.Unmarshal(b, &out)
	return out
}
