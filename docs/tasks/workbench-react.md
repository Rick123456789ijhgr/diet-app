# 任務書：開發工作台改版（React＋Go）與冷啟動上傳工具

> 對應決策：`docs/adr/0003-workbench-react-go.md`
> 使用方式：一次只做一個階段，一個階段一個 PR。規格草稿（第 2 節）經 Rick 審核同意後才寫入 `proto/`、`openapi/`、`db/migrations/`。
> 審核紀錄：2026-10-13 Rick 同意第 2.1 至 2.3 節（含第 2.5 節的修正）；第 2.4 節由第 2.6 節（2026-10-16 草稿）取代，待審核。

---

## 1. 範圍

### 要做
- `workbench/`：React 前端（開發工具各頁＋冷啟動上傳）。
- `api/internal/workbench/`、`api/internal/platform/aiclient/`：Go 的工作台路由與呼叫 Python 的 gRPC 客戶端。
- `ai/src/dietai/server/`：Python gRPC 服務（`PreprocessService`、`WorkbenchService`）。
- `ai/src/dietai/devtools/`：從 `ai/workbench/wb/` 搬來的純邏輯（模擬退化、掃描彙整、設定結構、測試集防護、診斷影像）。
- 冷啟動上傳：登入、上傳三種照片、前處理、人工確認、寫入產品資料庫。

### 不做
- 「測試與檢查」頁（改用終端機與 CI）。
- 線上部署（位置未定；先做本機可用版本，但登入機制一併完成）。
- 營養標示的自動欄位解析（屬模組二；第一版由人工輸入）。

---

## 2. 規格草稿（待審核）

每份草稿附白話說明。審核時請確認「審核重點」，回覆「同意」或要改的地方。

### 2.1 `proto/dietai/v1/preprocess.proto`（正式前處理，Go → Python）

**白話說明**：讓 Go 能請 Python 做五種前處理。影像可以直接附上，或用工作台暫存過的 `image_id`；參數只傳要改的欄位（JSON），不傳則用預設值。回傳的分數、警告、步驟紀錄都有明確型別，之後 APP 的流程也用這一份。

```proto
syntax = "proto3";
package dietai.v1;
option go_package = "github.com/your-org/diet-app/api/gen/proto/dietai/v1;dietaiv1";

service PreprocessService {
  rpc CheckQuality(CheckQualityRequest) returns (CheckQualityResponse);
  rpc DecodeBarcode(DecodeBarcodeRequest) returns (DecodeBarcodeResponse);
  rpc LocateInvoiceQr(LocateInvoiceQrRequest) returns (LocateInvoiceQrResponse);
  rpc PreprocessLabel(PreprocessLabelRequest) returns (PreprocessLabelResponse);
  rpc PreprocessFood(PreprocessFoodRequest) returns (PreprocessFoodResponse);
}

// 影像來源：直接附上編碼後的影像（JPEG／PNG），或工作台暫存的影像 ID
message ImageInput {
  oneof source {
    bytes encoded = 1;
    string image_id = 2;
  }
}

// 只含與預設值不同的設定欄位，例如 {"blur_min": 150}；空字串表示全部用預設值
message ConfigOverride { string json = 1; }

message Step { string name = 1; double elapsed_ms = 2; string params_json = 3; }
message Point { double x = 1; double y = 2; }
message Box { int32 x = 1; int32 y = 2; int32 w = 3; int32 h = 4; }
message Ellipse { double cx = 1; double cy = 2; double major = 3; double minor = 4; double angle = 5; }

// 影像型結果：開發模式回傳 artifact_id（由 WorkbenchService.GetArtifact 取得），否則直接附上
message ImageOutput {
  oneof data {
    bytes encoded = 1;
    string artifact_id = 2;
  }
  int32 width = 3;
  int32 height = 4;
}

message CheckQualityRequest { ImageInput image = 1; ConfigOverride config = 2; }
message CheckQualityResponse {
  bool passed = 1;
  double blur_score = 2;
  double mean_brightness = 3;
  double dark_ratio = 4;
  double bright_ratio = 5;
  bool resolution_ok = 6;
  repeated string warnings = 7;   // PreprocessWarning 代碼，例如 TOO_BLURRY
  repeated Step steps = 8;
}

message DecodeHit {
  string format = 1;              // CodeFormat，例如 EAN13
  string text = 2;
  bytes raw = 3;                  // 原始位元組；發票中文由 Go 解碼
  repeated Point corners = 4;
}
message RungAttempt {
  string rung = 1;                // Rung，例如 deskew
  string params_json = 2;
  double elapsed_ms = 3;
  repeated DecodeHit hits = 4;
  repeated DecodeHit rejected = 5;
  bool skipped = 6;
}
message DecodeBarcodeRequest {
  ImageInput image = 1;
  ConfigOverride ladder = 2;      // LadderConfig
  ConfigOverride zxing = 3;       // ZxingConfig
}
message DecodeBarcodeResponse {
  bool success = 1;
  string success_rung = 2;
  int32 success_index = 3;        // -1 表示失敗
  repeated DecodeHit hits = 4;
  repeated RungAttempt attempts = 5;
  repeated string warnings = 6;
  repeated Step steps = 7;
}

message LocateInvoiceQrRequest { ImageInput image = 1; ConfigOverride ladder = 2; ConfigOverride zxing = 3; }
message LocateInvoiceQrResponse {
  DecodeHit left = 1;             // 未找到則不填
  DecodeHit right = 2;
  repeated RungAttempt attempts = 3;
  repeated string warnings = 4;
  repeated Step steps = 5;
}

message PreprocessLabelRequest { ImageInput image = 1; ConfigOverride config = 2; }
message PreprocessLabelResponse {
  ImageOutput image = 1;          // 校正、修補、增強後的標示
  repeated Point quad = 2;        // 原圖上的表格四角（左上起順時針）；找不到則為空
  string quad_method = 3;         // contour／hough
  double glare_ratio = 4;         // 光斑步驟未啟用時為 -1
  repeated string warnings = 5;
  repeated Step steps = 6;
}

message VlmImage { ImageOutput image = 1; int64 num_bytes = 2; double scale = 3; }
message PreprocessFoodRequest { ImageInput image = 1; ConfigOverride config = 2; }
message PreprocessFoodResponse {
  VlmImage whole = 1;
  bool dishes_enabled = 2;
  repeated Box dishes = 3;
  repeated VlmImage crops = 4;
  bool plates_enabled = 5;
  repeated Ellipse plates = 6;
  repeated string warnings = 7;
  repeated Step steps = 8;
}
```

