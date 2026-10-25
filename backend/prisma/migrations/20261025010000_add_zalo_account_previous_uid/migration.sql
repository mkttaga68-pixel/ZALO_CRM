-- Add ZaloAccount.previous_zalo_uid (2026-10-25)
--
-- Vì sao cần: gỡ nick kiểu purge (DELETE /zalo-accounts/:id?purge=true) buộc phải
-- set zalo_uid = NULL, vì cột đó UNIQUE nên không thể để 2 bản ghi cùng UID.
-- Hệ quả: lần quét QR sau, zalo-pool tra nick cũ theo zalo_uid → không thấy →
-- TẠO ZaloAccount MỚI rồi sync lại toàn bộ danh sách bạn. Nick cũ vẫn giữ nguyên
-- friends của nó → mỗi KH hiện 2 dòng, cùng Zalo ID, cùng tên nick.
--
-- Cột này giữ lại UID cũ để lần quét QR sau nhận ra đúng nick và KHÔI PHỤC bản ghi
-- cũ thay vì tạo mới. Khi khôi phục: chuyển ngược về zalo_uid rồi xoá cột này.
-- Không UNIQUE (nhiều nick purge cũ có thể cùng UID theo thời gian); chỉ index để tra nhanh.

ALTER TABLE "zalo_accounts" ADD COLUMN IF NOT EXISTS "previous_zalo_uid" TEXT;

CREATE INDEX IF NOT EXISTS "zalo_accounts_previous_zalo_uid_idx"
  ON "zalo_accounts" ("previous_zalo_uid");
