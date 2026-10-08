# CLAUDE.md（app／Flutter APP）

先讀根目錄 `CLAUDE.md`。

## 初始化（尚未建立 Flutter 專案時）

```bash
cd app
flutter create --org tw.edu.yourschool --project-name diet_app .
```

## 結構（feature-first）

```
lib/
  core/            API 客戶端包裝、SSE、認證、錯誤處理、主題
  features/
    scan/          拍照、條碼、營養標示、發票（簡易品質檢查、壓縮）
    diary/         確認修正、今日紀錄
    insights/      今日總覽、趨勢、缺口、建議卡片
    profile/       個人設定、偏好與禁忌
      （每個 feature 內分 data／domain／presentation）
  gen/             openapi-generator 產生的客戶端，不手改
```

## 規則

- 狀態管理用 Riverpod；畫面層不直接使用 `gen/` 的型別，由 data 層轉成 domain 模型。
- APP 中不得存放任何 LLM 金鑰；所有 AI 功能都經 Go API。
- 營養數值只顯示後端回傳的結果，APP 端不自行計算。
- 掃描發票 QR code 時須保留 raw bytes 傳給後端解碼，不在 APP 端轉成字串。
- 長時間任務：SSE 只作即時通知；回到前景或斷線後以 `GET /jobs/{id}` 補齊結果。

## 指令

```bash
flutter pub get
dart format lib test
flutter analyze
flutter test
```