**審核重點**
- 參數以 JSON 傳（不逐欄定義）可以接受嗎？好處是調參數不必改 proto；代價是型別檢查在 Python 端。
- 營養標示的回傳只有影像與四角，**不含欄位數值**（數值由人工輸入或日後模組二提供）。
- gRPC 單則訊息上限將從預設 4 MB 調高到 32 MB（照片原檔可能超過 4 MB）。

### 2.2 `proto/dietai/v1/workbench.proto`（開發用，只在開發模式啟用）

**白話說明**：工作台調參時需要的輔助功能：把影像暫存起來重複使用、產生合成影像、加上模擬退化、產生診斷用影像（邊緣響應、遮罩等）、參數掃描、資料夾批次、E1 實驗。這些功能不會出現在正式系統。回傳內容以 JSON 為主，因為只有工作台會讀，結構常隨研究需求調整。

```proto
service WorkbenchService {
  rpc GetConfigSchemas(GetConfigSchemasRequest) returns (GetConfigSchemasResponse);
  rpc PutImage(PutImageRequest) returns (ImageRef);          // 上傳並暫存
  rpc Synthesize(SynthesizeRequest) returns (ImageRef);      // 合成影像（附真值）
  rpc Degrade(DegradeRequest) returns (ImageRef);            // 模擬退化，產生新的暫存影像
  rpc RenderView(RenderViewRequest) returns (RenderViewResponse); // 診斷影像或圖表資料
  rpc GetArtifact(GetArtifactRequest) returns (GetArtifactResponse);
  rpc Sweep(SweepRequest) returns (JsonResponse);
  rpc RunBatch(RunBatchRequest) returns (stream JsonResponse); // 逐張回傳，前端顯示進度
  rpc ListE1Runs(ListE1RunsRequest) returns (JsonResponse);
  rpc GetE1Run(GetE1RunRequest) returns (JsonResponse);
  rpc StartE1Run(StartE1RunRequest) returns (stream JsonResponse); // 進度＋最後結果
}

message ImageRef {
  string image_id = 1;
  int32 width = 2;
  int32 height = 3;
  string description = 4;
  string truth_json = 5;          // 合成影像的真值（四角、盤緣等）；沒有則為空
}
message PutImageRequest { bytes encoded = 1; string name = 2; }
message SynthesizeRequest { string scene = 1; string params_json = 2; }   // scene：label／ean13／invoice／nutrition／food
message DegradeRequest { string image_id = 1; string degradation_json = 2; }
message RenderViewRequest { string image_id = 1; string view = 2; string config_json = 3; }
  // view：laplacian／exposure／histogram／label_edges／glare_mask／food_mask／ladder_variant
message RenderViewResponse {
  ImageRef image = 1;             // 影像型檢視（邊緣響應、遮罩等）
  string data_json = 2;           // 資料型檢視（例如直方圖），由前端畫圖
}
message GetArtifactRequest { string id = 1; }  // 暫存影像的 image_id 與診斷影像共用同一個 ID 空間
message GetArtifactResponse { bytes encoded = 1; string content_type = 2; }
message GetConfigSchemasRequest {}
message GetConfigSchemasResponse { string json = 1; }      // 各設定類別的 param() 欄位資訊
message SweepRequest { string target = 1; string params_json = 2; }      // target：quality／barcode
message RunBatchRequest { string folder = 1; bool recursive = 2; int32 limit = 3; string config_json = 4; }
message ListE1RunsRequest { string root = 1; }
message GetE1RunRequest { string run_dir = 1; }
message StartE1RunRequest { repeated string arms = 1; int32 n_codes = 2; string root = 3; }
message JsonResponse { string json = 1; }
```

**審核重點**
- 讀取本機路徑的 RPC（`RunBatch`、E1）一律經 `dietai.evaluation`／`guard_path` 的測試集鎖定，拒絕 `splits/test`。
- 暫存影像放在 Python 記憶體（LRU，上限 64 張且合計 1 GiB；1200 萬像素的照片解碼後約 36 MB）；重啟就會清空，前端遇到「找不到 image_id」時自動重新上傳。

