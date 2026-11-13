-- Enables explicit local, preview-confirmed department scans. No background worker is started.
ALTER TABLE "ai_qc_department_monitor_config"
  DROP CONSTRAINT "ai_qc_dept_config_disabled_check",
  ADD COLUMN "version" BIGINT NOT NULL DEFAULT 1;
ALTER TABLE "ai_qc_department_monitor_control"
  ADD COLUMN "version" BIGINT NOT NULL DEFAULT 1;
