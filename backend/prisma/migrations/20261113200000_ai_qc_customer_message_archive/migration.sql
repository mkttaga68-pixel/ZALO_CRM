-- "Lưu trữ tin nhắn": nightly copy of 1-1 customer messages. Additive only; no change to CRM tables.
-- No FK to contacts/conversations on purpose: the archive must survive deletion of a conversation or Zalo account.
CREATE TABLE ai_qc_customer_message_archive (
  message_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  zalo_account_id TEXT NOT NULL,
  zalo_account_name TEXT,
  sender_type TEXT NOT NULL,
  sender_name TEXT,
  sent_via TEXT NOT NULL DEFAULT 'user',
  content_type TEXT NOT NULL DEFAULT 'text',
  content TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id TEXT NOT NULL
);
CREATE INDEX ai_qc_cma_contact ON ai_qc_customer_message_archive(org_id, contact_id, sent_at DESC);
CREATE INDEX ai_qc_cma_run ON ai_qc_customer_message_archive(org_id, run_id);

CREATE TABLE ai_qc_customer_archive_run (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('SCHEDULE', 'MANUAL')),
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  cursor_from TIMESTAMPTZ,
  cursor_to TIMESTAMPTZ NOT NULL,
  customers INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  error_code TEXT
);
CREATE INDEX ai_qc_car_org ON ai_qc_customer_archive_run(org_id, started_at DESC);
-- At most one scheduled run per local date (protects against double runs across restarts/replicas).
CREATE UNIQUE INDEX ai_qc_car_daily ON ai_qc_customer_archive_run(org_id, local_date) WHERE trigger = 'SCHEDULE';