### 2.3 `openapi/workbench.yaml`（React → Go）

**白話說明**：前端呼叫的網址。開發工具（`/workbench/v1/dev/*`）只在本機開發模式存在；冷啟動（`/workbench/v1/coldstart/*`）與登入可上線，除登入外都須登入後才能使用。

| 方法與路徑 | 用途 | 對應 |
| --- | --- | --- |
| `POST /workbench/v1/auth/login` | 帳號密碼登入，設定 HttpOnly Cookie | Go |
| `POST /workbench/v1/auth/logout` | 登出 | Go |
| `GET /workbench/v1/auth/me` | 目前登入者 | Go |
| `GET /workbench/v1/dev/config-schemas` | 參數表單結構 | `GetConfigSchemas` |
| `POST /workbench/v1/dev/images` | 上傳影像（multipart） | `PutImage` |
| `POST /workbench/v1/dev/images/synthesize` | 合成影像 | `Synthesize` |
| `POST /workbench/v1/dev/images/{image_id}/degrade` | 模擬退化 | `Degrade` |
| `POST /workbench/v1/dev/views` | 診斷影像 | `RenderView` |
| `GET /workbench/v1/dev/artifacts/{id}` | 取得影像型結果（PNG／JPEG） | `GetArtifact` |
| `POST /workbench/v1/dev/quality` | 品質檢查 | `CheckQuality` |
| `POST /workbench/v1/dev/barcode` | 條碼逐步升級 | `DecodeBarcode` |
| `POST /workbench/v1/dev/invoice-qr` | 發票雙 QR | `LocateInvoiceQr` |
| `POST /workbench/v1/dev/label` | 營養標示 | `PreprocessLabel` |
| `POST /workbench/v1/dev/food` | 食物照片 | `PreprocessFood` |
| `POST /workbench/v1/dev/sweeps` | 參數掃描 | `Sweep` |
| `POST /workbench/v1/dev/batches` | 資料夾批次（SSE 回報進度） | `RunBatch` |
| `GET /workbench/v1/dev/e1/runs`、`GET …/runs/{id}` | E1 結果 | `ListE1Runs`、`GetE1Run` |
| `POST /workbench/v1/dev/e1/runs` | 快速執行（SSE 回報進度） | `StartE1Run` |
| `POST /workbench/v1/coldstart/submissions` | 建立一筆上傳 | Go |
| `PUT /workbench/v1/coldstart/submissions/{id}/images/{kind}` | 上傳照片，kind：front／barcode／label；Go 存 MinIO 後呼叫前處理 | Go＋`PreprocessService` |
| `GET /workbench/v1/coldstart/submissions/{id}` | 取得上傳內容與前處理結果 | Go |
| `PUT /workbench/v1/coldstart/submissions/{id}/draft` | 儲存人工輸入（條碼、品名、營養數值） | Go |
| `POST /workbench/v1/coldstart/submissions/{id}/confirm` | 確認並寫入產品資料庫 | Go |
| `GET /workbench/v1/coldstart/submissions?status=` | 列出上傳（草稿／已確認） | Go |

錯誤回應統一為 `{"code": "IMAGE_NOT_FOUND", "message": "…"}`，`code` 用英文代碼，前端對應中文。

**審核重點**
- 開發工具路由由 `WORKBENCH_DEV_TOOLS=1` 開啟；未開啟時一律 404。線上部署時不開。
- 登入：Cookie 為 HttpOnly、SameSite=Lax；線上部署時加 Secure（需 HTTPS）。

### 2.4 資料表（`db/migrations/`，階段 5 才寫；已由 2.6 節取代）

**白話說明**：冷啟動需要「使用者」「登入工作階段」「上傳草稿」「產品」「營養標示」「產品照片」六張表。**欄位須先與規劃書 6.1、9.2 對齊**；以下只是初稿，用來確認方向。

| 資料表 | 主要欄位 | 說明 |
| --- | --- | --- |
| `users` | id、username（唯一）、password_hash（argon2id）、display_name、created_at、disabled | 組員帳號；由管理指令建立，不開放註冊 |
| `sessions` | id（隨機 token 的雜湊）、user_id、expires_at、created_at | 登入工作階段；登出或過期即刪除 |
| `product_submissions` | id、status（draft／confirmed／rejected）、barcode、draft（JSONB）、preprocess（JSONB，前處理結果摘要）、created_by、confirmed_by、confirmed_at、product_id | 一筆上傳；確認前可反覆修改 |
| `products` | id、barcode（唯一）、name、brand、serving_size_g、servings_per_package、source（coldstart）、created_at | 產品主檔 |
| `nutrition_facts` | product_id、basis（per_serving／per_100g）、energy_kcal、protein_g、fat_g、saturated_fat_g、trans_fat_g、carbohydrate_g、sugar_g、sodium_mg、confirmed_by、confirmed_at | 台灣營養標示的八項必要欄位；數值為人工確認的真值 |
| `product_images` | id、product_id、submission_id、kind（front／barcode／label）、object_key（MinIO）、sha256、width、height、created_at | 原始照片；前處理後影像不另存（可由原圖與設定重現） |

