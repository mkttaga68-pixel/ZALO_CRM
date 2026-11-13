-- New native QC module; apply ONLY to an approved isolated sandbox database.
-- Production application/migration approval is separate.
CREATE TABLE "native_ai_qc_workspace" (
  "organization_id" TEXT PRIMARY KEY,
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version">=0),
  "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload")='object'),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
