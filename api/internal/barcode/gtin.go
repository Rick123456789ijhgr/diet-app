package barcode

import (
	"errors"
	"strings"
)

// ErrInvalidGTIN 表示條碼不是 8、12、13 或 14 位數字，或校驗碼不符。
var ErrInvalidGTIN = errors.New("條碼必須是 8、12、13 或 14 位數字且校驗碼正確")

// NormalizeGTIN 把標示上的條碼（EAN-8、UPC-A、EAN-13、GTIN-14）補 0 到 14 碼並檢查校驗碼。
// UPC-A 與前面補 0 的 EAN-13 得到相同的結果，因此視為同一條碼。
func NormalizeGTIN(code string) (string, error) {
	code = strings.TrimSpace(code)
	switch len(code) {
	case 8, 12, 13, 14:
	default:
		return "", ErrInvalidGTIN
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return "", ErrInvalidGTIN
		}
	}
	gtin := strings.Repeat("0", 14-len(code)) + code
	if checkDigit(gtin[:13]) != gtin[13] {
		return "", ErrInvalidGTIN
	}
	return gtin, nil
}

// checkDigit 依 GS1 規則計算校驗碼：由右往左（不含校驗碼）奇數位乘 3、偶數位乘 1，補到 10 的倍數。
func checkDigit(body string) byte {
	sum := 0
	for i := len(body) - 1; i >= 0; i-- {
		d := int(body[i] - '0')
		if (len(body)-1-i)%2 == 0 {
			d *= 3
		}
		sum += d
	}
	return byte('0' + (10-sum%10)%10)
}