**審核重點**
- 同一條碼已存在時：預設擋下並顯示既有產品，由人決定「補照片」或「修正數值」（修正保留歷史紀錄的方式待定）。
- 是否需要 `ai_*` view 給 Python 讀取（例如 RAG 用的產品清單）？可在之後另開 migration。

---

### 2.5 審核時的修正（2026-10-13 同意）

- **Python 產生碼位置**：`proto/buf.gen.yaml` 的 Python 輸出改為 `../ai/src`，產生碼落在 `ai/src/dietai/v1/`（產生的程式以 `from dietai.v1 import …` 互相引用，放在 `dietai/gen/` 下會找不到）。此資料夾視同 `gen/`：不手改，ruff／mypy 排除；另加 `pyi` 外掛供 mypy strict 檢查型別。
- **`RenderView` 回傳**：改為 `RenderViewResponse`，直方圖等資料型檢視放 `data_json`，不轉成影像。
- **`GetArtifact`**：暫存影像（含退化後影像）與診斷影像共用 ID，前端顯示退化後影像也用它取得。Python 以（原圖 ID, 退化參數）快取退化結果。
- **產生碼提交進 git**（`api/gen/`、`ai/src/dietai/v1/`、`workbench/src/api/gen/`）；CI 執行 `make gen` 後 `git diff` 必須為空。

**PR 1a 實作時的調整（工具限制，待 Rick 確認）**

- **`WorkbenchService` 每個 RPC 有專屬的回應訊息**：buf lint（STANDARD）要求回應命名為 `<RPC>Response` 且不共用，因此 `PutImage`／`Synthesize`／`Degrade` 改回傳 `XxxResponse { ImageRef image = 1; }`，`Sweep`／`RunBatch`／`ListE1Runs`／`GetE1Run`／`StartE1Run` 改回傳各自的 `XxxResponse { string json = 1; }`。內容不變。
- **路徑不用冒號**：Go 標準函式庫的路由萬用字元必須佔滿整段路徑，`{id}:degrade` 無法註冊。改為 `POST /dev/images/synthesize`、`POST /dev/images/{image_id}/degrade`；階段 5 的確認也改為 `POST /coldstart/submissions/{id}/confirm`。
- **冷啟動路由延到階段 5**：請求與回應欄位取決於 2.4 節資料表，屆時與資料表一起補進 `openapi/workbench.yaml`。登入三支路由已先寫入。
- **JSON 為主的回應一律是物件**：`FreeJson`（掃描、批次、E1、直方圖、真值）限定為 JSON 物件，Python 回傳串列時須包一層，例如 `{"rows": [...]}`。
- **Go 升到 1.25**：grpc-go 1.84 需要 Go 1.25；`api/Dockerfile` 一併改為 `golang:1.25`。

### 2.6 階段 5 規格草稿（2026-10-16，待審核；取代 2.4 節）

> 依 2.4 節初稿細化。**規劃書 6.1、9.2 不在 repo 中**（README 指向 `docs/`，實際沒有），以下尚未與之對齊；請提供這兩節，或確認先依本草稿實作、差異之後以新的 migration 補上。
> 審核方式：逐項回覆「同意」或要改的地方。同意後才寫入 `db/migrations/`、`openapi/workbench.yaml`（`db/CLAUDE.md`：migration 須由人主導）。

#### 2.6.1 待決定事項（附建議）

| # | 問題 | 建議 | 其他選項 |
| --- | --- | --- | --- |
| D1 | 同一條碼已存在 | 擋下並顯示既有產品；由人選「補照片」（照片掛到既有產品）或「修正數值」（見 D2） | 一律擋下，第一版不能修改 |
| D2 | 修正營養數值的歷史 | `nutrition_facts` 只新增不修改：修正時新增一版，舊版填 `superseded_at`；同一產品、同一基準只有一版有效 | 原地修改＋另建稽核表 |
| D3 | 每份與每 100 公克（毫升） | 兩種基準都存，照標示原樣輸入；產品記錄淨重單位（g／ml）；程式檢查兩欄是否一致（每份 × 100 ÷ 份量），不一致時提示，不自動改 | 只存每 100，每份由程式換算 |
| D4 | 本機開發要不要 Postgres 與 MinIO | 冷啟動頁需要，以 `deploy/docker-compose.yml` 啟動；`make workbench` 偵測不到資料庫時，冷啟動頁顯示「未連線資料庫」，開發工具頁照常可用 | 本機改存檔案系統（與線上行為不同，不建議） |
| D5 | 建立組員帳號 | Go 管理指令 `go run ./cmd/wbuser add <帳號> <顯示名稱>`（密碼由終端機輸入），不開放註冊 | 第一個登入者自動成為管理者 |
| D6 | 給 Python 讀的 `ai_*` view | 階段 5 不建；RAG 需要時另開 migration | 一併建立 `ai_products_v1` |

#### 2.6.2 資料表（`db/migrations/000002_coldstart.up.sql`）

