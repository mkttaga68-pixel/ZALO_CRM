-- AIQC-AUTO-MONITORING-MOCK-01. Prepared only; never applied on app startup.
CREATE TABLE "native_ai_qc_monitoring_job" (
 "organization_id" TEXT NOT NULL,
 "id" TEXT NOT NULL,
 "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload") = 'object'),
 PRIMARY KEY ("organization_id", "id"),
 CHECK ("payload"->>'orgId' = "organization_id"),
 CHECK ("payload"->>'id' = "id")
);
CREATE TABLE "native_ai_qc_monitoring_warning" (
 "organization_id" TEXT NOT NULL,
 "id" TEXT NOT NULL,
 "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload") = 'object'),
 PRIMARY KEY ("organization_id", "id"),
 CHECK ("payload"->>'orgId' = "organization_id"),
 CHECK ("payload"->>'id' = "id")
);
CREATE TABLE "native_ai_qc_monitoring_delivery" (
 "organization_id" TEXT NOT NULL,
 "id" TEXT NOT NULL,
 "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload") = 'object'),
 PRIMARY KEY ("organization_id", "id"),
 CHECK ("payload"->>'orgId' = "organization_id"),
 CHECK ("payload"->>'id' = "id")
);
