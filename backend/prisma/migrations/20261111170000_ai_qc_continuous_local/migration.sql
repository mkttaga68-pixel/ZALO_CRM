ALTER TABLE ai_qc_department_monitor_config
  ADD COLUMN continuous_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN activated_at TIMESTAMPTZ,
  ADD COLUMN principal_epoch TEXT;
-- Existing opt-ins covered manual scans only. Require a fresh explicit opt-in.
UPDATE ai_qc_department_monitor_config SET enabled=FALSE,version=version+1;
CREATE TABLE ai_qc_continuous_job (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  config_version BIGINT NOT NULL,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PROCESSING','RETRY','DONE','SKIPPED','DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id TEXT,
  error_code TEXT,
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(org_id,department_id,config_version,message_id)
);
CREATE INDEX ai_qc_continuous_due ON ai_qc_continuous_job(org_id,state,due_at);
