-- Add ZaloAccount.sync_paused (2026-10-25)
-- Phase Admin Purge: admin xoá dữ liệu KH đã đồng bộ của 1 nick.
--
-- Vì sao cần cột này: friend-sync-cron chạy mỗi 15 phút cho MỌI nick
-- status='connected', cộng với autoSyncOnConnect khi nick lên lại. Nếu không có
-- cờ tạm dừng, dữ liệu admin vừa xoá sẽ bị kéo về nguyên vẹn trong ≤15 phút →
-- lệnh xoá vô nghĩa. sync_paused=true chặn mọi full-sync (cron / connect /
-- manual) cho nick đó; admin bật lại thủ công khi muốn đồng bộ tiếp.
--
-- KHÔNG liên quan tới kết bạn Zalo: nick vẫn là bạn của KH trên Zalo thật,
-- chỉ dừng việc hút danh sách bạn vào CRM.

ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "sync_paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "sync_paused_at" TIMESTAMP(3);
ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "sync_paused_reason" TEXT;
