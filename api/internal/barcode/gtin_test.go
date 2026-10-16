package barcode

import "testing"

func TestNormalizeGTIN(t *testing.T) {
	tests := []struct {
		name, code, want string
		wantErr          bool
	}{
		{"EAN-13", "4710088410108", "04710088410108", false},
		{"UPC-A 與補 0 的 EAN-13 相同", "036000291452", "00036000291452", false},
		{"補 0 的 EAN-13", "0036000291452", "00036000291452", false},
		{"EAN-8", "96385074", "00000096385074", false},
		{"GTIN-14", "10012345678902", "10012345678902", false},
		{"前後空白", " 4710088410108 ", "04710088410108", false},
		{"校驗碼錯", "4710088410109", "", true},
		{"長度不對", "47100884101", "", true},
		{"含字母", "47100884101A8", "", true},
		{"空字串", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeGTIN(tt.code)
			if (err != nil) != tt.wantErr || got != tt.want {
				t.Errorf("NormalizeGTIN(%q) = %q, %v", tt.code, got, err)
			}
		})
	}
}
