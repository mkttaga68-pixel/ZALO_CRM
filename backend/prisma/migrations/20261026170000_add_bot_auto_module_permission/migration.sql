-- BOT-AUTO MODULE PERMISSION (2026-10-26)
--
-- Thêm resource 'bot_auto' vào ma trận phân quyền: công tắc TỔNG cho cả tab 🤖
-- Bot-Auto (Trigger / Message Block / Sequence / Chiến dịch / Tệp khách hàng).
-- Bỏ tick 'bot_auto.access' → tắt sạch 5 resource con, không phải đi bỏ từng ô.
--
-- KHÔNG đổi schema: grants là cột JSONB sẵn có, đây là migration DỮ LIỆU thuần.
--
-- Vì sao phải backfill: grants là snapshot JSON lưu lúc tạo nhóm quyền, resource
-- mới mặc định DENY. Không backfill thì ngay sau khi deploy, mọi nhóm quyền đang
-- chạy (kể cả Admin, Marketing, Sale) mất sạch quyền Bot-Auto — user đang dùng
-- bình thường bỗng không vào được tab 🤖.
--
-- Luật backfill: nhóm nào ĐANG có ít nhất 1 ô tick trên 5 resource con thì bật
-- 'bot_auto.access' = true → hành vi giữ nguyên y như trước khi deploy. Nhóm nào
-- vốn không có quyền automation nào (vd "Hành chính - Nhân sự") thì KHÔNG bật,
-- giữ đúng default-deny.
--
-- ROLLBACK: xem phần cuối file.

UPDATE "permission_groups" pg
SET "grants" = jsonb_set(pg."grants", '{bot_auto}', '{"access": true}'::jsonb, true),
    "updated_at" = CURRENT_TIMESTAMP
WHERE
  -- Idempotent: nhóm nào đã có khoá bot_auto thì bỏ qua (chạy lại không ghi đè
  -- lựa chọn admin đã tự tay tắt).
  pg."grants" -> 'bot_auto' IS NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(pg."grants") AS res(resource, actions)
    WHERE res.resource IN ('customer_list', 'broadcast', 'sequence', 'trigger', 'block')
      AND jsonb_typeof(res.actions) = 'object'
      -- Bất kỳ action nào đang true (không chỉ 'access') đều tính là "đang dùng
      -- Bot-Auto" → tránh trường hợp nhóm tick create/edit mà quên tick access.
      AND EXISTS (
        SELECT 1 FROM jsonb_each(res.actions) AS act(name, val) WHERE act.val = 'true'::jsonb
      )
  );

-- ══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (chạy tay nếu cần quay lại — chỉ gỡ 1 khoá JSON vừa thêm, các ô
-- quyền cũ không bị đụng tới):
--
--   UPDATE "permission_groups" SET "grants" = "grants" - 'bot_auto';
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261026170000_add_bot_auto_module_permission';
--
-- Sau đó revert code (git revert) vì backend/frontend sẽ tham chiếu resource này.
-- ══════════════════════════════════════════════════════════════════════════
