-- Add Contact.hidden_at (2026-10-25)
--
-- "Xoá KH khỏi trang Khách hàng" = ẩn, KHÔNG xoá bản ghi.
--
-- Vì sao ẩn chứ không xoá cứng:
--  1. Yêu cầu là chỉ bỏ khỏi TRANG Khách hàng, còn dòng bạn bè / hội thoại / tin nhắn
--     phải giữ nguyên. Xoá Contact sẽ cascade mất luôn friends của KH đó.
--  2. Quan trọng hơn: KH vẫn là bạn trên Zalo. friend-sync resolve KH theo
--     zalo_global_id / zalo_uid — bản ghi còn thì sync DÙNG LẠI, KH đã ẩn vẫn ẩn.
--     Nếu xoá cứng, chu kỳ đồng bộ 15 phút kế tiếp sẽ tạo lại KH → "xoá" vô nghĩa.
--  3. Lỡ tay thì khôi phục được (bỏ hidden_at về NULL).
--
-- Chỉ query của trang Khách hàng lọc cột này. Chat / resolve-by-keys KHÔNG lọc,
-- để ẩn 1 KH không làm hỏng việc mở hội thoại với họ.

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "hidden_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "hidden_by_user_id" TEXT;

CREATE INDEX IF NOT EXISTS "contacts_org_id_hidden_at_idx"
  ON "contacts" ("org_id", "hidden_at");
