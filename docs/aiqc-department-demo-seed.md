# Dữ liệu giả kiểm tra AIQC phòng ban

Đã seed local ngày 11/11/2026 qua `scripts/seed-aiqc-department-demo.cjs --apply`. Script yêu cầu deployment tier `local-test` và tenant pilot hiện tại, chạy trong transaction; không bật AI, không gọi model, không kết nối Zalo, không tạo/publish policy.

## Cách xem

1. Vào Settings → RBAC → Departments: chọn `[TEST AIQC] Chăm sóc khách hàng`. Thành viên: `[TEST AIQC] An`, `[TEST AIQC] Bình`, `[TEST AIQC] Chi`.
2. `[TEST AIQC] Phòng đối chứng` có nhân viên `[TEST AIQC] Dũng` để kiểm tra loại trừ nhân viên khác phòng.
3. Trong AIQC → Phòng ban, chọn phòng test chính, chọn loại kiểm tra phù hợp với quy tắc doanh nghiệp đã duyệt và người phụ trách, lưu cấu hình rồi bật nếu đủ điều kiện. Seed không thay đổi quy tắc hoặc cấp quyền cho tài khoản test.
4. Bấm xem trước. Phạm vi hiện tại tối đa 5 hội thoại trong 50 hội thoại mới nhất. Bộ seed có 4 hội thoại đủ điều kiện trong phòng chính và phủ cả 3 nhân viên.

| Hội thoại | Nhân viên | Mục đích |
|---|---|---|
| 01 - Phản hồi lịch sự | An | Mẫu phản hồi lịch sự |
| 02 - Ngôn ngữ cần xem xét | An | Cụm từ cần xem xét theo policy đang áp dụng |
| 03 - Phép lịch sự | Bình | Phản hồi thiếu lịch sự để người duyệt đối chiếu |
| 04 - Thông tin sản phẩm | Chi | Phản hồi thận trọng, chưa khẳng định kiến thức chưa xác minh |
| 05 - Không xác định người gửi | Không xác định | Phải bị loại khỏi lô của phòng ban |
| 06 - Ngoài phòng ban | Dũng | Phải bị loại khỏi lô của phòng chính |

Mọi tiêu đề bắt đầu bằng `[TEST AIQC]`; nội dung là giả. Kết quả AI phụ thuộc quy tắc doanh nghiệp đã duyệt, thời gian hiệu lực và model, không có cam kết sẵn về nhãn vi phạm. Tin nhắn tạo tại thời điểm seed; khi hết cửa sổ quét, tăng cửa sổ phù hợp trong giới hạn 72 giờ. Chạy lại `--apply` không làm mới thời gian và không tạo trùng.

Kênh seed có trạng thái disconnected, không UID hoặc session Zalo, đồng bộ bị tạm dừng. Bốn nhân viên giả không có mật khẩu đăng nhập khả dụng và không được cấp nhóm quyền; dùng tài khoản quản trị hiện có để test.

## Kiểm tra script

```powershell
docker exec zalo-crm-app node scripts/seed-aiqc-department-demo.cjs --check
```

Script nguồn nằm trong repo; bản chép vào container sẽ mất nếu recreate bằng image không chứa script. Các dòng seed trong PostgreSQL tồn tại sau restart. Khi cần chạy trên image mới, chép lại script từ repo; không chạy trên production. Không xóa phòng ban/nhân viên hoặc dữ liệu CRM hàng loạt để dọn seed.
