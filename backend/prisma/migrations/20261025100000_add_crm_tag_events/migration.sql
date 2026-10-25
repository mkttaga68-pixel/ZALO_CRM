-- CRM TAG ADDED → BOT-AUTO TRIGGER → SEQUENCE (2026-10-25)
--
-- Thêm DUY NHẤT 1 bảng mới: crm_tag_events. KHÔNG sửa/xoá cột nào đang có,
-- KHÔNG đổi kiểu dữ liệu, KHÔNG backfill. An toàn với dữ liệu đang chạy.
--
-- Vì sao phải có bảng này (chi tiết trong schema.prisma, model CrmTagEvent):
--  1. Contact.tags là JSONB array TÊN tag, không có bảng mapping contact-tag.
--     "Chưa gắn → đã gắn" chỉ biết được bằng diff array, nên diff + ghi tag +
--     ghi event phải cùng 1 transaction, nếu không 2 nhân viên gắn đồng thời
--     sinh 2 event cho 1 lần chuyển trạng thái → KH nhận tin 2 lần.
--  2. automationEventBus là EventEmitter in-memory: restart giữa lúc tag đã ghi
--     mà event chưa dispatch là mất event, KH không vào sequence.
--  3. Dispatch dẫn tới gửi tin Zalo, kết quả có thể KHÔNG XÁC ĐỊNH (timeout) →
--     cần state 'unknown' để KHÔNG tự gửi lại.
--
-- ROLLBACK: xem phần cuối file.

CREATE TABLE IF NOT EXISTS "crm_tag_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "crm_tag_id" TEXT NOT NULL,
    -- Snapshot tên tag lúc gắn: timeline vẫn đọc được dù tag bị rename/xoá sau.
    "tag_name" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'crm_manual',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    -- pending → dispatching → done | skipped | failed | unknown
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMP(3),
    "dispatched_at" TIMESTAMP(3),
    "result" JSONB,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_tag_events_pkey" PRIMARY KEY ("id")
);

-- FK: org/KH/tag bị xoá thì event theo luôn (event vô nghĩa nếu thiếu 3 cái này).
-- actor SET NULL: nhân viên nghỉ việc / bị xoá KHÔNG được làm mất lịch sử event.
ALTER TABLE "crm_tag_events"
  ADD CONSTRAINT "crm_tag_events_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_tag_events"
  ADD CONSTRAINT "crm_tag_events_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_tag_events"
  ADD CONSTRAINT "crm_tag_events_crm_tag_id_fkey"
  FOREIGN KEY ("crm_tag_id") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_tag_events"
  ADD CONSTRAINT "crm_tag_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dispatcher pickup: pending cũ nhất trước.
CREATE INDEX IF NOT EXISTS "crm_tag_events_state_occurred_at_idx"
  ON "crm_tag_events" ("state", "occurred_at");
-- Timeline KH.
CREATE INDEX IF NOT EXISTS "crm_tag_events_contact_id_occurred_at_idx"
  ON "crm_tag_events" ("contact_id", "occurred_at" DESC);
-- Màn hình nghiệm thu / thống kê theo tag.
CREATE INDEX IF NOT EXISTS "crm_tag_events_org_id_crm_tag_id_occurred_at_idx"
  ON "crm_tag_events" ("org_id", "crm_tag_id", "occurred_at" DESC);

-- ── Chống gửi trùng ở tầng DB ─────────────────────────────────────────────
-- Tối đa 1 event ĐANG BAY cho mỗi (KH × tag). Transaction + SELECT FOR UPDATE ở
-- application layer đã đảm bảo exactly-once cho mỗi lần chuyển trạng thái; index
-- này là lớp chặn cuối nếu có đường ghi nào lách được row lock.
--
-- KHÔNG unique trên (contact_id, crm_tag_id) trần: gỡ tag rồi gắn lại LÀ một lần
-- chuyển trạng thái mới và PHẢI sinh event mới (yêu cầu nghiệp vụ).
--
-- Prisma không hỗ trợ index có WHERE (precedent: 20260522000000_rbac_partial_unique
-- _leader_deputy) → index này chỉ sống trong migration, `prisma migrate dev` sau
-- này sẽ báo drift ở đây; giữ nguyên, đừng xoá.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_crm_tag_event_inflight"
  ON "crm_tag_events" ("contact_id", "crm_tag_id")
  WHERE "state" IN ('pending', 'dispatching');

-- ══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (chạy tay nếu cần quay lại — KHÔNG mất dữ liệu nghiệp vụ nào,
-- bảng này chỉ chứa log/outbox của tính năng mới):
--
--   DROP TABLE IF EXISTS "crm_tag_events";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261025100000_add_crm_tag_events';
--
-- Sau đó revert code (git revert) vì backend sẽ tham chiếu bảng này.
-- ══════════════════════════════════════════════════════════════════════════
