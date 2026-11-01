-- New tables only. Review and apply separately; never run automatically at startup.
CREATE TABLE "manual_posting_jobs" (
  "id" TEXT PRIMARY KEY, "org_id" TEXT NOT NULL, "created_by_id" TEXT NOT NULL,
  "zalo_account_id" TEXT NOT NULL, "request_id" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('GROUP','OFFER')), "body" TEXT NOT NULL,
  "image_urls" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("image_urls")='array'),
  "delay_seconds" INTEGER NOT NULL DEFAULT 10 CHECK ("delay_seconds" BETWEEN 10 AND 300),
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED','RUNNING','DONE','PARTIAL','FAILED','UNKNOWN','CANCELLED')),
  "worker_id" TEXT, "lease_until" TIMESTAMPTZ(3), "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("org_id","id"), UNIQUE("org_id","created_by_id","request_id")
);
CREATE INDEX "manual_posting_jobs_org_id_created_at_idx" ON "manual_posting_jobs"("org_id","created_at" DESC);
CREATE INDEX "manual_posting_jobs_status_created_at_idx" ON "manual_posting_jobs"("status","created_at");
CREATE INDEX "manual_posting_jobs_zalo_account_id_status_idx" ON "manual_posting_jobs"("zalo_account_id","status");
CREATE TABLE "manual_posting_recipients" (
  "id" TEXT PRIMARY KEY, "org_id" TEXT NOT NULL, "job_id" TEXT NOT NULL,
  "target_ref" TEXT NOT NULL, "thread_id" TEXT NOT NULL, "display_name" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK ("status" IN ('QUEUED','SENDING','SENT','FAILED','UNKNOWN','SKIPPED')),
  "error" TEXT, "started_at" TIMESTAMPTZ(3), "sent_at" TIMESTAMPTZ(3),
  FOREIGN KEY("org_id","job_id") REFERENCES "manual_posting_jobs"("org_id","id") ON DELETE CASCADE,
  UNIQUE("org_id","job_id","thread_id")
);
CREATE INDEX "manual_posting_recipients_org_id_job_id_ordinal_idx" ON "manual_posting_recipients"("org_id","job_id","ordinal");
