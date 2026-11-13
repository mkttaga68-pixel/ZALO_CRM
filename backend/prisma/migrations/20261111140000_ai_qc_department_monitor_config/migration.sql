-- Department-scoped AIQC configuration only. No worker consumes this table yet.
-- Monitoring remains OFF until the AIQC release gates are approved.
CREATE TABLE "ai_qc_department_monitor_config" (
  "org_id" TEXT NOT NULL,
  "department_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "analysis_types" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "recipient_user_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "lookback_hours" INTEGER NOT NULL DEFAULT 24,
  "max_conversations_per_run" INTEGER NOT NULL DEFAULT 100,
  "approval_ref" TEXT,
  "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("org_id", "department_id"),
  CONSTRAINT "ai_qc_dept_config_org_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "ai_qc_dept_config_department_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE,
  CONSTRAINT "ai_qc_dept_config_lookback_check" CHECK ("lookback_hours" BETWEEN 1 AND 72),
  CONSTRAINT "ai_qc_dept_config_limit_check" CHECK ("max_conversations_per_run" BETWEEN 1 AND 500),
  CONSTRAINT "ai_qc_dept_config_types_check" CHECK (jsonb_typeof("analysis_types") = 'array'),
  CONSTRAINT "ai_qc_dept_config_recipients_check" CHECK (jsonb_typeof("recipient_user_ids") = 'array'),
  CONSTRAINT "ai_qc_dept_config_disabled_check" CHECK ("enabled" = FALSE)
);

CREATE TABLE "ai_qc_department_monitor_audit" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "department_id" TEXT,
  "actor_user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "changed_fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_qc_dept_audit_fields_check" CHECK (jsonb_typeof("changed_fields") = 'array')
);
CREATE INDEX "ai_qc_department_monitor_audit_org_created_idx"
  ON "ai_qc_department_monitor_audit" ("org_id", "created_at" DESC);

CREATE TABLE "ai_qc_department_monitor_control" (
  "org_id" TEXT PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
  "paused" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
