-- 啟用向量檢索（RAG 用）
CREATE EXTENSION IF NOT EXISTS vector;

-- 長時間任務（辨識、OCR）的狀態表；SSE 只作即時通知，結果以此表為準
CREATE TABLE jobs (
    id          UUID PRIMARY KEY,
    kind        TEXT        NOT NULL,
    status      TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    result      JSONB,
    error       TEXT,
    request_id  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TODO：依規劃書 6.1 與 9.2 新增產品、營養、別名、飲食紀錄、個人資料等資料表，
-- 並建立供 Python 唯讀讀取的 ai_* view。