**白話說明**：六張表。上傳先存成「草稿」，人確認後才建立產品與營養標示；營養數值只來自人工輸入（規則 1），前處理結果只用來輔助（例如條碼解碼結果預先填入，但仍須人確認）。照片原檔存 MinIO，資料庫只記位置與雜湊。

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT        NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
    password_hash TEXT        NOT NULL,              -- argon2id（PHC 字串格式）
    display_name  TEXT        NOT NULL,
    disabled      BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash  BYTEA       PRIMARY KEY,            -- Cookie 中隨機 token 的 SHA-256；資料庫不存原值
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL                -- 建立後 7 天；登出即刪除
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE products (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barcode              TEXT        NOT NULL UNIQUE CHECK (barcode ~ '^[0-9]{8,14}$'),  -- 校驗碼由 Go 檢查
    name                 TEXT        NOT NULL,
    brand                TEXT,
    net_content          NUMERIC(10,2) CHECK (net_content > 0),    -- 淨重或容量
    content_unit         TEXT        NOT NULL CHECK (content_unit IN ('g', 'ml')),
    serving_size         NUMERIC(10,2) CHECK (serving_size > 0),   -- 每份（單位同 content_unit）
    servings_per_package NUMERIC(10,2) CHECK (servings_per_package > 0),
    source               TEXT        NOT NULL CHECK (source IN ('coldstart')),
    created_by           UUID        NOT NULL REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 台灣營養標示的八項必要欄位；數值為人工確認的真值，只新增不修改（D2）
CREATE TABLE nutrition_facts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       UUID        NOT NULL REFERENCES products(id),
    basis            TEXT        NOT NULL CHECK (basis IN ('per_serving', 'per_100')),  -- per_100 的單位見 products.content_unit
    energy_kcal      NUMERIC(10,2) NOT NULL CHECK (energy_kcal >= 0),
    protein_g        NUMERIC(10,2) NOT NULL CHECK (protein_g >= 0),
    fat_g            NUMERIC(10,2) NOT NULL CHECK (fat_g >= 0),
    saturated_fat_g  NUMERIC(10,2) NOT NULL CHECK (saturated_fat_g >= 0),
    trans_fat_g      NUMERIC(10,2) NOT NULL CHECK (trans_fat_g >= 0),
    carbohydrate_g   NUMERIC(10,2) NOT NULL CHECK (carbohydrate_g >= 0),
    sugar_g          NUMERIC(10,2) NOT NULL CHECK (sugar_g >= 0),
    sodium_mg        NUMERIC(10,2) NOT NULL CHECK (sodium_mg >= 0),
    confirmed_by     UUID        NOT NULL REFERENCES users(id),
    confirmed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at    TIMESTAMPTZ,                     -- 被新版取代的時間；NULL 為有效版本
    CHECK (saturated_fat_g + trans_fat_g <= fat_g),
    CHECK (sugar_g <= carbohydrate_g)
);
CREATE UNIQUE INDEX nutrition_facts_current_idx
    ON nutrition_facts (product_id, basis) WHERE superseded_at IS NULL;

