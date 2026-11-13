# Cập nhật local AIQC phòng ban — 11/11/2026

- URL: http://localhost:3080/ai-quality-control → Phòng ban.
- Image: `zl-crm-app:aiqc-department-local-20261111`, digest `sha256:01c3a7f01e358bdbdacfe2b2e0de96dd357b23c786fcabfd80e03e65a59a4b84`.
- Hai migration cấu hình được áp dụng tường minh qua script có transaction/checksum/lock. Backup trước migration lưu tại `C:\Zalo CRM\aiqc-department-local-20261111\database-before.dump`.
- Chỉ recreate app. Không restart DB/MinIO/backup. Cập nhật app có thể ngắt phiên kết nối Zalo đang hoạt động trong lúc restart.
- Kiểm tra: 12 ca cấu hình/API bật tắt, 164 ca AIQC, backend/frontend TypeScript, frontend build và Prisma validation đạt. Sau cập nhật, app healthy; `/health` báo DB connected; API phòng ban không có phiên đăng nhập trả 401; index và chunk frontend khớp build.
- Metadata sau cập nhật: 2 migration, 4 phòng ban, 3 policy thật đang hiệu lực; 0 cấu hình bật. Không gửi nội dung hội thoại tới model trong quá trình triển khai.

## Sử dụng

1. Ctrl+F5, đăng nhập bằng quản trị viên có quyền AIQC.
2. Mở Phòng ban, chọn phòng ban đã gán nhân viên.
3. Chọn nội dung kiểm tra và người phụ trách, nhập mã tài liệu phê duyệt, lưu cấu hình.
4. Hoàn tất những điều kiện thiếu được hiển thị, bật công tắc AI phân tích phòng ban.
5. Xem trước rồi xác nhận phân tích tối đa 5 hội thoại một lượt bằng Ollama local.
6. Tắt công tắc để chặn lượt tiếp theo. Dừng tất cả tắt mọi cấu hình; Mở lại quét thử không tự bật lại phòng ban. Yêu cầu đang gửi tới model có thể hoàn tất.

## Khởi động lại / hoàn tác

Lệnh compose đã dùng:

```powershell
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.ai-qc.yml -f docker-compose.ai-qc-ollama-real.yml -f docker-compose.aiqc-department-local.yml up -d --no-deps --no-build app
```

Bỏ overlay cuối để quay về image cũ qua cùng lệnh `up --no-deps --no-build app`. Bảng cấu hình mới có thể giữ nguyên khi hoàn tác app; không xóa dữ liệu database hoặc restore toàn DB chỉ để quay lại giao diện/API cũ.

Quét nền liên tục và tự gửi cảnh báo chưa được triển khai. Production vẫn cần quy trình rollout riêng.
