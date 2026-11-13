-- Timeset: lịch giờ hoạt động của AI quét liên tục theo phòng ban. Bảng riêng, không đổi version cấu hình.
CREATE TABLE ai_qc_department_schedule (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  days JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
  windows JSONB NOT NULL DEFAULT '[]',
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK (timezone = 'Asia/Ho_Chi_Minh'),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, department_id)
);