CREATE TABLE product_submissions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status        TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'rejected')),
    draft         JSONB       NOT NULL DEFAULT '{}',  -- 人工輸入中的欄位（條碼、品名、份量、兩種基準的營養數值）
    preprocess    JSONB       NOT NULL DEFAULT '{}',  -- 各照片的前處理摘要（品質警告、條碼解碼、標示四角）；只供參考
    product_id    UUID        REFERENCES products(id),  -- 確認後（新建或補照片的既有產品）
    created_by    UUID        NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_by  UUID        REFERENCES users(id),
    confirmed_at  TIMESTAMPTZ,
    CHECK ((status = 'confirmed') = (product_id IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE INDEX product_submissions_status_idx ON product_submissions (status, updated_at DESC);

CREATE TABLE product_images (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id  UUID        NOT NULL REFERENCES product_submissions(id),
    product_id     UUID        REFERENCES products(id),  -- 確認後填入
    kind           TEXT        NOT NULL CHECK (kind IN ('front', 'barcode', 'label')),
    object_key     TEXT        NOT NULL UNIQUE,     -- MinIO：coldstart/<submission_id>/<kind>-<sha256 前 16 碼>.<副檔名>
    sha256         BYTEA       NOT NULL,
    content_type   TEXT        NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
    width          INT         NOT NULL CHECK (width > 0),
    height         INT         NOT NULL CHECK (height > 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_images_submission_kind_idx ON product_images (submission_id, kind);  -- 重傳同一種照片時取代
```

`down`：依相反順序 `DROP TABLE`。`gen_random_uuid()` 是 PostgreSQL 13 以上內建函式，不需要擴充套件。

**審核重點**
- `nutrition_facts` 的兩條 `CHECK`（飽和＋反式 ≤ 脂肪、糖 ≤ 碳水）是確定性規則，擋下明顯的輸入錯誤；標示本身因四捨五入而違反時，是否要放寬？
- 「補照片」時，照片的 `submission_id` 指向新的那筆上傳、`product_id` 指向既有產品。
- 條碼存標示上的數字原樣，不轉成 GTIN-14；UPC-A 與對應的 EAN-13（前面補 0）會被視為不同條碼，是否要統一？

#### 2.6.3 冷啟動路由（`openapi/workbench.yaml`）

與 2.3 節的表格相同（確認改為 `POST …/{id}/confirm`，見 2.5 節），以下補上欄位：

| 路由 | 請求 | 回應 |
| --- | --- | --- |
| `POST /coldstart/submissions` | 無 | `201 Submission` |
| `GET /coldstart/submissions?status=draft&limit=50` | — | `{ items: SubmissionSummary[] }`（id、狀態、條碼、品名、建立者、更新時間、三種照片是否已上傳） |
| `GET /coldstart/submissions/{id}` | — | `Submission` |
| `PUT /coldstart/submissions/{id}/images/{kind}` | multipart `file`（JPEG／PNG，上限 31 MB） | `Submission`（含該照片的前處理摘要）。Go 存 MinIO 後呼叫 `PreprocessService`：front→`CheckQuality`；barcode→`CheckQuality`＋`DecodeBarcode`；label→`CheckQuality`＋`PreprocessLabel` |
| `GET /coldstart/submissions/{id}/images/{kind}` | — | 原圖（`image/jpeg`／`image/png`），供確認畫面顯示 |
| `PUT /coldstart/submissions/{id}/draft` | `Draft` | `Submission`；只存不檢查完整性（草稿可缺欄位），型別錯誤回 400 |
| `POST /coldstart/submissions/{id}/confirm` | `{ mode: "create" \| "add_images" \| "revise_nutrition", product_id? }` | `200 { submission, product }`；條碼已存在且 `mode=create` 時回 `409 BARCODE_EXISTS`（附既有產品）；欄位不完整回 `422 DRAFT_INCOMPLETE`（附缺少的欄位）；兩種基準的數值不一致回 `422 NUTRITION_INCONSISTENT`（附差異） |
| `POST /coldstart/submissions/{id}/reject` | `{ reason }` | `Submission` |
| `GET /coldstart/products/{barcode}` | — | `Product`（含有效的營養標示與照片清單）；不存在回 404 |

- `Draft`：`barcode`、`name`、`brand`、`net_content`、`content_unit`、`serving_size`、`servings_per_package`、`nutrition: { per_serving: Nutrients, per_100: Nutrients }`；`Nutrients` 為八項數值，草稿中都可省略。
- `Submission`：`id`、`status`、`draft`、`images: { front?, barcode?, label? }`（各含寬高、上傳時間、前處理摘要：品質警告、解碼結果、標示四角）、`product_id?`、建立者與時間。
- 數值以 JSON number 傳送，Go 以 `NUMERIC` 存入；比較與顯示的捨入由 Go 決定（兩位小數）。
- 冷啟動路由都要登入（`sessionCookie`），未登入回 401；不受 `WORKBENCH_DEV_TOOLS` 影響。
- 同一筆上傳以 `updated_at` 做樂觀鎖：寫入請求帶 `If-Match`，不符回 `412`，避免兩位組員同時編輯互相覆蓋。

#### 2.6.4 兩項規格調整（第 6 節，可與本節一起審）

1. **`RenderView` 新增 `vlm_sizes` 檢視**：回傳 `data_json`：`{"sizes": [{"max_side", "bytes", "width", "height"}]}`。食物照片頁的 VLM 尺寸試算從 6 次 `/dev/food` 請求改成 1 次。
2. **與真值比較改由後端計算**：`RenderView` 新增 `truth_compare` 檢視（`data_json`：營養標示的四角平均與最大誤差（px）、食物照片的盤數差與菜數差），取代前端 `lib/geometry.ts` 的計算，符合「數字由程式決定」，評測數字也與研究共用 `dietai.evaluation`。`PreprocessLabelResponse`、`PreprocessFoodResponse` 不變（正式流程沒有真值）。

兩者都只新增 `view` 的值，不改 proto 欄位；`openapi/workbench.yaml` 的 `view` 列舉加兩個值。

---

## 3. 共通約定

- **前端**：Vite＋React＋TypeScript（strict）、Tailwind、shadcn/ui 風格元件（以 Radix 撰寫於 `components/ui/`，不使用 CLI）、TanStack Query、React Router、openapi-fetch。圖表：階段 1 的直方圖以 SVG 自繪；參數掃描等需要互動圖表時（階段 3）再引入 Vega-Lite。型別以 openapi-typescript 由 `openapi/workbench.yaml` 產生到 `workbench/src/api/gen/`。
- **版面**：左側直欄＝模組（總覽、模組一到五、冷啟動），頂部膠囊＝模組內頁面；工具頁為左控制面板（影像／參數／匯出入分頁）＋右結果，兩欄固定一個畫面高、各自捲動。模組與頁面註冊表在 `workbench/src/nav.ts`。介面只寫中文（警告代碼等維持英文代碼，由前端對應中文）。色系：靛藍主色、紫輔色，不使用綠與橘。
- **即時調參**：滑桿停止約 150 ms 後送出請求，並取消尚未回來的舊請求；結果區保留舊結果並淡化，直到新結果回來。
- **Go**：`internal/workbench`（handler → service，service 依賴 `AIClient` 介面）；`internal/platform/aiclient` 實作 gRPC 連線；handler 不寫業務邏輯，日誌帶 `request_id` 並透傳給 Python（gRPC metadata）。
- **Python**：`server/` 只做 proto ↔ dietai 轉換；設定 JSON 經 `dietai.devtools.configs` 建成 dataclass 並驗證，錯誤回 `INVALID_ARGUMENT`（附欄位名稱）。
- **測試**：Go 用 `httptest`＋假的 AIClient；Python 以程序內 gRPC server 測 servicer；前端用 Vitest＋Testing Library＋MSW；每頁一個 Playwright 冒煙測試（接真的 Go 與 Python，只在本機執行；CI 跑 lint、型別、Vitest、建置）。
- **指令**：`make workbench` 同時啟動 Python gRPC、Go（`WORKBENCH_DEV_TOOLS=1`）、Vite；`make gen` 加入 oapi-codegen 與 openapi-typescript；`啟動工作台.bat` 改為啟動同樣三個程序。階段 1 至 3 先以 `make workbench-react` 啟動新版，`make workbench` 維持 Streamlit，到階段 4 再切換。

---

## 4. 階段

| 階段 | 內容 | 驗收 |
| --- | --- | --- |
| 0 | ADR 0003、本任務書、規格草稿審核 | Rick 同意第 2.1 至 2.3 節 |
| 1 | 打通串接＋外框＋品質檢查：`preprocess.proto`／`workbench.proto` 的對應 RPC、Python gRPC server、Go aiclient 與 `/workbench/v1/dev/*` 的品質檢查相關路由、React 外框（左欄、頂部膠囊、雙欄、參數表單自動產生、可疊圖影像檢視）、品質檢查頁；`dietai.devtools` 搬入模擬退化與設定結構 | 拖動退化滑桿時結果即時更新（本機 < 200 ms）；三端測試與 Playwright 冒煙測試通過。拆成四個 PR：1a 規格與產生碼 → 1b Python gRPC 服務與 `dietai.devtools` → 1c Go aiclient 與工作台路由 → 1d React 外框與品質檢查頁 |
| 2 | 條碼與發票 QR、營養標示、食物照片 | 現有 `ai/tests/workbench/test_app.py` 涵蓋的行為在新版都能重現 |
| 3 | 參數掃描、資料夾批次、E1（快速執行以 SSE 回報進度） | 開發工具各頁完成 |
| 4 | 移除 Streamlit 版（`ai/workbench/`、`workbench` extras）；更新 README、CLAUDE.md、`.bat`；Go 以 `embed` 提供建置後的前端 | 只剩新版；`make workbench` 一個指令可用 |
| 5 | 冷啟動上傳：資料表 migration（2.4 節審核後）、帳號密碼登入、上傳三種照片、前處理結果與人工確認畫面、寫入產品資料庫 | 組員可在本機登入、上傳、確認一筆產品並在資料庫查到；重複條碼會被擋下 |

---

## 5. 進度

### 階段 1（2026-10-14 完成，PR 待審）

| PR | 內容 |
| --- | --- |
| #10 1a | 規格與產生碼（另修正 CI：buf-action 不在 PR 留言） |
| 1b | Python gRPC 服務、`dietai.devtools`；`add_glare` 只算外接框（輸出逐像素不變） |
| 1c | Go `aiclient`、`/workbench/v1/dev/*` 品質檢查路由；`*.go` 一律 LF |
| 1d | React 外框、品質檢查頁、`make workbench-react` |

驗收實測（本機，1080p 合成影像）：
- 拖動「模糊 σ」到結果更新：約 104 ms（Playwright，扣除 150 ms 防抖）。Python 端：品質檢查約 14 ms、取影像約 9 ms。
- 退化本身的耗時依項目而異：模糊約 2–5 ms，雜訊約 90 ms、光斑約 60 ms（最佳化後）、梯度約 35 ms；同時開啟雜訊與光斑時可能超過 200 ms（見第 6 節）。
- 三端測試：Go（aiclient、httpmw、workbench）、Python（devtools 30 項、server 14 項）、前端（Vitest 21 項、Playwright 2 項）皆通過。

實作時的決定：
- 依賴版本固定；TypeScript 5.9、Vite 7、React Router 7（較新的主版號與 typescript-eslint 等工具尚未相容）。
- 參數不合法時保留上一次成功的結果（淡化）並標出欄位；Python 重啟後前端自動重新建立原圖。
- 尚未遷移的頁面顯示「預計在階段 N 完成」，期間使用 Streamlit 版。

### 階段 2（2026-10-14 完成，PR 待審）

條碼與發票 QR、營養標示、食物照片三頁，一個 PR（三層各一個 commit）。

- Python：`PreprocessService` 其餘四個 RPC；`RenderView` 加入 `ladder_variant`、`label_edges`、`glare_mask`、`food_mask`。影像型結果在開發模式依（原圖, 參數）只存一次；VLM 影像存實際送出的 JPEG 原檔。
- Go：四條路由；原始位元組以 base64 回傳；Python 沒開開發模式時回 502 `AI_NOT_DEV_MODE`。
- 前端：共用元件抽出（`ToolPanel`、`AnalysisFrame`、`useAnalysis`、疊圖），品質檢查頁一併改用；合成場景參數化（`lib/scenes.ts`）。
- 驗收：`ai/tests/workbench/test_app.py` 中這三頁的情境都已在新版重現（Vitest 32 項、Playwright 10 項，含旋轉 45° 時只用原圖失敗但逐步升級成功、清空多尺度倍率回報參數不合法、大面積光斑要求重拍、零盤時警告）。實測發票左右兩碼的 Big5 位元組正確、營養標示四角平均誤差 2.0 px、食物照片菜數與真值相同。唯一未搬的是 pyzbar 解碼器（見下）。

實作時的決定：
- **解碼器只用 zxing-cpp**：pyzbar 只是 E1 的對照組（會轉碼 QR 內容），不搬到新版；需要時用 E1 頁（階段 3）。
- **盤緣步驟關閉時的試算**、**VLM 尺寸試算**：都以額外的 `/dev/food` 請求完成（前者開 `enable_plate`，後者關閉切菜並改 `vlm_max_side`，共 6 次），不另加規格；只在該檢視開啟時送出。
- **四角誤差與盤數差異**在前端計算：這是與合成真值比較的評測顯示，不是前處理數值。
- **只用原圖的對照**：條碼模式另送一次 `rungs: ["raw"]` 的請求，對應 Streamlit 版的「只用原圖：成功／失敗」。
- **與 Streamlit 版的差異**：亮度、模糊、雜訊、光斑等不移動像素的退化會保留合成真值（Streamlit 版套用任何退化都丟掉真值），因此加光斑時仍可看到四角誤差；只有旋轉、縮小才丟掉真值。

### 階段 3（2026-10-15 完成，PR 待審）

參數掃描、資料夾批次、E1 三頁；模組一的七個工具都已遷移。一個 PR（Python、Go、前端各一個 commit）。

- Python：`WorkbenchService` 的 `Sweep`、`RunBatch`（串流）、`ListE1Runs`、`GetE1Run`、`StartE1Run`（串流）；`rpc.stream` 把同步產生器包成 aio 串流（取消時關閉產生器）。邏輯在 `dietai.devtools.sweep／batch／e1`，統計一律由 `dietai.evaluation` 計算，路徑一律經測試集鎖定。
- Go：批次與 E1 快速執行以 SSE 回報；先收第一則再回應，一開始就失敗（例如測試集鎖定）時照常回 HTTP 錯誤，中途出錯送 `event: error`。
- 前端：三頁；SVG 圖表元件（`components/charts.tsx`）；`useStream`（SSE、可取消）、`useLocalImage`。
- 驗收：Python 新增 devtools 與串流測試、Go 的 SSE 測試、Vitest 40 項、Playwright 13 項皆通過；實際以 E1 合成資料快速執行並檢視結果。

實作時的決定：
- **不引入 Vega-Lite**：圖表以 SVG 元件實作（折線、含信賴區間的長條、堆疊長條、熱度圖、直方圖），體積小並直接套用深淺色主題；需要更複雜的互動時再評估。
- **單張檢視（批次、E1 失敗影像）**：`RunBatch` 的 `folder` 也接受單一檔案，處理該張並存進暫存區、回傳 `image_id` 與寬高；不另加規格。
- **E1 的基準組**：`GetE1Run` 一次回傳每個基準組的 McNemar 結果（實驗組數量不多），切換基準組不必重新請求。
- **退化種類的範圍**在前端 `lib/sweepAxes.ts` 有一份副本；Python 測試會讀這個檔案核對，兩邊不一致時失敗。
- **批次改為按「執行」才計算**（Streamlit 版是參數一改就重算）：資料夾可能很大，參數改了會提示重新執行。
- **自我審查後的修正**：串流改為同一個執行緒迭代與關閉產生器（取消時不會在執行中被關閉）；E1 快速執行可真正中止並刪除未完成的資料夾，每次執行的合成資料各自一份；`useStream` 被新執行取代時不覆蓋狀態、事件每 100 ms 批次更新；SSE 提早結束時關閉連線；單張影像隨 IMAGE_NOT_FOUND 重新載入；門檻線改用算出該結果的參數；E1 換執行時重置選取；介面標籤改為中文。
- **修正**：分析查詢在防抖跟上之前就以舊參數（缺少 image_id）送出，觸發「找不到暫存影像 → 重新上傳」的無限循環；查詢改為等防抖跟上才送出，重新上傳也加上 5 秒的頻率限制。

## 6. 後續改善（不阻擋階段 2）

- **規格調整（須由人審核，可與階段 3 的規格一起提）**：
  - `RenderView` 新增 `vlm_sizes`（資料型，一次回傳各長邊的 JPEG 大小），取代食物照片頁目前的 6 次 `/dev/food` 請求；
  - 營養標示與食物照片的回應加入「與真值比較」的欄位（四角誤差、盤數差），讓評測數字也由後端計算（目前在前端 `lib/geometry.ts`）。

- **退化效能**：`gaussian_noise` 以 float64 產生 600 萬個亂數（約 90 ms）；改用 float32 或預先產生雜訊會改變輸出，影響 E1 合成資料的可重現性，須另開 PR 並重跑 E1。工作台也可只對調整中的退化快取前段結果。
- **網址保存參數**：把參數覆寫與影像來源寫進網址，方便分享與重新整理後還原（Streamlit 版有此功能）。
- **本機照片**：階段 3 與資料夾批次一起加入（經 `guard_path` 測試集鎖定）。
- **CI 冒煙測試**：在 CI 啟動 Python 與 Go 跑 Playwright，需安裝 OpenCV 與瀏覽器，約增加 3–4 分鐘。

## 7. 待決定（不影響階段 0 至 4）

- 線上部署位置與 HTTPS。
- 產品資料表與規劃書 6.1、9.2 的對齊。
- 同一產品修正數值時的歷史紀錄方式。
