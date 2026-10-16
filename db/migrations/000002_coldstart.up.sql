-- 冷啟動上傳：組員帳號、登入工作階段、上傳草稿、產品、營養標示、產品照片。
-- 規格見 docs/tasks/workbench-react.md 第 2.6 節（2026-10-16 Rick 同意）。
-- 營養數值只來自人工確認（根目錄 CLAUDE.md 規則 1）；前處理結果只供參考。

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT        NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
    password_hash TEXT        NOT NULL,              -- argon2id（PHC 字串格式）
    display_name  TEXT        NOT NULL,
    disabled      BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash  BYTEA       PRIMARY KEY,            -- Cookie 中隨機 token 的 SHA-256；不存原值
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL                -- 建立後 7 天；登出即刪除
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE products (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gtin                 TEXT        NOT NULL UNIQUE CHECK (gtin ~ '^[0-9]{14}$'),  -- 補 0 到 14 碼；UPC-A 與 EAN-13 視為同一條碼
    barcode              TEXT        NOT NULL CHECK (barcode ~ '^[0-9]{8,14}$'),   -- 標示上的原樣
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

-- 台灣營養標示的八項必要欄位；只新增不修改，修正時新增一版並在舊版填 superseded_at。
-- 「飽和＋反式 ≤ 脂肪」等一致性檢查由 Go 在確認時提示（標示的捨入規定可能使其不成立），不放在這裡。
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
    superseded_at    TIMESTAMPTZ                      -- 被新版取代的時間；NULL 為有效版本
);
CREATE UNIQUE INDEX nutrition_facts_current_idx
    ON nutrition_facts (product_id, basis) WHERE superseded_at IS NULL;

CREATE TABLE product_submissions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status        TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'rejected')),
    draft         JSONB       NOT NULL DEFAULT '{}',  -- 人工輸入中的欄位
    preprocess    JSONB       NOT NULL DEFAULT '{}',  -- 各照片的前處理摘要；只供參考
    product_id    UUID        REFERENCES products(id),  -- 確認後（新建或既有產品）
    reject_reason TEXT,
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
-- 重傳同一種照片時取代
CREATE UNIQUE INDEX product_images_submission_kind_idx ON product_images (submission_id, kind);
CREATE INDEX product_images_product_idx ON product_images (product_id);
